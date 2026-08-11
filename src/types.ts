/** Merkle depth — must equal TREE_DEPTH in contract/src/candor.compact */
export const TREE_DEPTH = 8;

/** Number of customer slots the tree holds at TREE_DEPTH */
export const TREE_CAPACITY = 2 ** TREE_DEPTH;

/** A 32-byte hash, hex-encoded without prefix */
export type HashHex = string;

/** One customer's private record, held by the issuer off-chain */
export interface Customer {
  /** 32-byte secret, hex. Shared with that customer only. */
  secret: HashHex;
  balance: bigint;
}

/** Witness data for verify_inclusion — mirrors the circuit's witness signature */
export interface MerklePath {
  /** Sibling at each level, leaf -> root */
  siblings: HashHex[];
  /** true when the proven node is the RIGHT child at that level */
  indices: boolean[];
}

/** Serializable tree snapshot */
export interface MerkleTreeData {
  depth: number;
  leaves: HashHex[];
  root: HashHex;
}
