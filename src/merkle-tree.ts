// Off-chain liabilities tree. The issuer builds this over its customer records,
// publishes the root via publish_solvency, and hands each customer the Merkle
// path that lets them run verify_inclusion privately.
//
// This is a Merkle-SUM tree: every node carries the total of its subtree, and
// that total is hashed into the node. The root therefore commits to both the
// membership of the leaves and their sum, so a customer proving inclusion also
// proves that declared_liabilities is the real total.

import { computeZeroNodes, hashLeaf, hashNode, type SumNode } from './hash.js';
import { TREE_CAPACITY, TREE_DEPTH } from './types.js';
import type { Customer, HashHex, MerklePath, MerkleTreeData } from './types.js';

/** One rung of the climb: the node after combining, and the sibling consumed. */
export interface FoldStep {
  level: number;
  node: SumNode;
  /** null at the leaf, which combines with nothing. */
  sibling: SumNode | null;
  /** true when the proven node sat on the right and the sibling on the left. */
  onRight: boolean;
}

export class LiabilitiesTree {
  readonly depth: number;
  private leaves: SumNode[] = [];
  /** layers[level].get(index) — only populated nodes are stored */
  private layers: Map<number, SumNode>[] = [];
  private zeroNodes: SumNode[];

  constructor(depth: number = TREE_DEPTH) {
    this.depth = depth;
    this.zeroNodes = computeZeroNodes(depth);
    this.layers = Array.from({ length: depth + 1 }, () => new Map());
  }

  get leafCount(): number {
    return this.leaves.length;
  }

  get capacity(): number {
    return 2 ** this.depth;
  }

  get root(): HashHex {
    return this.getNode(this.depth, 0).hash;
  }

  /** The total the root commits to — must equal the issuer's declared liabilities. */
  get total(): bigint {
    return this.getNode(this.depth, 0).sum;
  }

  private getNode(level: number, index: number): SumNode {
    return this.layers[level].get(index) ?? this.zeroNodes[level];
  }

  /** Inserts a precomputed leaf and refreshes the path to the root. */
  insertLeaf(leaf: SumNode): number {
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
    return this.insertLeaf({
      hash: hashLeaf(customer.secret, customer.balance),
      sum: customer.balance,
    });
  }

  /**
   * Witness data for verify_inclusion: at each level, the sibling's hash and
   * subtotal, plus whether the proven node sits on the right.
   */
  getPath(leafIndex: number): MerklePath {
    if (leafIndex < 0 || leafIndex >= this.leaves.length) {
      throw new Error(`leaf index ${leafIndex} out of range [0, ${this.leaves.length - 1}]`);
    }

    const siblings: HashHex[] = [];
    const siblingSums: bigint[] = [];
    const indices: boolean[] = [];

    let index = leafIndex;
    for (let level = 0; level < this.depth; level++) {
      const isRight = index % 2 === 1;
      const sibling = this.getNode(level, isRight ? index - 1 : index + 1);
      indices.push(isRight);
      siblings.push(sibling.hash);
      siblingSums.push(sibling.sum);
      index = Math.floor(index / 2);
    }

    return { siblings, siblingSums, indices };
  }

  /** Same fold the circuit performs, for local checks before proving. */
  static rootFromPath(leaf: SumNode, path: MerklePath): SumNode {
    return LiabilitiesTree.foldTrace(leaf, path).at(-1)!.node;
  }

  /**
   * The fold, one level at a time.
   *
   * Same arithmetic as `rootFromPath` — it is implemented in terms of this — but
   * keeping the intermediate nodes lets a client show what the circuit does
   * rather than describe it. Index 0 is the leaf, index 8 the root.
   */
  static foldTrace(leaf: SumNode, path: MerklePath): FoldStep[] {
    const steps: FoldStep[] = [{ level: 0, node: leaf, sibling: null, onRight: false }];
    let node = leaf;

    for (let level = 0; level < path.siblings.length; level++) {
      const sibling: SumNode = { hash: path.siblings[level], sum: path.siblingSums[level] };
      const onRight = path.indices[level];
      node = onRight ? hashNode(sibling, node) : hashNode(node, sibling);
      steps.push({ level: level + 1, node, sibling, onRight });
    }

    return steps;
  }

  findLeafIndex(customer: Customer): number {
    const hash = hashLeaf(customer.secret, customer.balance);
    return this.leaves.findIndex((l) => l.hash === hash);
  }

  toJSON(): MerkleTreeData {
    return {
      depth: this.depth,
      leaves: this.leaves.map((l) => ({ hash: l.hash, sum: l.sum.toString() })),
      root: this.root,
      total: this.total.toString(),
    };
  }

  static fromJSON(data: MerkleTreeData): LiabilitiesTree {
    const tree = new LiabilitiesTree(data.depth);
    for (const leaf of data.leaves) tree.insertLeaf({ hash: leaf.hash, sum: BigInt(leaf.sum) });
    return tree;
  }
}

/**
 * Builds the tree the issuer publishes, plus the aggregate it declares.
 *
 * The total comes off the root rather than from a separate running sum: with a
 * Merkle-sum tree they are the same number by construction, and taking it from
 * the root is what keeps the published figure honest.
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
  for (const customer of customers) tree.addCustomer(customer);

  return { tree, root: tree.root, total: tree.total };
}

export { TREE_CAPACITY, TREE_DEPTH };
