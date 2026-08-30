// Wave 1 end-to-end demo. Runs the three roles — issuer, customer, auditor —
// against the compiled Candor contract in one process.
//
// What this is: the real generated circuits, executed through CircuitContext.
// What this is not: a live network. No proof server, no devnet, no wallet —
// circuit logic is exercised, ZK proofs are not generated. Say so out loud.

import { CandorSimulator, privateStateFor } from './simulator.js';
import { ATTESTED_RESERVES, DEMO_BOOK } from './book.js';
import { buildLiabilities } from './merkle-tree.js';
import { verifyLocally } from './verify.js';
import type { Customer } from './types.js';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

type NamedCustomer = Customer & { name: string };

/**
 * Seconds to hold between sections, for screen recording. Defaults to 0 so the
 * demo stays instant when run as a check; CANDOR_PACE=2 makes it watchable.
 */
const PACE = Number(process.env.CANDOR_PACE ?? 0);

const beat = (multiplier = 1): Promise<void> =>
  PACE > 0 ? new Promise((r) => setTimeout(r, PACE * 1000 * multiplier)) : Promise.resolve();

/** The issuer's private book. Never published — only its root is. */
const BOOK = DEMO_BOOK;

function heading(step: string, title: string): void {
  console.log(`\n${C.bold}${C.cyan}${step}${C.reset}  ${C.bold}${title}${C.reset}`);
  console.log(C.dim + '─'.repeat(72) + C.reset);
}

function money(n: bigint): string {
  return n.toLocaleString('en-US');
}

function shortHash(hex: string): string {
  return `${hex.slice(0, 16)}…${hex.slice(-8)}`;
}

/**
 * Runs verify_inclusion as one customer against whatever root is published.
 *
 * Customers in the published book are handed a fresh path each time the issuer
 * republishes. A customer who was dropped gets no new path — they still hold
 * the one from `staleBook`, which now folds to a root nobody published.
 */
function checkCustomer(
  sim: CandorSimulator,
  customer: NamedCustomer,
  publishedBook: NamedCustomer[],
  staleBook: NamedCustomer[] = publishedBook,
): boolean {
  const stillListed = publishedBook.some((c) => c.name === customer.name);
  const { tree } = buildLiabilities(stillListed ? publishedBook : staleBook);
  const path = tree.getPath(tree.findLeafIndex(customer));
  const included = sim
    .asCustomer(privateStateFor(customer.secret, customer.balance, path))
    .verifyInclusion();

  const badge = included
    ? `${C.green}✓ COVERED${C.reset}`
    : `${C.red}✗ NOT INCLUDED${C.reset}`;
  console.log(`  ${customer.name.padEnd(8)} ${badge}`);
  return included;
}

function showLedger(sim: CandorSimulator): void {
  const state = sim.getLedger();
  console.log(`  liabilities_root      ${shortHash(Buffer.from(state.liabilities_root).toString('hex'))}`);
  console.log(`  declared_liabilities  ${money(state.declared_liabilities)}`);
  console.log(`  committed_reserves    ${money(state.committed_reserves)}  ${C.yellow}[attested, not proven]${C.reset}`);
  console.log(
    `  solvent               ${state.solvent ? `${C.green}true${C.reset}` : `${C.red}false${C.reset}`}`,
  );
}

