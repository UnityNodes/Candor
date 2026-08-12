// Deploys Candor to a local Midnight devnet and drives it with real ZK proofs.
//
// Unlike `npm run demo`, which runs the compiled circuits in-process, this goes
// through the full pipeline: build -> prove (proof server) -> balance -> submit
// -> finalize on-chain. Expect tens of seconds per transaction.
//
// Requires `docker compose -f devnet.yml up -d` and a compiled contract.

import WebSocket from 'ws';
(globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

import { Buffer } from 'node:buffer';
import * as Rx from 'rxjs';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { HDWallet, Roles } from '@midnight-ntwrk/wallet-sdk-hd';
import {
  WalletFacade,
  WalletEntrySchema,
  type DefaultConfiguration,
} from '@midnight-ntwrk/wallet-sdk-facade';
import { ShieldedWallet } from '@midnight-ntwrk/wallet-sdk-shielded';
import { UnshieldedWallet, createKeystore, PublicKey } from '@midnight-ntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnight-ntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage } from '@midnight-ntwrk/wallet-sdk-abstractions';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

import { Contract, ledger as readLedger } from '../contract/src/managed/candor/contract/index.js';
import {
  witnesses,
  privateStateFor,
  hexToBytes,
  DEMO_ISSUER_SECRET,
  DEFAULT_ISSUER_COMMITMENT,
  type CandorPrivateState,
} from './simulator.js';
import { buildLiabilities } from './merkle-tree.js';
import type { Customer } from './types.js';

const DEVNET = {
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
  networkId: 'undeployed' as const,
};

/** The dev preset pre-mints NIGHT to the wallet derived from this seed. */
const GENESIS_SEED_HEX = '0'.repeat(63) + '1';

const ZK_CONFIG_PATH = new URL('../contract/src/managed/candor', import.meta.url).pathname;

const BOOK: Array<Customer & { name: string }> = [
  { name: 'Alice', secret: '11'.repeat(32), balance: 1_400_000n },
  { name: 'Bob', secret: '22'.repeat(32), balance: 320_500n },
  { name: 'Carol', secret: '33'.repeat(32), balance: 78_000n },
];
const ATTESTED_RESERVES = 2_000_000n;

const t0 = Date.now();
const log = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s] ${msg}`);

async function buildWallet() {
  const hd = HDWallet.fromSeed(Buffer.from(GENESIS_SEED_HEX, 'hex'));
  if (hd.type !== 'seedOk') throw new Error(`HDWallet.fromSeed: ${hd.type}`);

  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust] as const)
    .deriveKeysAt(0);
  if (derived.type !== 'keysDerived') throw new Error(`deriveKeysAt: ${derived.type}`);
  hd.hdWallet.clear();

  const keys = derived.keys as Record<number, Uint8Array>;
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore = createKeystore(keys[Roles.NightExternal], DEVNET.networkId);

  const configuration: DefaultConfiguration = {
    networkId: DEVNET.networkId,
    // An idle devnet computes a zero fee, which the node rejects as NotNormalized.
    costParameters: { feeBlocksMargin: 5, additionalFeeOverhead: 1_000_000n },
    relayURL: new URL(DEVNET.node),
    provingServerUrl: new URL(DEVNET.proofServer),
    indexerClientConnection: {
      indexerHttpUrl: DEVNET.indexer,
      indexerWsUrl: DEVNET.indexerWS,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema),
  };

  const facade = await WalletFacade.init({
    configuration,
    shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
    unshielded: (cfg) => UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
    dust: (cfg) =>
      DustWallet(cfg).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
  });

  await facade.start(shieldedSecretKeys, dustSecretKey);
  const state = await facade.waitForSyncedState();
  return { facade, shieldedSecretKeys, dustSecretKey, keystore, state };
}

async function createProviders(w: Awaited<ReturnType<typeof buildWallet>>) {
  const state = await Rx.firstValueFrom(w.facade.state().pipe(Rx.filter((s) => s.isSynced)));

  const walletProvider = {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx: unknown, ttl?: Date) {
      const recipe = await w.facade.balanceUnboundTransaction(
        tx as never,
        { shieldedSecretKeys: w.shieldedSecretKeys, dustSecretKey: w.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return await w.facade.finalizeRecipe(recipe);
    },
    submitTx: (tx: unknown) => w.facade.submitTransaction(tx as never),
  };

  const zkConfigProvider = new NodeZkConfigProvider(ZK_CONFIG_PATH);

  // The LevelDB private-state store is encrypted at rest. This is a throwaway
  // local devnet store, so a dev default is fine — override for anything real.
  const storagePassword = process.env.CANDOR_PRIVATE_STORE_PASSWORD ?? 'Candor-Local-Devnet-Store-1';

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'candor-private-state',
      accountId: 'candor-devnet',
      privateStoragePasswordProvider: () => storagePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(DEVNET.indexer, DEVNET.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(DEVNET.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function main() {
  setNetworkId(DEVNET.networkId);

  log('deriving genesis wallet…');
  const w = await buildWallet();
  const night = w.state.unshielded.balances[ledger.nativeToken().raw] ?? 0n;
  log(`wallet synced — NIGHT balance ${night}`);
  if (night === 0n) throw new Error('genesis wallet is empty; is the devnet the dev preset?');

  log('wiring providers…');
  const providers = await createProviders(w);

  const published = buildLiabilities(BOOK);
  // One process plays both roles here, so it carries the issuer credential too.
  const alice: CandorPrivateState = {
    ...privateStateFor(BOOK[0].secret, BOOK[0].balance, published.tree.getPath(0)),
    issuerSecret: hexToBytes(DEMO_ISSUER_SECRET),
  };

  const compiled = CompiledContract.make('candor', Contract).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH),
  );

  log('deploying contract (generates ZK proof — this is the slow part)…');
  const deployed = await deployContract(providers as never, {
    compiledContract: compiled,
    privateStateId: 'candor',
    initialPrivateState: alice,
    // The constructor pins the issuer credential at deployment.
    args: [hexToBytes(DEFAULT_ISSUER_COMMITMENT)],
  } as never);
  const address = (deployed as { deployTxData: { public: { contractAddress: string } } }).deployTxData.public
    .contractAddress;
  log(`deployed at ${address}`);

  log(`publish_solvency(root, ${published.total}, ${ATTESTED_RESERVES})…`);
  const publishTx = await (deployed as never as {
    callTx: { publish_solvency: (r: Uint8Array, t: bigint, v: bigint) => Promise<{ public: { txId: string; blockHeight: number } }> };
  }).callTx.publish_solvency(
    Uint8Array.from(Buffer.from(published.root, 'hex')),
    published.total,
    ATTESTED_RESERVES,
  );
  log(`  tx ${publishTx.public.txId} @ block ${publishTx.public.blockHeight}`);

  const onChain = await providers.publicDataProvider.queryContractState(address);
  const state = readLedger(onChain!.data);
  log('on-chain ledger:');
  console.log(`         liabilities_root      ${Buffer.from(state.liabilities_root).toString('hex')}`);
  console.log(`         declared_liabilities  ${state.declared_liabilities}`);
  console.log(`         committed_reserves    ${state.committed_reserves}`);
  console.log(`         solvent               ${state.solvent}`);

  log('verify_inclusion() as Alice…');
  const verifyTx = await (deployed as never as {
    callTx: { verify_inclusion: (r: Uint8Array) => Promise<{ public: { txId: string; blockHeight: number } }> };
  }).callTx.verify_inclusion(Uint8Array.from(Buffer.from(published.root, 'hex')));
  log(`  tx ${verifyTx.public.txId} @ block ${verifyTx.public.blockHeight}`);

  log('done — contract deployed and exercised with real proofs on-chain');
  await w.facade.stop();
  process.exit(0);
}

main().catch(async (e) => {
  console.error('\nFAILED:', e?.message ?? e);
  if (e?.stack) console.error(e.stack.split('\n').slice(1, 6).join('\n'));
  process.exit(1);
});
