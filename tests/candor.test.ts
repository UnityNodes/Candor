import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../contract/src/managed/candor/contract/index.js';
import { hashLeaf, issuerCommitment } from '../src/hash.js';
import { buildLiabilities, LiabilitiesTree } from '../src/merkle-tree.js';
import type { Customer } from '../src/types.js';
import { verifyLocally } from '../src/verify.js';
import { CandorSimulator, DEMO_ISSUER_SECRET, bytesToHex, hexToBytes, privateStateFor } from '../src/simulator.js';

const ALICE: Customer = { secret: '11'.repeat(32), balance: 1_000n };
const BOB: Customer = { secret: '22'.repeat(32), balance: 2_500n };
const CAROL: Customer = { secret: '33'.repeat(32), balance: 7n };
const MALLORY: Customer = { secret: '44'.repeat(32), balance: 9_999n };

const BOOK = [ALICE, BOB, CAROL];

/** Publishes the given book and returns a simulator primed as `customer`. */
function deploy(book: Customer[], customer: Customer, reserves?: bigint) {
  const { tree, root, total } = buildLiabilities(book);
  const index = tree.findLeafIndex(customer);
  // A customer omitted from the book still holds a path — from wherever they
  // are indexed in their own view of the tree. Fall back to slot 0's path so
  // the omitted case exercises a well-formed-but-wrong witness.
  const path = tree.getPath(index >= 0 ? index : 0);
  const sim = new CandorSimulator(privateStateFor(customer.secret, customer.balance, path));
  sim.publishSolvency(root, total, reserves ?? total);
  return { sim, tree, root, total };
}

// ── Builder / circuit agreement ────────────────────────────────────────────
// The off-chain builder and the circuit hash independently. If they ever
// diverge, every root disagrees and inclusion silently reads as omission —
// so pin them against each other directly.
describe('off-chain builder mirrors the circuit', () => {
  it('leaf_of matches hashLeaf byte for byte', () => {
    for (const c of [ALICE, BOB, CAROL, { secret: '00'.repeat(32), balance: 0n }]) {
      const fromCircuit = bytesToHex(pureCircuits.leaf_of(hexToBytes(c.secret), c.balance));
      expect(fromCircuit).toBe(hashLeaf(c.secret, c.balance));
    }
  });

  it('fold_merkle matches rootFromPath for every customer, hash and sum', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    for (const c of BOOK) {
      const path = tree.getPath(tree.findLeafIndex(c));
      const leaf = { hash: hashLeaf(c.secret, c.balance), sum: c.balance };

      const [circuitHash, circuitSum] = pureCircuits.fold_merkle(
        hexToBytes(leaf.hash),
        c.balance,
        path.siblings.map(hexToBytes),
        path.siblingSums,
        path.indices,
      );

      const offChain = LiabilitiesTree.rootFromPath(leaf, path);
      expect(bytesToHex(circuitHash)).toBe(root);
      expect(bytesToHex(circuitHash)).toBe(offChain.hash);
      expect(circuitSum).toBe(total);
      expect(circuitSum).toBe(offChain.sum);
    }
  });

  it('the root total is the sum of the balances', () => {
    const { total } = buildLiabilities(BOOK);
    expect(total).toBe(BOOK.reduce((acc, c) => acc + c.balance, 0n));
  });
});

