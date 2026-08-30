// Property-based tests, complementing tests/candor.test.ts's hand-picked
// examples (Alice/Bob/Carol/Mallory) with randomized books. A fixed cast of
// customers can only ever exercise the balances and book shapes someone
// thought to type in; these generate hundreds of different ones per run and
// check the same invariants hold across all of them.
//
// fast-check is not a new dependency in the sense of new attack surface — it
// already sits in node_modules as a transitive dependency of
// @midnight-ntwrk/midnight-js-types (via `effect`). Declaring it directly
// just makes that reliance explicit instead of accidental.

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildLiabilities } from '../src/merkle-tree.js';
import { verifyLocally } from '../src/verify.js';
import { CandorSimulator, hexToBytes, privateStateFor } from '../src/simulator.js';
import type { Customer } from '../src/types.js';

// 64 hex chars = a real Bytes<32> secret. Balances stay well under the
// Uint<64> ceiling on purpose — overflow behavior has its own dedicated,
// hand-crafted test in candor.test.ts; these are about ordinary operation.
const customerArb: fc.Arbitrary<Customer> = fc.record({
  secret: fc.hexaString({ minLength: 64, maxLength: 64 }),
  balance: fc.bigInt({ min: 0n, max: 1_000_000_000_000n }),
});

const bookArb: fc.Arbitrary<Customer[]> = fc.uniqueArray(customerArb, {
  minLength: 1,
  maxLength: 20,
  selector: (c) => c.secret,
});

describe('property: every book, not just the hand-picked one', () => {
  it('every customer in the book verifies as covered', () => {
    fc.assert(
      fc.property(bookArb, (book) => {
        const { tree, root, total } = buildLiabilities(book);
        for (const c of book) {
          const path = tree.getPath(tree.findLeafIndex(c));
          expect(verifyLocally(c, path, { root, declaredTotal: total }).status).toBe('covered');
        }
      }),
    );
  });

  it('an outsider with no real path never verifies as covered', () => {
    fc.assert(
      fc.property(bookArb, customerArb, (book, outsider) => {
        fc.pre(!book.some((c) => c.secret === outsider.secret));
        const { tree, root, total } = buildLiabilities(book);
        // The outsider has no real leaf index — this is what a forged or
        // guessed path looks like: well-formed, but not theirs.
        const path = tree.getPath(0);
        expect(verifyLocally(outsider, path, { root, declaredTotal: total }).status).not.toBe(
          'covered',
        );
      }),
    );
  });

  it('the declared total always equals the sum of every balance in the book', () => {
    fc.assert(
      fc.property(bookArb, (book) => {
        const { total } = buildLiabilities(book);
        expect(total).toBe(book.reduce((acc, c) => acc + c.balance, 0n));
      }),
    );
  });

  it('dropping any one customer turns only that customer red', () => {
    fc.assert(
      fc.property(bookArb.filter((b) => b.length >= 2), fc.nat(), (book, seed) => {
        const droppedIndex = seed % book.length;
        const dropped = book[droppedIndex];
        const shrunk = book.filter((_, i) => i !== droppedIndex);

        const original = buildLiabilities(book);
        const shrunkTree = buildLiabilities(shrunk);

        const droppedPath = original.tree.getPath(original.tree.findLeafIndex(dropped));
        expect(
          verifyLocally(dropped, droppedPath, {
            root: shrunkTree.root,
            declaredTotal: shrunkTree.total,
          }).status,
        ).not.toBe('covered');

        for (const c of shrunk) {
          const path = shrunkTree.tree.getPath(shrunkTree.tree.findLeafIndex(c));
          expect(
            verifyLocally(c, path, { root: shrunkTree.root, declaredTotal: shrunkTree.total })
              .status,
          ).toBe('covered');
        }
      }),
    );
  });

  it('any declared total other than the real one fails every customer, not just some', () => {
    fc.assert(
      fc.property(
        bookArb,
        fc.bigInt({ min: 1n, max: 1_000_000n }),
        fc.boolean(),
        (book, delta, subtract) => {
          const { tree, root, total } = buildLiabilities(book);
          const wrongTotal = subtract ? total - delta : total + delta;
          fc.pre(wrongTotal !== total && wrongTotal >= 0n);
          for (const c of book) {
            const path = tree.getPath(tree.findLeafIndex(c));
            expect(verifyLocally(c, path, { root, declaredTotal: wrongTotal }).status).toBe(
              'total-mismatch',
            );
          }
        },
      ),
    );
  });
});

describe('property: published_roots across an arbitrary republication sequence', () => {
  it('every root published so far stays findable after any number of republications', () => {
    fc.assert(
      fc.property(fc.array(bookArb, { minLength: 1, maxLength: 5 }), (books) => {
        const first = buildLiabilities(books[0]);
        // This simulator only ever publishes and reads the ledger back — the
        // "customer" private state is never exercised, so a dummy is fine.
        const sim = new CandorSimulator(privateStateFor('00'.repeat(32), 0n, first.tree.getPath(0)));
        const roots: string[] = [];
        for (const book of books) {
          const { root, total } = buildLiabilities(book);
          sim.publishSolvency(root, total, total);
          roots.push(root);
        }
        for (const root of roots) {
          expect(
            sim.getLedger().published_roots.findPathForLeaf(hexToBytes(root)),
          ).toBeDefined();
        }
      }),
    );
  });
});
