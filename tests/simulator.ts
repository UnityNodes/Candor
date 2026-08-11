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
import type { MerklePath } from '../src/types.js';

const CALLER = '0'.repeat(64);

/** Everything the customer keeps off-chain to prove their own inclusion. */
export type CandorPrivateState = {
  readonly secret: Uint8Array;
  readonly balance: bigint;
  readonly siblings: Uint8Array[];
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
    secret: hexToBytes(secretHex),
    balance,
    siblings: path.siblings.map(hexToBytes),
    indices: [...path.indices],
  };
}

export const witnesses = {
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

  constructor(privateState: CandorPrivateState) {
    this.contract = new Contract<CandorPrivateState>(witnesses);
    const initial = this.contract.initialState(
      createConstructorContext(privateState, CALLER),
    );
    this.context = createCircuitContext(
      dummyContractAddress(),
      CALLER,
      initial.currentContractState,
      initial.currentPrivateState,
    );
  }

  /** Swaps in another customer's private state against the same published root. */
  asCustomer(privateState: CandorPrivateState): this {
    this.context = { ...this.context, currentPrivateState: privateState };
    return this;
  }

  publishSolvency(rootHex: string, total: bigint, reserves: bigint): void {
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