// ── Local verification agrees with the circuit ──────────────────────────────
// The customer's routine check runs offline. It has to reach the same verdict
// the contract would, or the two paths would disagree about who is covered.
describe('offline verification matches the on-chain answer', () => {
  it('says covered exactly when the circuit does', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const published = { root, declaredTotal: total };

    for (const c of BOOK) {
      const path = tree.getPath(tree.findLeafIndex(c));
      const sim = new CandorSimulator(privateStateFor(c.secret, c.balance, path));
      sim.publishSolvency(root, total, total);

      expect(verifyLocally(c, path, published).status).toBe('covered');
      expect(sim.verifyInclusion()).toBe(true);
    }
  });

  it('says not-included exactly when the circuit answers red', () => {
    const shrunk = buildLiabilities([ALICE, BOB]);
    const carolPath = buildLiabilities(BOOK).tree.getPath(2);
    const published = { root: shrunk.root, declaredTotal: shrunk.total };

    const sim = new CandorSimulator(privateStateFor(CAROL.secret, CAROL.balance, carolPath));
    sim.publishSolvency(shrunk.root, shrunk.total, shrunk.total);

    expect(verifyLocally(CAROL, carolPath, published).status).toBe('not-included');
    expect(sim.verifyInclusion()).toBe(false);
  });

  it('names an understated total instead of just saying no', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const path = tree.getPath(tree.findLeafIndex(ALICE));

    const verdict = verifyLocally(ALICE, path, { root, declaredTotal: total - 1n });
    expect(verdict.status).toBe('total-mismatch');
    if (verdict.status === 'total-mismatch') {
      expect(verdict.treeTotal).toBe(total);
      expect(verdict.declaredTotal).toBe(total - 1n);
    }
  });
});

// ── T1: inclusion ──────────────────────────────────────────────────────────
describe('T1 — included customer verifies', () => {
  it('returns true for every customer in the published book', () => {
    for (const customer of BOOK) {
      const { sim } = deploy(BOOK, customer);
      expect(sim.verifyInclusion()).toBe(true);
    }
  });

  it('stays true when re-run — inclusion is not spent', () => {
    const { sim } = deploy(BOOK, ALICE);
    expect(sim.verifyInclusion()).toBe(true);
    expect(sim.verifyInclusion()).toBe(true);
    expect(sim.verifyInclusion()).toBe(true);
  });
});

// ── T2: omission ───────────────────────────────────────────────────────────
describe('T2 — omitted customer is detectable', () => {
  it('returns false — not an error — when the published root omits the customer', () => {
    const { sim } = deploy(BOOK, MALLORY);
    // The demo hinges on this being a plain red answer the customer can read,
    // not a thrown transaction.
    expect(() => sim.verifyInclusion()).not.toThrow();
    expect(sim.verifyInclusion()).toBe(false);
  });

  it('leaks nothing per-customer into public state', () => {
    // Deliberately an exact match, not a subset: adding a ledger field should
    // force someone to look at this list and decide whether it leaks.
    // issuer_commitment is a hash of the issuer's own secret — nothing per-customer.
    const { sim } = deploy(BOOK, ALICE);
    expect(Object.keys(sim.getLedger()).sort()).toEqual([
      'committed_reserves',
      'declared_liabilities',
      'issuer_commitment',
      'liabilities_root',
      'solvent',
    ]);
  });

  it('flips to false when the issuer republishes a root dropping the customer', () => {
    const { sim, tree } = deploy(BOOK, CAROL);
    expect(sim.verifyInclusion()).toBe(true);

    const shrunk = buildLiabilities([ALICE, BOB]);
    sim.publishSolvency(shrunk.root, shrunk.total, shrunk.total);
    expect(sim.verifyInclusion()).toBe(false);
    expect(shrunk.root).not.toBe(tree.root);
  });

  it('leaves the remaining customers green after the drop', () => {
    // Without this, the previous test also passes when a republish breaks
    // inclusion for *everyone* — which is a broken contract, not an omission.
    const { sim } = deploy(BOOK, CAROL);
    const shrunk = buildLiabilities([ALICE, BOB]);
    sim.publishSolvency(shrunk.root, shrunk.total, shrunk.total);

    for (const survivor of [ALICE, BOB]) {
      const path = shrunk.tree.getPath(shrunk.tree.findLeafIndex(survivor));
      const state = privateStateFor(survivor.secret, survivor.balance, path);
      expect(sim.asCustomer(state).verifyInclusion()).toBe(true);
    }

    const carolPath = buildLiabilities(BOOK).tree.getPath(2);
    expect(
      sim.asCustomer(privateStateFor(CAROL.secret, CAROL.balance, carolPath)).verifyInclusion(),
    ).toBe(false);
  });
});

