// Reading the contract's public ledger, from the browser.
//
// The page can compute the whole check on its own — that is the product. But
// "connects to the contract as part of a functional end-to-end experience" is
// a different claim, and the only honest way to make it is to actually read
// state a Midnight node is holding, not a number this tab made up.
//
// So: when a devnet is reachable, the four public fields come off the real
// ledger and the page says so. When it is not, the page falls back to the
// built-in demo book and says that instead. The private side never comes from
// anywhere in either case — that is the one thing this page cannot do for you.
//
// This talks to the indexer with a bare GraphQL POST rather than
// `@midnight-ntwrk/midnight-js-indexer-public-data-provider`. That package is
// built for a full wallet app — Apollo, graphql-ws, and a static import of
// `@midnight-ntwrk/ledger-v8` for zswap/transaction decoding — and pulls in
// its ~10MB wasm even though a plain state read never touches any of it.
// Decoding the state itself needs only `ContractState.deserialize()` from
// `@midnight-ntwrk/onchain-runtime-v3`, which the page already carries at
// ~1.4MB because the check itself runs on the same wasm. Verified against a
// real local deploy: the hex this fetch returns decodes to the exact four
// values `readLedger()` printed on the Node side moments after publishing.

import { ContractState } from '@midnight-ntwrk/onchain-runtime-v3';
import { ledger as readLedger } from '../contract/src/managed/candor/contract/index.js';
import type { PublishedState } from '../src/verify.js';

export interface ChainConfig {
  contract: string;
  indexer: string;
  networkId: string;
  /** ISO timestamp from the deploying run, for the "as of" line. */
  deployedAt?: string;
}

export interface OnChain {
  published: PublishedState;
  reserves: bigint;
  solvent: boolean;
  contract: string;
  networkId: string;
  deployedAt?: string;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

// The latest action on the contract, whatever kind it was. Omitting `offset`
// asks the indexer for the current tip rather than one particular block —
// confirmed against a live deploy-then-call sequence, where it correctly
// returns the state as of the *second* transaction, not the first.
const STATE_QUERY = `
  query CandorContractState($address: HexEncoded!) {
    contractAction(address: $address) {
      __typename
      ... on ContractDeploy { state }
      ... on ContractCall { state }
      ... on ContractUpdate { state }
    }
  }
`;

/**
 * Where to look, in order of how deliberate the choice is: an address pasted
 * into the URL beats the file the last `npm run devnet` wrote.
 */
export async function findChainConfig(): Promise<ChainConfig | null> {
  const params = new URLSearchParams(location.search);
  const contract = params.get('contract');
  if (contract) {
    return {
      contract,
      indexer: params.get('indexer') ?? 'http://127.0.0.1:8088/api/v4/graphql',
      networkId: params.get('networkId') ?? 'undeployed',
    };
  }

  try {
    const res = await fetch('/chain.json', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ChainConfig;
  } catch {
    // No file, no dev server, or a production host with nothing to serve it.
    // Not an error — the page works fine without it.
    return null;
  }
}

/**
 * Reads the four public fields the contract keeps. Returns null rather than
 * throwing: a demo page that breaks because a local node is down is worse
 * than one that quietly falls back to showing its own simulation.
 */
export async function readChain(config: ChainConfig): Promise<OnChain | null> {
  try {
    const res = await fetch(config.indexer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: STATE_QUERY, variables: { address: config.contract } }),
    });
    if (!res.ok) return null;

    const { data, errors } = (await res.json()) as {
      data?: { contractAction: { state: string } | null };
      errors?: unknown[];
    };
    if (errors?.length || !data?.contractAction) return null;

    const state = ContractState.deserialize(fromHex(data.contractAction.state));
    const led = readLedger(state.data);

    return {
      published: { root: toHex(led.liabilities_root), declaredTotal: led.declared_liabilities },
      reserves: led.committed_reserves,
      solvent: led.solvent,
      contract: config.contract,
      networkId: config.networkId,
      deployedAt: config.deployedAt,
    };
  } catch {
    return null;
  }
}