async function main(): Promise<void> {
  console.log(`\n${C.bold}CANDOR${C.reset} ${C.dim}— privacy-preserving proof-of-liabilities on Midnight${C.reset}`);
  console.log(`${C.dim}Wave 1 demo · compiled contract, in-process · no proofs generated${C.reset}`);

  // ── 1. What the issuer knows ─────────────────────────────────────────────
  heading('1.', "The issuer's private book");
  for (const c of BOOK) {
    console.log(`  ${c.name.padEnd(8)} ${money(c.balance).padStart(12)}`);
  }
  const published = buildLiabilities(BOOK);
  console.log(`  ${C.dim}${'─'.repeat(20)}${C.reset}`);
  console.log(`  ${'total'.padEnd(8)} ${money(published.total).padStart(12)}`);
  console.log(`\n  ${C.dim}This table never leaves the issuer. Only its root is published.${C.reset}`);
  await beat(1);

  // ── 2. What goes on-chain ────────────────────────────────────────────────
  heading('2.', 'Issuer publishes — publish_solvency()');
  const sim = new CandorSimulator(
    privateStateFor(BOOK[0].secret, BOOK[0].balance, published.tree.getPath(0)),
  );
  sim.publishSolvency(published.root, published.total, ATTESTED_RESERVES);
  showLedger(sim);
  console.log(`\n  ${C.dim}Four public fields. No names, no addresses, no per-customer balances.${C.reset}`);
  await beat(1);

  // ── 3. Customers verify privately ────────────────────────────────────────
  heading('3.', 'Each customer verifies privately');
  for (const c of BOOK) { checkCustomer(sim, c, BOOK); await beat(0.35); }

  // Those verdicts came from the compiled circuit. The same question answered
  // offline, which is what a customer actually does day to day:
  const offlineStart = process.hrtime.bigint();
  const offline = BOOK.map((c) =>
    verifyLocally(c, published.tree.getPath(published.tree.findLeafIndex(c)), {
      root: published.root,
      declaredTotal: published.total,
    }),
  );
  const offlineMs = Number(process.hrtime.bigint() - offlineStart) / 1e6;
  const agree = offline.every((v) => v.status === 'covered');

  console.log(
    `\n  ${C.dim}Balance and secret never leave the customer. The answer is one boolean.${C.reset}`,
  );
  console.log(
    `  ${C.dim}Offline, the same four checks agree (${agree}) in ${offlineMs.toFixed(1)} ms — no${C.reset}`,
  );
  console.log(
    `  ${C.dim}transaction, no wallet, no trace that anyone asked.${C.reset}`,
  );
  console.log(
    `  ${C.dim}The same fold on chain takes 20–60 s and leaves a public record. That is${C.reset}`,
  );
  console.log(
    `  ${C.dim}the point of doing it there: evidence to show someone else, not an answer.${C.reset}`,
  );
  await beat(1);

  // ── 4. The omission moment ───────────────────────────────────────────────
  heading('4.', 'Issuer republishes a root that drops Carol');
  const shrunk = BOOK.filter((c) => c.name !== 'Carol');
  const dishonest = buildLiabilities(shrunk);
  sim.publishSolvency(dishonest.root, dishonest.total, ATTESTED_RESERVES);
  console.log(`  ${C.dim}new root ${shortHash(dishonest.root)}${C.reset}`);
  console.log(`  ${C.dim}declared ${money(dishonest.total)} — ${money(published.total - dishonest.total)} lower${C.reset}\n`);
  for (const c of BOOK) { checkCustomer(sim, c, shrunk, BOOK); await beat(0.35); }
  console.log(
    `\n  ${C.yellow}Carol detects her own omission. Everyone else is unaffected.${C.reset}`,
  );
  console.log(
    `  ${C.dim}Honest framing: this lets a customer catch being dropped. It does not${C.reset}`,
  );
  console.log(
    `  ${C.dim}stop an issuer from dropping a customer who never checks.${C.reset}`,
  );

  const oldRootStillProvable =
    sim.getLedger().published_roots.findPathForLeaf(Buffer.from(published.root, 'hex')) !== undefined;
  console.log(
    `  ${C.dim}published_roots still answers for the root that included her — ` +
      `${oldRootStillProvable ? `${C.green}yes${C.reset}${C.dim}` : `${C.red}no${C.reset}${C.dim}`}. ` +
      `Shrinking the book does not erase that the honest one was ever real.${C.reset}`,
  );
  await beat(1.5);

  // ── 5. Lying about the total, without dropping anyone ────────────────────
  heading('5.', 'Issuer keeps every customer but shaves the total');
  const shaved = published.total - 500_000n;
  sim.publishSolvency(published.root, shaved, ATTESTED_RESERVES);
  console.log(`  ${C.dim}same root ${shortHash(published.root)} — nobody removed${C.reset}`);
  console.log(`  ${C.dim}declared ${money(shaved)} instead of ${money(published.total)}${C.reset}\n`);
  for (const c of BOOK) {
    checkCustomer(sim, c, BOOK);
    await beat(0.35);
  }
  console.log(`\n  ${C.yellow}Every customer catches it — the tree commits to its own total.${C.reset}`);
  console.log(
    `  ${C.dim}Each node hashes its subtotal alongside its children, so restating${C.reset}`,
  );
  console.log(
    `  ${C.dim}the sum moves the root. A plain membership tree could not see this.${C.reset}`,
  );
  await beat(1.5);

  // ── 5b. Nobody else can publish ──────────────────────────────────────────
  heading('6.', 'A stranger tries to publish');
  console.log(`  ${C.dim}same call, same arguments — only the credential differs${C.reset}`);
  try {
    sim.publishAs('99'.repeat(32), published.root, published.total, ATTESTED_RESERVES);
    console.log(`  ${C.red}accepted — anyone can overwrite the published state${C.reset}`);
    process.exitCode = 1;
  } catch (error) {
    console.log(`  ${C.green}rejected${C.reset} — ${(error as Error).message.split('\n')[0]}`);
  }
  console.log(
    `\n  ${C.dim}The issuer proves it knows the secret behind the commitment fixed at${C.reset}`,
  );
  console.log(
    `  ${C.dim}deployment. The secret itself never goes on chain.${C.reset}`,
  );
  await beat(1);

  // ── 7. Auditor ───────────────────────────────────────────────────────────
  sim.publishSolvency(published.root, published.total, ATTESTED_RESERVES);
  heading('7.', 'Auditor reads the aggregate — auditor_view()');
  const [declared, solvent] = sim.auditorView();
  console.log(`  declared_liabilities  ${money(declared)}`);
  console.log(`  solvent               ${solvent ? `${C.green}true${C.reset}` : `${C.red}false${C.reset}`}`);
  console.log(`\n  ${C.dim}The aggregate is public by construction — not a privileged view.${C.reset}`);
  await beat(1);

  // ── 8. Solvency is enforced ──────────────────────────────────────────────
  heading('8.', 'Issuer cannot publish while insolvent');
  const overdrawn = published.total + 1n;
  console.log(`  declaring ${money(overdrawn)} against reserves of ${money(published.total)}…`);
  try {
    sim.publishSolvency(published.root, overdrawn, published.total);
    console.log(`  ${C.red}accepted — contract failed to enforce solvency${C.reset}`);
    process.exitCode = 1;
  } catch (error) {
    const message = (error as Error).message.split('\n')[0];
    console.log(`  ${C.green}rejected${C.reset} — ${message}`);
  }

  console.log(
    `\n${C.dim}Simplifications, stated plainly: reserves are an attested number, not proven${C.reset}`,
  );
  console.log(
    `${C.dim}on-chain ownership. The tree does bind its own total, but a customer still${C.reset}`,
  );
  console.log(
    `${C.dim}has to check: omission is detectable, not impossible.${C.reset}\n`,
  );
}

await main();
