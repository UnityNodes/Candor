// Off-chain liabilities tree. The issuer builds this over its customer records,
// publishes the root via publish_solvency, and hands each customer the Merkle
// path that lets them run verify_inclusion privately.
//
// Structure follows midnight-allowlist's sparse tree (zero-hashes for empty
// subtrees) at depth 8 instead of 20, with (secret, balance) leaves.

import { computeZeroHashes, hashLeaf, hashNode } from './hash.js';
import { TREE_CAPACITY, TREE_DEPTH } from './types.js';
import type { Customer, HashHex, MerklePath, MerkleTreeData } from './types.js';

export class LiabilitiesTree {
  readonly depth: number;
  private leaves: HashHex[] = [];
  /** layers[level].get(index) — only populated nodes are stored */
  private layers: Map<number, HashHex>[] = [];
  private zeroHashes: HashHex[];

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.zeroHashes = computeZeroHashes(depth);
    this.layers = Array.from({ length: depth + 1 }, () => new Map());
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  get capacity(): number {
    return 2 ** this.depth;
  }

  get root(): HashHex {
    return this.getNode(this.depth, 0);
  }

  private getNode(level: number, index: number): HashHex {
    return this.layers[level].get(index) ?? this.zeroHashes[level];
  }

  /** Inserts a precomputed leaf and refreshes the path to the root. */
  insertLeaf(leaf: HashHex): number {
    if (this.leaves.length >= this.capacity) {
      throw new Error(`tree is full (capacity ${this.capacity})`);
    }

    const leafIndex = this.leaves.length;
    this.leaves.push(leaf);
    this.layers[0].set(leafIndex, leaf);

    let index = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const parent = Math.floor(index / 2);
      const left = this.getNode(level, parent * 2);
      const right = this.getNode(level, parent * 2 + 1);
      this.layers[level + 1].set(parent, hashNode(left, right));
      index = parent;
    }

    return leafIndex;
  }

  addCustomer(customer: Customer): number {
    return this.insertLeaf(hashLeaf(customer.secret, customer.balance));
  }

  /**
   * Witness data for verify_inclusion: the sibling at each level plus whether
   * the proven node sits on the right at that level.
   */
  getPath(leafIndex: number): MerklePath {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`leaf index ${leafIndex} out of range [0, ${this.leaves.length - 1}]`);
    }

    const siblings: HashHex[] = [];
    const indices: boolean[] = [];

    let index = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const isRight = index % 2 === 1;
      indices.push(isRight);
      siblings.push(this.getNode(level, isRight ? index - 1 : index + 1));
      index = Math.floor(index / 2);
    }

    return { siblings, indices };
  }

  /** Same fold the circuit performs, for local checks before proving. */
  static rootFromPath(leaf: HashHex, path: MerklePath): HashHex {
    let node = leaf;
    for (let level = 0; level < path.siblings.length; level++) {
      node = path.indices[level]
        ? hashNode(path.siblings[level], node)
        : hashNode(node, path.siblings[level]);
    }
    return node;
  }

  findLeafIndex(customer: Customer): number {
    return this.leaves.indexOf(hashLeaf(customer.secret, customer.balance));
  }

  toJSON(): MerkleTreeData {
    return { depth: this.depth, leaves: [...this.leaves], root: this.root };
  }

  static fromJSON(data: MerkleTreeData): LiabilitiesTree {
    const tree = new LiabilitiesTree(data.depth);
    for (const leaf of data.leaves) tree.insertLeaf(leaf);
    return tree;
  }
}

/**
 * Builds the tree the issuer publishes, plus the aggregate it declares.
 *
 * The total is summed here rather than folded into the tree: Wave 1 proves
 * membership only, so nothing on-chain ties declared_liabilities to the leaves.
 * Merkle-SUM closes that gap in Wave 2.
 */
export function buildLiabilities(customers: Customer[], depth: number = TREE_DEPTH): {
  tree: LiabilitiesTree;
  root: HashHex;
  total: bigint;
} {
  if (customers.length > 2 ** depth) {
    throw new Error(`${customers.length} customers exceeds depth-${depth} capacity of ${2 ** depth}`);
  }

  const tree = new LiabilitiesTree(depth);
  let total = 0n;
  for (const customer of customers) {
    tree.addCustomer(customer);
    total += customer.balance;
  }

  if (total > 0xffffffffffffffffn) {
    throw new Error(`total liabilities ${total} exceeds Uint<64>`);
  }

  return { tree, root: tree.root, total };
}

export { TREE_CAPACITY, TREE_DEPTH };