// ── A republication mid-proof must not read as an omission ─────────────────
describe('a stale path is distinguished from being dropped', () => {
  it('reverts instead of answering red when the root moved under an included customer', () => {
    const first = buildLiabilities([ALICE, BOB, CAROL]);
    const stalePath = first.tree.getPath(first.tree.findLeafIndex(ALICE));
    const sim = new CandorSimulator(privateStateFor(ALICE.secret, ALICE.balance, stalePath));
    sim.publishSolvency(first.root, first.total, first.total);
    expect(sim.verifyInclusion()).toBe(true);

    // A new customer joins; Alice is still in the book, but her path is old.
    const second = buildLiabilities([ALICE, BOB, CAROL, MALLORY]);
    sim.publishSolvency(second.root, second.total, second.total);

    // Proving takes tens of seconds, so this is the realistic case: the answer
    // must not be "you were dropped".
    expect(() => sim.verifyInclusion(first.root)).toThrow(/stale root/);
  });

  it('lets the same customer through once they refetch', () => {
    const first = buildLiabilities([ALICE, BOB, CAROL]);
    const sim = new CandorSimulator(
      privateStateFor(ALICE.secret, ALICE.balance, first.tree.getPath(0)),
    );
    sim.publishSolvency(first.root, first.total, first.total);

    const second = buildLiabilities([ALICE, BOB, CAROL, MALLORY]);
    sim.publishSolvency(second.root, second.total, second.total);

    const freshPath = second.tree.getPath(second.tree.findLeafIndex(ALICE));
    expect(
      sim.asCustomer(privateStateFor(ALICE.secret, ALICE.balance, freshPath)).verifyInclusion(),
    ).toBe(true);
  });

  it('still reports a genuine omission as red, not as staleness', () => {
    // The guard must not become a way to hide being dropped: Carol names the
    // current root and is answered red, rather than reverting.
    const sim = new CandorSimulator(
      privateStateFor(CAROL.secret, CAROL.balance, buildLiabilities(BOOK).tree.getPath(2)),
    );
    const shrunk = buildLiabilities([ALICE, BOB]);
    sim.publishSolvency(shrunk.root, shrunk.total, shrunk.total);

    expect(() => sim.verifyInclusion(shrunk.root)).not.toThrow();
    expect(sim.verifyInclusion(shrunk.root)).toBe(false);
  });
});

// ── Only the issuer may publish ─────────────────────────────────────────────
describe('publication is gated on the issuer credential', () => {
  function fresh() {
    const { tree, root, total } = buildLiabilities(BOOK);
    const path = tree.getPath(tree.findLeafIndex(ALICE));
    return { sim: new CandorSimulator(privateStateFor(ALICE.secret, ALICE.balance, path)), root, total };
  }

  it('rejects a publication from an unknown credential', () => {
    const { sim, root, total } = fresh();
    expect(() => sim.publishAs('99'.repeat(32), root, total, total)).toThrow(/not the issuer/);
  });

  it('rejects a customer trying to publish', () => {
    // Customers hold zeros where the issuer secret would be.
    const { sim, root, total } = fresh();
    expect(() => sim.publishAs('00'.repeat(32), root, total, total)).toThrow(/not the issuer/);
  });

  it('leaves the ledger untouched after a rejected publication', () => {
    const { sim, root, total } = fresh();
    expect(() => sim.publishAs('99'.repeat(32), root, total, total)).toThrow();
    expect(sim.getLedger().solvent).toBe(false);
    expect(sim.getLedger().declared_liabilities).toBe(0n);
  });

  it('accepts the real issuer', () => {
    const { sim, root, total } = fresh();
    expect(() => sim.publishAs(DEMO_ISSUER_SECRET, root, total, total)).not.toThrow();
    expect(sim.getLedger().solvent).toBe(true);
  });

  it('pins the credential at deployment — a different commitment locks the demo issuer out', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const path = tree.getPath(tree.findLeafIndex(ALICE));
    const otherIssuer = issuerCommitment('ab'.repeat(32));
    const sim = new CandorSimulator(privateStateFor(ALICE.secret, ALICE.balance, path), otherIssuer);

    expect(() => sim.publishAs(DEMO_ISSUER_SECRET, root, total, total)).toThrow(/not the issuer/);
    expect(() => sim.publishAs('ab'.repeat(32), root, total, total)).not.toThrow();
  });
});

