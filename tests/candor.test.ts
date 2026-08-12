import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../contract/src/managed/candor/contract/index.js';
import { hashLeaf } from '../src/hash.js';
import { buildLiabilities, LiabilitiesTree } from '../src/merkle-tree.js';
import type { Customer } from '../src/types.js';
import { CandorSimulator, bytesToHex, hexToBytes, privateStateFor } from '../src/simulator.js';

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

  it('fold_merkle matches rootFromPath for every customer', () => {
    const { tree, root } = buildLiabilities(BOOK);
    for (const c of BOOK) {
      const path = tree.getPath(tree.findLeafIndex(c));
      const leaf = hexToBytes(hashLeaf(c.secret, c.balance));
      const fromCircuit = bytesToHex(
        pureCircuits.fold_merkle(leaf, path.siblings.map(hexToBytes), path.indices),
      );
      expect(fromCircuit).toBe(root);
      expect(fromCircuit).toBe(LiabilitiesTree.rootFromPath(hashLeaf(c.secret, c.balance), path));
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
    const { sim } = deploy(BOOK, ALICE);
    expect(Object.keys(sim.getLedger()).sort()).toEqual([
      'committed_reserves',
      'declared_liabilities',
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
