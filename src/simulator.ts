// Minimal in-process harness around the *compiled* Candor contract.
//
// It threads CircuitContext by hand rather than pulling in a simulator package,
// so the tests exercise the real generated circuits — not a TypeScript
// re-implementation of them.

import {
  createCircuitContext,
  createConstructorContext,
  dummyContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type Ledger,
} from '../contract/src/managed/candor/contract/index.js';
import { issuerCommitment } from './hash.js';
import type { MerklePath } from './types.js';

const CALLER = '0'.repeat(64);

/**
 * Demo issuer credential. Real deployments generate this once and keep it off
 * the machine that serves customers — it is the only thing that can republish.
 */
export const DEMO_ISSUER_SECRET = 'ee'.repeat(32);
export const DEFAULT_ISSUER_COMMITMENT = issuerCommitment(DEMO_ISSUER_SECRET);

/** Everything the customer keeps off-chain to prove their own inclusion. */
export type CandorPrivateState = {
  /** Issuer credential. Customers hold zeros here and cannot publish. */
  readonly issuerSecret: Uint8Array;
  readonly secret: Uint8Array;
  readonly balance: bigint;
  readonly siblings: Uint8Array[];
  readonly siblingSums: bigint[];
  readonly indices: boolean[];
};

export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** Builds the private state a customer feeds to verify_inclusion. */
export function privateStateFor(
  secretHex: string,
  balance: bigint,
  path: MerklePath,
): CandorPrivateState {
  return {
    issuerSecret: new Uint8Array(32),
    secret: hexToBytes(secretHex),
    balance,
    siblings: path.siblings.map(hexToBytes),
    siblingSums: [...path.siblingSums],
    indices: [...path.indices],
  };
}

export const witnesses = {
  issuer_secret: ({
    privateState,
  }: WitnessContext<Ledger, CandorPrivateState>): [CandorPrivateState, Uint8Array] => [
    privateState,
    privateState.issuerSecret,
  ],
  customer_secret: ({
    privateState,
  }: WitnessContext<Ledger, CandorPrivateState>): [CandorPrivateState, Uint8Array] => [
    privateState,
    privateState.secret,
  ],
  customer_balance: ({
    privateState,
  }: WitnessContext<Ledger, CandorPrivateState>): [CandorPrivateState, bigint] => [
    privateState,
    privateState.balance,
  ],
  merkle_siblings: ({
    privateState,
  }: WitnessContext<Ledger, CandorPrivateState>): [CandorPrivateState, Uint8Array[]] => [
    privateState,
    privateState.siblings,
  ],
  merkle_sibling_sums: ({
    privateState,
  }: WitnessContext<Ledger, CandorPrivateState>): [CandorPrivateState, bigint[]] => [
    privateState,
    privateState.siblingSums,
  ],
  merkle_indices: ({
    privateState,
  }: WitnessContext<Ledger, CandorPrivateState>): [CandorPrivateState, boolean[]] => [
    privateState,
    privateState.indices,
  ],
};

export class CandorSimulator {
  private readonly contract: Contract<CandorPrivateState>;
  private context: CircuitContext<CandorPrivateState>;

  constructor(privateState: CandorPrivateState, issuerCommitmentHex: string = DEFAULT_ISSUER_COMMITMENT) {
    this.contract = new Contract<CandorPrivateState>(witnesses);
    const initial = this.contract.initialState(
      createConstructorContext(privateState, CALLER),
      hexToBytes(issuerCommitmentHex),
    );
    this.context = createCircuitContext(
      dummyContractAddress(),
      CALLER,
      initial.currentContractState,
      initial.currentPrivateState,
    );
  }

  /** Hands the simulator the issuer credential so it can publish. */
  asIssuer(secretHex: string = DEMO_ISSUER_SECRET): this {
    this.context = {
      ...this.context,
      currentPrivateState: { ...this.context.currentPrivateState, issuerSecret: hexToBytes(secretHex) },
    };
    return this;
  }

  /** Swaps in another customer's private state against the same published root. */
  asCustomer(privateState: CandorPrivateState): this {
    this.context = { ...this.context, currentPrivateState: privateState };
    return this;
  }

  /** Publishes as the issuer. Use publishAs() to exercise an unauthorised caller. */
  publishSolvency(rootHex: string, total: bigint, reserves: bigint): void {
    this.asIssuer();
    const { context } = this.contract.impureCircuits.publish_solvency(
      this.context,
      hexToBytes(rootHex),
      total,
      reserves,
    );
    this.context = context;
  }

  /** Publishes with an arbitrary credential — used to prove the gate actually holds. */
  publishAs(issuerSecretHex: string, rootHex: string, total: bigint, reserves: bigint): void {
    this.asIssuer(issuerSecretHex);
    const { context } = this.contract.impureCircuits.publish_solvency(
      this.context,
      hexToBytes(rootHex),
      total,
      reserves,
    );
    this.context = context;
  }

  verifyInclusion(): boolean {
    const { result, context } = this.contract.impureCircuits.verify_inclusion(this.context);
    this.context = context;
    return result;
  }

  auditorView(): [bigint, boolean] {
    const { result, context } = this.contract.impureCircuits.auditor_view(this.context);
    this.context = context;
    return result;
  }

  getLedger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }
}
