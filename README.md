<p align="center">
  <img src="brand/png/candor-primary-dark-680.png" alt="Candor" width="340">
</p>

# Candor

**Privacy-preserving proof-of-liabilities on [Midnight](https://midnight.network).**

An exchange or asset issuer proves on-chain that its reserves cover all customer liabilities, and
each customer privately verifies that their own balance is included in the total — without revealing
amounts, addresses, or any other customer's balance. An auditor reads only the aggregate.

Built for the **Midnight Buildathon** (AKINDO WaveHack).

## How it works (three roles)

- **Issuer** — builds a Merkle tree of customer balances and publishes `liabilities_root`,
  `declared_liabilities`, and `committed_reserves`. The contract asserts `reserves >= liabilities`
  and discloses only a `SOLVENT` boolean.
- **Customer** — privately proves that their `(id, balance)` is a leaf under the published root, and
  sees a private green check. The balance itself is never revealed.
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
- **[simplified]** In Wave 1 the sum is computed off-chain; on-chain Merkle-sum consistency lands in Wave 2.
- Inclusion lets a customer **detect** their own omission; it does not make omission impossible.

**Roadmap:** W1 single-issuer tree + solvency boolean · W2 on-chain Merkle-sum + web UI · W3 cross-custodian nullifier.

## Repository structure

```
contract/   Compact contract (candor.compact) + generated api/
tests/      inclusion / omission / solvency / aggregate tests
brand/      logo & icon assets (PNG + SVG)
```

## Setup & how to evaluate

1. Install the Midnight toolchain (Compact developer tools) and run a proof server via Docker —
   see the [Midnight docs](https://docs.midnight.network/getting-started/installation).
2. Compile the contract:
   ```bash
   compact compile contract/src/candor.compact
   ```
3. Run the test suite (script name per generated `package.json`):
   ```bash
   npm test
   ```

Development is supported on Linux/macOS.

## License

[Apache-2.0](LICENSE). The Midnight-related code developed for the Buildathon is released under Apache-2.0.