// ── T3: solvency ───────────────────────────────────────────────────────────
describe('T3 — solvency is enforced on publish', () => {
  it('reverts on the contract assert when reserves fall short by one', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const sim = new CandorSimulator(
      privateStateFor(ALICE.secret, ALICE.balance, tree.getPath(0)),
    );
    // Assert the contract's own message: a bare toThrow() would also pass on an
    // unrelated failure and quietly stop testing solvency at all.
    expect(() => sim.publishSolvency(root, total, total - 1n)).toThrow(/failed assert: insolvent/);
  });

  it('accepts the boundary where reserves exactly equal liabilities', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const sim = new CandorSimulator(
      privateStateFor(ALICE.secret, ALICE.balance, tree.getPath(0)),
    );
    expect(() => sim.publishSolvency(root, total, total)).not.toThrow();
    expect(sim.getLedger().solvent).toBe(true);
  });

  it('sets solvent when reserves exactly cover liabilities', () => {
    const { sim, total } = deploy(BOOK, ALICE, undefined);
    const state = sim.getLedger();
    expect(state.solvent).toBe(true);
    expect(state.declared_liabilities).toBe(total);
    expect(state.committed_reserves).toBe(total);
  });

  it('sets solvent when reserves exceed liabilities', () => {
    const { sim, total } = deploy(BOOK, ALICE, 1_000_000n);
    expect(sim.getLedger().solvent).toBe(true);
    expect(sim.getLedger().committed_reserves).toBe(1_000_000n);
    expect(sim.getLedger().declared_liabilities).toBe(total);
  });
});

// ── Merkle-SUM: the declared total is bound to the leaves ──────────────────
describe('the declared total cannot be understated', () => {
  it('rejects an honest root published with a smaller total', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const path = tree.getPath(tree.findLeafIndex(ALICE));
    const sim = new CandorSimulator(privateStateFor(ALICE.secret, ALICE.balance, path));

    // Same root, same customers — only the headline figure is shaved.
    sim.publishSolvency(root, total - 1n, total);
    expect(sim.verifyInclusion()).toBe(false);
    expect(sim.getLedger().declared_liabilities).toBe(total - 1n);
  });

  it('rejects an inflated total too', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const path = tree.getPath(tree.findLeafIndex(ALICE));
    const sim = new CandorSimulator(privateStateFor(ALICE.secret, ALICE.balance, path));

    sim.publishSolvency(root, total + 1n, total + 1n);
    expect(sim.verifyInclusion()).toBe(false);
  });

  it('accepts the honest total', () => {
    const { tree, root, total } = buildLiabilities(BOOK);
    const path = tree.getPath(tree.findLeafIndex(ALICE));
    const sim = new CandorSimulator(privateStateFor(ALICE.secret, ALICE.balance, path));

    sim.publishSolvency(root, total, total);
    expect(sim.verifyInclusion()).toBe(true);
  });
});

// ── T4: aggregate ──────────────────────────────────────────────────────────
describe('T4 — auditor reads the public aggregate', () => {
  it('returns the declared total and the solvency flag', () => {
    const { sim, total } = deploy(BOOK, ALICE, 5_000n);
    const [declared, solvent] = sim.auditorView();
    expect(declared).toBe(total);
    expect(declared).toBe(3_507n);
    expect(solvent).toBe(true);
  });

  it('tracks the aggregate across republication', () => {
    const { sim } = deploy(BOOK, ALICE);
    const shrunk = buildLiabilities([ALICE]);
    sim.publishSolvency(shrunk.root, shrunk.total, shrunk.total);

    const [declared, solvent] = sim.auditorView();
    expect(declared).toBe(ALICE.balance);
    expect(solvent).toBe(true);
  });
});
