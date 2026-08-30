<p align="center">
  <img src="brand/banner.svg" alt="Candor — prove it. reveal nothing." width="720">
</p>

# Candor

**Privacy-preserving proof-of-liabilities on [Midnight](https://midnight.network).**

An exchange or asset issuer proves on-chain that its reserves cover all customer liabilities, and
each customer privately verifies that their own balance is included in the total. Nothing
per-customer is written on chain: no names, no addresses, no amounts. An auditor reads only the
aggregate.

Built for the **Midnight Buildathon** (AKINDO WaveHack).

## How it works (three roles)

- **Issuer** — builds a Merkle-sum tree of customer balances and publishes `liabilities_root`,
  `declared_liabilities`, and `committed_reserves`. The contract asserts `reserves >= liabilities`
  and discloses only a `SOLVENT` boolean. Publishing is gated: the constructor derives a commitment
  from the deployer's own secret, and every publication proves knowledge of it in zero knowledge, so
  no one else can overwrite the published state.
- **Customer** — privately proves that their `(id, balance)` is a leaf under the published root *and*
  that the published total is the one the tree commits to. The balance itself is never revealed.
- **Auditor** — reads the public aggregate (`declared_liabilities`, `solvent`); nothing per-customer.

## Midnight integration

- Written in **Compact**, Midnight's privacy-enabled smart-contract language.
- **Dual-ledger:** public state (root, aggregate, solvency flag) vs. private witness (customer secret,
  balance, Merkle path). `disclose()` explicitly gates what leaves the private domain.
- **Private-by-default:** customer ids and balances stay in the witness; only the boolean solvency
  result and the aggregate become public.

## Scope & honesty about simplifications

- **[real]** Liabilities-side Merkle tree + private customer inclusion + selective disclosure — the core ZK work.
- **[simplified]** Reserves are an **attested/committed number** — proving on-chain control of reserve
  addresses is out of scope for a Compact circuit, and we say so plainly.
- **[real]** The tree is a Merkle-**sum** tree: every node hashes its subtotal alongside its children, so `declared_liabilities` is bound to the leaves. Restating the total moves the root, and every customer's check catches it.
- Inclusion lets a customer **detect** their own omission; it does not make omission impossible.
- **[known leak]** Merkle-sum has a cost, and we would rather state it than have it found. To fold
  their path, a customer receives the subtotal of each sibling subtree — and at the leaf level that
  sibling is a single other customer, whose balance they therefore learn exactly. Higher levels leak
  group aggregates. This is the problem DAPOL+ (eprint 2020/468) exists to solve, with blinded
  commitments and range proofs; doing it properly is a later wave. Until then: nothing leaks
  on-chain or to the public, but a customer holding a path learns something about their neighbours.
- **[deliberate]** No wallet connector in the customer page. The local check is a computation, not a
  transaction — there is nothing to sign and nothing to submit. A wallet only becomes relevant for
  the on-chain `verify_inclusion` record, which `npm run devnet` already demonstrates against a real
  deploy; wiring that same call to a browser wallet is future work, not a gap in this one.

**Roadmap:** W1 single-issuer Merkle-sum tree, solvency boolean and the browser verification page ·
W2 tree updates and revocation · W3 cross-custodian nullifier.

## Repository structure

```
contract/src/candor.compact   the contract; `managed/` output lands beside it
src/                          off-chain code the issuer and customers run
  hash.ts                       persistentHash wrappers mirroring the circuit
  merkle-tree.ts                depth-8 Merkle-sum tree + path extraction
  verify.ts                     the customer's offline check
  simulator.ts                  in-process CircuitContext harness
  devnet.ts                     deploy and drive it on a real network
  demo.ts                       end-to-end walkthrough of all three roles
ui/                           the customer's page — runs the check in the browser
tests/                        inclusion / omission / solvency / aggregate
brand/                        logo & icon assets (PNG + SVG)
```

The Merkle depth is fixed at compile time — 8 levels, so 256 customer slots. Each node carries the
total of its subtree and hashes it in, which is what binds the published figure to the leaves: an
issuer holding an honest root cannot quietly declare a smaller number.

The off-chain builder in `src/` must hash identically to the circuit; `tests/candor.test.ts` pins the
two against each other via the contract's own `pure` circuits, because a one-byte divergence would
make every legitimate customer read as omitted.

### Two ways to check, and when each is worth it

A customer holds everything needed to answer "am I covered?": their own secret and balance, the
Merkle path the issuer gave them, and the two numbers the issuer published. Folding those together
is about a millisecond of hashing. No transaction, no wallet, no proving, and no trace — nobody
learns that the check happened, let alone how it came out. `verifyLocally()` in `src/verify.ts` does
exactly this, and the test suite pins it against the compiled circuit so the two can never disagree.

Calling `verify_inclusion` on chain runs the same arithmetic, but costs a transaction and tens of
seconds of proving, and is visible to observers. What it buys is a **record**: a proof anchored at a
block that someone holding a valid path was answered. That is evidence a customer can put in front
of a regulator or a court. A local check convinces only the person running it.

So the routine answer is instant and private, and the on-chain call is what you reach for when you
need to prove to someone else that you asked.

`npm run ui` serves that first path as a page. It has no backend, and the check itself makes no
network call: the same `src/` modules the tests pin against the circuit are bundled into the
browser, where `compact-runtime` resolves to its WebAssembly build. The published root you see is
hashed on your own machine, and switching between an honest publication, a dropped customer and an
understated total re-derives everything locally in well under a millisecond. The page can also
optionally read a live chain — see below — but nothing about the check itself requires it.

### Telling a stale path apart from being dropped

`verify_inclusion` takes the root the caller built its path against and reverts if the ledger has
moved on. That distinction matters more here than it first looks.

Proving takes tens of seconds. If the issuer republishes in that window — say because another
customer joined — a path built a moment earlier no longer folds to the current root, and a customer
who is perfectly well included would be told they are not. On a solvency product that is not a
cosmetic bug: a false alarm either starts a panic or teaches people to ignore the alarm.

The obvious remedy is to accept recent roots as well, the way `HistoricMerkleTree` does. That would
be exactly wrong here — a customer who really was dropped would still verify against the root that
still listed them, which is the one thing this contract exists to catch. So a stale path reverts with
`stale root`, telling the client to refetch and retry, and only a mismatch against the *current* root
is reported as a red.

### Why not `merkleTreePathRoot`

The Compact standard library ships `merkleTreePathRoot` / `merkleTreePathRootNoLeafHash`, which
verify a witness path against a `MerkleTree` held in the ledger. Candor folds its own path instead,
for three reasons.

The stdlib helpers assume the tree lives on-chain and is checked with `tree.checkRoot()`. Candor
keeps the tree at the issuer and publishes only a root, so the number of customers and the shape of
each update stay off-chain. The on-chain type is also append-only, while an issuer republishes a
whole new tree each period rather than adding leaves to an old one.

Decisively, `merkleTreePathRoot` verifies membership and nothing else. Binding the declared total to
the leaves requires each node to hash its own subtotal, which that helper cannot express — so the
fold here is a requirement, not a preference.

### Where the native tree does fit

Ruling `HistoricMerkleTree` out for the liabilities tree did not rule it out of the contract — it
answers a different question the liabilities tree cannot.

`liabilities_root` is overwritten on every `publish_solvency` call, which is fine for "am I covered
right now" but useless for a later one: a customer who saved a path against last month's root, or a
regulator handed one after the fact, has no on-chain way to show that root was ever real once a
newer one has replaced it as current. `HistoricMerkleTree<8, Bytes<32>>` is built for exactly this —
inserting a new leaf never invalidates a membership proof for one already in the tree — so
`published_roots` records every root a publication has ever accepted, and `findPathForLeaf` on it
keeps answering for any of them no matter how many times the issuer republishes afterward. See
`tests/candor.test.ts`'s `published_roots outlives republication` and `npm run demo`'s step 4.

## Setup & how to evaluate

Before running anything, the gate conditions are each one command or one file away:

| Gate | Check it yourself |
|---|---|
| A Compact contract that compiles | `npm run compile` → `contract/src/candor.compact`, 3 circuits |
| Real Midnight functionality, not a fork | the Merkle-sum tree, dual-ledger, `disclose()` gating, and the native `HistoricMerkleTree` roots registry under "How it works" above |
| `midnightntwrk` topic | this repo's own GitHub topics |
| Apache-2.0, publicly available | [LICENSE](LICENSE) |
| Tests pass, against the compiled circuit | `npm test` → `tests/candor.test.ts`, 36/36 |

Requires Node.js ≥ 22.15 and the Compact toolchain.

1. Install the Compact developer tools, then fetch the compiler:
   ```bash
   curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
   ```
   ```bash
   compact update
   ```
2. Install dependencies and compile the contract:
   ```bash
   npm install && npm run compile
   ```
3. Run the test suite:
   ```bash
   npm test
   ```
4. Watch all three roles end to end:
   ```bash
   npm run demo
   ```
5. Open the customer's page:
   ```bash
   npm run ui
   ```

The demo walks an issuer publishing a root and four customers verifying privately, then two ways of
cheating and how each is caught. Drop one customer from the tree and she alone goes red. Keep every
customer but shave the declared total, and *everyone* goes red — that one is the Merkle-sum property
doing its work. It closes with the auditor's view and an insolvent publish being rejected by the
contract's own assert.

<p align="center">
  <img src="brand/demo.svg" alt="Candor Wave 1 demo — issuer publishes, customers verify, one is dropped and detects it" width="820">
</p>

Both the tests and the demo drive the **compiled** contract through `CircuitContext` in-process. They
exercise the real generated circuits rather than a TypeScript stand-in, but they do not generate ZK
proofs.

### Running it on a real network

For the full pipeline — build, prove, balance, submit, finalize — bring up a local devnet (node,
indexer, proof server) and deploy:

```bash
docker compose -f devnet.yml up -d
```
```bash
npm run devnet
```

That derives the dev-preset genesis wallet, deploys the contract, calls `publish_solvency`, reads the
resulting ledger back from the indexer, and calls `verify_inclusion` — every step with a real ZK
proof on chain. Proving dominates the wall clock: roughly 20 s for the deploy and 20–40 s per call.

`devnet.yml` binds all three services to `127.0.0.1` on purpose. The proof server sees private
witness data, and `docker -p` writes iptables rules that bypass ufw, so a bare `6300:6300` would
publish it on every interface of a public host.

`npm run devnet` needs Node.js >= 22 specifically: the wallet SDK's sync path calls
`Iterator.prototype.map()`, which Node only ships unflagged from 22 onward. Under an older Node the
failure is a silent, endlessly-retrying reconnect loop rather than a clean error, so the script
checks `process.versions.node` itself and fails immediately with an explanation if it is too old.

### The customer page reads this back

`npm run devnet` writes `ui/chain.json` — the deployed address and the indexer URL — right after
publishing. The next time `npm run ui` is opened, the page fetches that file, reads the four public
ledger fields straight off the indexer, and labels itself "Live — read moments ago from contract
`<address>`" instead of falling back to its own bundled demo book. A customer's own fold still runs
entirely on their machine either way; the only thing that changes is whether the root it has to land
on came from a real deploy or from the page's local simulation of one, and the page always says
which.

This is a bare GraphQL `fetch` against the indexer, not
`@midnight-ntwrk/midnight-js-indexer-public-data-provider` — that package is built for a full wallet
app and statically imports `@midnight-ntwrk/ledger-v8` for zswap/transaction decoding, which pulls
roughly 10 MB of wasm into the page for a feature that only ever reads four public integers.
Decoding the indexer's response needs nothing beyond `ContractState.deserialize()` from
`@midnight-ntwrk/onchain-runtime-v3`, ~1.4 MB, which the page already ships because the customer's
own check runs on that same wasm.

Development is supported on Linux/macOS.

## Ecosystem

Built entirely on the [Midnight](https://midnight.network) stack:
[Compact](https://docs.midnight.network/develop/reference/compact/) for the contract,
[compact-runtime](https://www.npmjs.com/package/@midnight-ntwrk/compact-runtime) and
[onchain-runtime](https://www.npmjs.com/package/@midnight-ntwrk/onchain-runtime-v3) to run the same
circuits in the browser as in the tests, the [wallet SDK](https://docs.midnight.network/develop/reference/midnight-api/wallet-sdk/)
family for the devnet deploy, and the standalone [indexer](https://github.com/midnightntwrk/midnight-indexer)
for the customer page's live-chain read. Local development used the
[`midnight-tooling`](https://github.com/midnightntwrk/midnight-local-dev) devnet generator and the
[Midnight Expert](https://docs.midnight.network/blog/migrating-to-kapa-and-midnight-expert) Claude Code
plugins.

## License

[Apache-2.0](LICENSE). The Midnight-related code developed for the Buildathon is released under Apache-2.0.
