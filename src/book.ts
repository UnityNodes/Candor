// The demo book, in one place.
//
// It used to exist three times — in the in-process demo, in the devnet run and
// in the page — with different customers and different reserve figures. That
// made "end to end" impossible by construction: the root published on chain was
// the root of a different book than the one the page folds paths through, so a
// customer's climb could never land on it.
//
// Anything that publishes, proves against or draws this book reads it here.

import type { Customer } from './types.js';

export type NamedCustomer = Customer & { name: string };

export const DEMO_BOOK: NamedCustomer[] = [
  { name: 'Alice', secret: '11'.repeat(32), balance: 1_400_000n },
  { name: 'Bob', secret: '22'.repeat(32), balance: 320_500n },
  { name: 'Carol', secret: '33'.repeat(32), balance: 78_000n },
  { name: 'Dave', secret: '44'.repeat(32), balance: 5_200n },
];

/**
 * What the issuer says it holds. [MOCK] — the contract checks that this figure
 * covers the liabilities, and cannot check that the reserves exist. Chosen to
 * sit just above the book's total, so the solvency assert is doing real work
 * rather than passing by a mile.
 */
export const ATTESTED_RESERVES = 1_900_000n;
