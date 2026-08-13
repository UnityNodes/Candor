// The domain, shared by every front end.
//
// Nothing here draws. It owns the demo book, the three things an exchange might
// publish, and the check itself — which runs against the same modules the tests
// and the contract's pure circuits are pinned to, so a page rendering this is
// rendering the circuit's arithmetic rather than a story about it.

import { buildLiabilities, LiabilitiesTree } from '../src/merkle-tree.js';
import { hashLeaf } from '../src/hash.js';
import { verifyLocally, type PublishedState, type Verdict } from '../src/verify.js';
import type { MerklePath } from '../src/types.js';
import type { FoldStep } from '../src/merkle-tree.js';
import { ATTESTED_RESERVES, DEMO_BOOK, type NamedCustomer } from '../src/book.js';

export type { NamedCustomer };

/** The same book the devnet run publishes, so a live check can actually land. */
export const BOOK = DEMO_BOOK;
export const RESERVES = ATTESTED_RESERVES;

export type ScenarioId = 'honest' | 'dropped' | 'shaved';

export interface Scenario {
  id: ScenarioId;
  label: string;
  note: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'honest',
    label: 'everyone',
    note: 'The exchange publishes everyone and declares what it really owes.',
  },
  {
    id: 'dropped',
    label: 'without Carol',
    note: 'The exchange republishes without Carol and declares 78,000 less. Nothing on chain looks wrong. Carol is the only one who finds out, and only because she looked.',
  },
  {
    id: 'shaved',
    label: 'a smaller total',
    note: 'Nobody is removed. The exchange simply declares half a million less than it owes. Every balance is hashed into the total, so the moment it understates the sum, everyone sees it.',
  },
];

export interface Publication {
  scenario: ScenarioId;
  published: PublishedState;
  reserves: bigint;
  solvent: boolean;
  /** The book the exchange actually published — where fresh paths come from. */
  listed: NamedCustomer[];
}

export function publish(scenario: ScenarioId): Publication {
  const listed = scenario === 'dropped' ? BOOK.filter((c) => c.name !== 'Carol') : BOOK;
  const { root, total } = buildLiabilities(listed);
  const declared = scenario === 'shaved' ? total - 500_000n : total;
  return {
    scenario,
    published: { root, declaredTotal: declared },
    reserves: RESERVES,
    solvent: RESERVES >= declared,
    listed,
  };
}

/**
 * The path a customer holds. Someone still listed gets a fresh one each time the
 * exchange republishes; someone dropped keeps the path they were last given.
 */
export function pathFor(customer: NamedCustomer, pub: Publication): MerklePath {
  const source = pub.listed.some((c) => c.name === customer.name) ? pub.listed : BOOK;
  const { tree } = buildLiabilities(source);
  return tree.getPath(tree.findLeafIndex(customer));
}

/** Where this customer sits in the book the exchange published. */
export function indexOf(customer: NamedCustomer, pub: Publication): number {
  const listed = pub.listed.findIndex((c) => c.name === customer.name);
  return listed >= 0 ? listed : BOOK.findIndex((c) => c.name === customer.name);
}

export interface Outcome {
  verdict: Verdict;
  /** The real fold: index 0 is the leaf, index 8 the root. */
  trace: FoldStep[];
  path: MerklePath;
  leafIndex: number;
  occupied: number;
  rootMatches: boolean;
  treeTotal: bigint;
  /** How long the check itself took, in milliseconds. */
  ms: number;
}

export function check(customer: NamedCustomer, pub: Publication): Outcome {
  const path = pathFor(customer, pub);

  const t0 = performance.now();
  const verdict = verifyLocally(customer, path, pub.published);
  const ms = performance.now() - t0;

  const leaf = { hash: hashLeaf(customer.secret, customer.balance), sum: customer.balance };
  const trace = LiabilitiesTree.foldTrace(leaf, path);

  return {
    verdict,
    trace,
    path,
    leafIndex: Math.max(indexOf(customer, pub), 0),
    occupied: pub.listed.length,
    rootMatches: trace[trace.length - 1].node.hash === pub.published.root,
    treeTotal: trace[trace.length - 1].node.sum,
    ms,
  };
}

export const money = (n: bigint) => n.toLocaleString('en-US');
export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-8)}`;

export type { Verdict, FoldStep, PublishedState };
