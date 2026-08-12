// Wave 1 end-to-end demo. Runs the three roles — issuer, customer, auditor —
// against the compiled Candor contract in one process.
//
// What this is: the real generated circuits, executed through CircuitContext.
// What this is not: a live network. No proof server, no devnet, no wallet —
// circuit logic is exercised, ZK proofs are not generated. Say so out loud.

import { CandorSimulator, privateStateFor } from './simulator.js';
import { buildLiabilities } from './merkle-tree.js';
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
const BOOK: NamedCustomer[] = [
  { name: 'Alice', secret: '11'.repeat(32), balance: 1_400_000n },
  { name: 'Bob', secret: '22'.repeat(32), balance: 320_500n },
  { name: 'Carol', secret: '33'.repeat(32), balance: 78_000n },
  { name: 'Dave', secret: '44'.repeat(32), balance: 5_200n },
];

const ATTESTED_RESERVES = 1_900_000n;

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
  heading('3.', 'Each customer verifies privately — verify_inclusion()');
  for (const c of BOOK) { checkCustomer(sim, c, BOOK); await beat(0.35); }
  console.log(
    `\n  ${C.dim}Balance and secret stay in the witness. The circuit discloses one boolean.${C.reset}`,
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

  // ── 6. Auditor ───────────────────────────────────────────────────────────
  sim.publishSolvency(published.root, published.total, ATTESTED_RESERVES);
  heading('6.', 'Auditor reads the aggregate — auditor_view()');
  const [declared, solvent] = sim.auditorView();
  console.log(`  declared_liabilities  ${money(declared)}`);
  console.log(`  solvent               ${solvent ? `${C.green}true${C.reset}` : `${C.red}false${C.reset}`}`);
  console.log(`\n  ${C.dim}The aggregate is public by construction — not a privileged view.${C.reset}`);
  await beat(1);

  // ── 7. Solvency is enforced ──────────────────────────────────────────────
  heading('7.', 'Issuer cannot publish while insolvent');
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
