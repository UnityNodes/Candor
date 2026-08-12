// Customer-side verification.
//
// Everything a customer needs to answer "am I covered?" is already in their
// hands: their own (secret, balance), the Merkle path the issuer gave them, and
// the two numbers the issuer published. Folding those together is a millisecond
// of hashing — no transaction, no wallet, no proof, no trace.
//
// The on-chain `verify_inclusion` circuit does the same arithmetic, but its
// purpose is different: see `explainModes()` at the bottom of this file.

import { hashLeaf } from './hash.js';
import { LiabilitiesTree } from './merkle-tree.js';
import type { Customer, HashHex, MerklePath } from './types.js';

/** The two public numbers the issuer publishes, as a customer reads them. */
export interface PublishedState {
  root: HashHex;
  declaredTotal: bigint;
}

export type Verdict =
  /** The leaf is under the published root and the published total is the tree's own. */
  | { status: 'covered' }
  /** The path folds correctly, but to a root the issuer is no longer publishing. */
  | { status: 'stale'; foldedRoot: HashHex }
  /** The path folds to the current root's shape but the issuer's total disagrees. */
  | { status: 'total-mismatch'; treeTotal: bigint; declaredTotal: bigint }
  /** The customer is not under the published root at all. */
  | { status: 'not-included' };

/**
 * Answers the customer's question offline.
 *
 * Distinguishes the three failure modes the on-chain circuit collapses into a
 * revert plus a boolean, because a customer needs to act differently on each:
 * refetch, raise the alarm about the aggregate, or raise the alarm about
 * themselves.
 */
export function verifyLocally(
  customer: Customer,
  path: MerklePath,
  published: PublishedState,
): Verdict {
  const leaf = { hash: hashLeaf(customer.secret, customer.balance), sum: customer.balance };
  const folded = LiabilitiesTree.rootFromPath(leaf, path);

  if (folded.hash === published.root) {
    return folded.sum === published.declaredTotal
      ? { status: 'covered' }
      : {
          status: 'total-mismatch',
          treeTotal: folded.sum,
          declaredTotal: published.declaredTotal,
        };
  }

  // The customer cannot tell from the fold alone whether the issuer moved on or
  // dropped them. The client resolves it by re-reading the root: if it changed
  // since the path was issued, refetch; if not, this is a genuine omission.
  return { status: 'not-included' };
}

/**
 * Why both paths exist.
 *
 * Local: instant, free, private, leaves nothing behind. This is the routine
 * check, and it is what a customer should do every time.
 *
 * On-chain: costs a transaction and tens of seconds of proving, and is visible
 * to observers. What it buys is a record — a proof, anchored at a block, that
 * someone holding a valid path was answered. That is evidence a customer can
 * point a regulator or a court at, which a local check can never be.
 */
export const VERIFICATION_MODES = {
  local: 'routine, instant, private',
  onChain: 'evidence, slow, public',
} as const;
