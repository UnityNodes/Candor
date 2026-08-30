# Security notes

A self-audit of `contract/src/candor.compact`, not a substitute for an external
one. Every claim below points at a test that fails if the claim stops being
true — this is a record of what was checked and how, not a list of assurances.

Simplifications the product makes on purpose — reserves being attested rather
than proven, the sibling-balance leak inherent to a Merkle-sum path, the
absence of a wallet connector — are already covered in the README's
[Scope & honesty](README.md#scope--honesty-about-simplifications) section and
aren't repeated here. This document is about the contract holding the
properties it claims to, not about what it deliberately doesn't attempt.

## Checked, with a test that would fail if it broke

| Property | Why it matters | Where |
|---|---|---|
| Only the deployer's credential can publish | Otherwise anyone could overwrite the root, the aggregate, or the solvency flag | `tests/candor.test.ts` — "publication is gated on the issuer credential" |
| A rejected publication leaves the ledger untouched | A failed attempt must not have side effects, including partial ones | same block — "leaves the ledger untouched after a rejected publication" |
| `reserves >= total` is enforced at the boundary, not approximately | An off-by-one here is the entire point of the contract | "T3 — solvency is enforced on publish" — short-by-one, exact-equal, and over-covered are each their own case |
| The declared total can't be understated *or* overstated | An issuer could otherwise round the aggregate either direction | "the declared total cannot be understated" |
| A stale path is never reported as a genuine omission, and vice versa | A false "you were dropped" alarm on a solvency product is not cosmetic | "a stale path is distinguished from being dropped" |
| No per-customer data reaches public ledger state | The whole premise is that balances stay private | "leaks nothing per-customer into public state" — asserts the exact key set, so a new leaky field fails loudly, not silently |
| A padding (unused) tree slot can't be forged into a false inclusion | A sibling Buildathon project's own design needed an explicit guard against exactly this; ours needed none, but that was a claim about domain-separated hashing, not yet a proven one | "a padding slot cannot be forged into inclusion" — confirmed to have teeth by temporarily collapsing the empty-leaf hash onto the real one and watching it fail |
| The leaf commitment binds both fields, not just their pair | Parity tests against the circuit still pass if both sides quietly drop the same field | "a leaf commitment binds both fields" — confirmed by temporarily dropping `balance` from the preimage and watching the right test (only that one) fail |
| Merkle-sum overflow aborts the proof rather than wrapping | A wrapped sum could make an insolvent book look small enough to pass | "the compiled circuit itself rejects a subtotal that overflows Uint\<64\>" — calls the real compiled `fold_merkle`, not just the off-chain mirror, which has its own separate guard that would otherwise mask this |
| A republished root never displaces an earlier one in `published_roots` | The entire reason the registry exists | "published_roots outlives republication" (deterministic) + the property test's arbitrary republication sequences |
| The liabilities tree refuses to build past its own depth capacity | Silent truncation would mean a customer past the boundary is quietly omitted, not rejected | "refuses to build a tree past its own depth capacity" |
| The above invariants hold across randomized books, not just the fixed cast | Hand-picked examples can only exercise shapes someone thought to type in | `tests/candor.property.test.ts` — inclusion, outsider-exclusion, the sum invariant, single-drop isolation, and total-tamper universality, each checked against ~100 random books per run |

## Considered, not test-covered — reasoned here instead

- **Reentrancy.** Compact circuits don't make calls into other contracts
  mid-execution the way EVM contracts do; there's no external call in
  `candor.compact` for anything to reenter through.
- **Front-running.** `publish_solvency` requires proving knowledge of the
  issuer's own secret — nobody else can construct a competing proof to race
  it. `verify_inclusion` writes no state, so there's nothing downstream to
  front-run either.
- **`published_roots` capacity (256).** Depth-8, same as the liabilities tree.
  Reaching it means 256 republications of the same deployed contract —
  unreachable at Wave 1 demo scale. Not defensively guarded, on the same
  reasoning the rest of this codebase applies: don't add handling for a
  scenario that can't occur here. Worth a real guard the moment the contract
  is meant to run long enough for it to become reachable.
- **Dependency supply chain.** `npm audit` on production dependencies: zero
  findings. Including dev dependencies: two moderate findings, both in
  `uuid`'s v3/v5/v6 generation via `vite-plugin-top-level-await` — a
  build-time-only Vite plugin, not shipped to the browser bundle or the
  deployed contract, and not called here with any attacker-influenced buffer
  argument. The suggested fix is a breaking downgrade of a plugin the build
  already depends on correctly; not worth trading a working build for a
  finding with no reachable path in this project's own usage.
- **Toolchain reproducibility.** Not a contract-logic issue, but adjacent: the
  Compact compiler version and the `@midnight-ntwrk/compact-runtime` npm
  version have to move together, and only the npm side was ever pinned.
  Surfaced by CI's first run — "latest" compiler (0.34.0) generates an async
  circuit-call API against a newer runtime than the `0.16.0` this repo locks,
  and `npm run typecheck` failed on the mismatch. Fixed by pinning the
  compiler to `0.31.1` in both CI and the README setup instructions, with the
  coupling written down so it doesn't get rediscovered by breaking again.

## Methodology

Every "confirmed to have teeth" claim above means the same thing: the
property was deliberately broken (a tag collapsed, a field dropped, a
comparison inverted, a version bumped), the relevant test was re-run and
watched fail, and only then was the break reverted. A test that has never
failed on a real break is unverified, not passing.
