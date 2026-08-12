// Off-chain mirror of the hashing done inside candor.compact.
//
// Every function here has a counterpart in the circuit and MUST stay byte-identical
// to it: same domain tag, same argument order, same integer encoding. A one-byte
// divergence makes every computed root disagree with the on-chain one, and
// verify_inclusion then returns false for legitimately included customers —
// which looks exactly like an omission but is a builder bug.
//
// Named hash.ts rather than poseidon.ts: Midnight's persistentHash is not Poseidon.

import * as runtime from '@midnight-ntwrk/compact-runtime';
import type { HashHex } from './types.js';

const bytes32 = new runtime.CompactTypeBytes(32);
const vector2 = new runtime.CompactTypeVector(2, bytes32);
const vector3 = new runtime.CompactTypeVector(3, bytes32);
const vector4 = new runtime.CompactTypeVector(4, bytes32);

/** Domain tags — must match the pad(32, "...") literals in candor.compact */
const TAG_LEAF = 'candor:leaf:v1';
/** v2: nodes carry a subtotal, so the node preimage gained a fourth element. */
const TAG_NODE = 'candor:node:v2';
/** Filler for unused slots. Builder-internal: the circuit only ever sees these as siblings. */
const TAG_EMPTY = 'candor:empty:v1';
/** Binds a publication to the issuer's credential. */
const TAG_ISSUER = 'candor:issuer:v1';

/** Compact's pad(32, s): UTF-8 bytes, right-padded with zeros to 32 bytes. */
function pad32(s: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(Buffer.from(s, 'utf-8').subarray(0, 32));
  return out;
}

function toBytes(hex: HashHex): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (!/^[0-9a-f]{64}$/i.test(clean)) {
    throw new Error(`expected 32-byte hex, got: ${hex}`);
  }
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}

function toHex(bytes: Uint8Array): HashHex {
  return Buffer.from(bytes).toString('hex');
}

/**
 * Compact's `balance as Field as Bytes<32>` — 32-byte little-endian.
 * Verified against compact-runtime's convertFieldToBytes.
 */
export function uintToBytes32(value: bigint): Uint8Array {
  if (value < 0n) throw new Error(`Uint<64> cannot be negative: ${value}`);
  if (value > 0xffffffffffffffffn) throw new Error(`exceeds Uint<64>: ${value}`);
  return runtime.convertFieldToBytes(32, value, 'candor:uintToBytes32');
}

/** leaf_of(secret, balance) — persistentHash(tag || secret || balance) */
export function hashLeaf(secretHex: HashHex, balance: bigint): HashHex {
  return toHex(
    runtime.persistentHash(vector3, [pad32(TAG_LEAF), toBytes(secretHex), uintToBytes32(balance)]),
  );
}

/**
 * issuer_commitment_of(secret) — what the contract stores at deployment and
 * re-derives on every publication.
 */
export function issuerCommitment(secretHex: HashHex): HashHex {
  return toHex(runtime.persistentHash(vector2, [pad32(TAG_ISSUER), toBytes(secretHex)]));
}

/** A Merkle-sum node: a hash plus the total its subtree commits to. */
export interface SumNode {
  hash: HashHex;
  sum: bigint;
}

/**
 * hash_level_node — persistentHash(tag || left.hash || right.hash || total),
 * where total = left.sum + right.sum. Binding the subtotal into the hash is
 * what stops an issuer restating sums under an otherwise honest root.
 */
export function hashNode(left: SumNode, right: SumNode): SumNode {
  const sum = left.sum + right.sum;
  if (sum > 0xffffffffffffffffn) {
    throw new Error(`subtree total ${sum} exceeds Uint<64>; the circuit would reject this tree`);
  }
  return {
    hash: toHex(
      runtime.persistentHash(vector4, [
        pad32(TAG_NODE),
        toBytes(left.hash),
        toBytes(right.hash),
        uintToBytes32(sum),
      ]),
    ),
    sum,
  };
}

/** Node used for slots with no customer in them: contributes nothing to the total. */
export function emptyLeaf(): SumNode {
  return {
    hash: toHex(runtime.persistentHash(vector2, [pad32(TAG_EMPTY), new Uint8Array(32)])),
    sum: 0n,
  };
}

/**
 * Empty subtree at each level, 0 = leaf level.
 * Lets the tree stay sparse: unused slots never need materializing.
 */
export function computeZeroNodes(depth: number): SumNode[] {
  const zeros: SumNode[] = [emptyLeaf()];
  for (let level = 1; level <= depth; level++) {
    zeros[level] = hashNode(zeros[level - 1], zeros[level - 1]);
  }
  return zeros;
}
