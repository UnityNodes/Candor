// The customer's check, running entirely in the browser.
//
// This imports the same modules the tests and the contract's own pure circuits
// are pinned against — src/hash.ts and src/merkle-tree.ts — so what happens here
// is not an approximation of the circuit. It is the circuit's arithmetic, on the
// customer's machine, with nothing leaving it.

import { buildLiabilities, LiabilitiesTree } from '../src/merkle-tree.js';
import { hashLeaf } from '../src/hash.js';
import { animateTree, drawTree, type TreeView } from './tree.js';
import { verifyLocally, type PublishedState, type Verdict } from '../src/verify.js';
import type { Customer } from '../src/types.js';

type NamedCustomer = Customer & { name: string };

const BOOK: NamedCustomer[] = [
  { name: 'Alice', secret: '11'.repeat(32), balance: 1_400_000n },
  { name: 'Bob', secret: '22'.repeat(32), balance: 320_500n },
  { name: 'Carol', secret: '33'.repeat(32), balance: 78_000n },
  { name: 'Dave', secret: '44'.repeat(32), balance: 5_200n },
];

const ATTESTED_RESERVES = 1_900_000n;

type ScenarioId = 'honest' | 'dropped' | 'shaved';

const SCENARIOS: Record<ScenarioId, { note: string; publish: () => Publication }> = {
  honest: {
    note: 'The issuer publishes the whole book and declares what it really owes. Every customer folds their path to the published root and the published total.',
    publish: () => publicationFor(BOOK, (t) => t),
  },
  dropped: {
    note: 'The issuer republishes a root that leaves Carol out and declares 78,000 less. Nothing on chain looks wrong. Carol is the only one who finds out — and only because she looked.',
    publish: () => publicationFor(BOOK.filter((c) => c.name !== 'Carol'), (t) => t),
  },
  shaved: {
    note: 'Nobody is removed — the issuer simply declares half a million less than it owes. Because every node hashes its own subtotal, restating the sum moves the root, and every customer sees it at once.',
    publish: () => publicationFor(BOOK, (t) => t - 500_000n),
  },
};

interface Publication {
  published: PublishedState;
  reserves: bigint;
  solvent: boolean;
  /** The book the issuer actually published — where fresh paths come from. */
  listed: NamedCustomer[];
}

function publicationFor(listed: NamedCustomer[], declare: (total: bigint) => bigint): Publication {
  const { root, total } = buildLiabilities(listed);
  const declared = declare(total);
  return {
    published: { root, declaredTotal: declared },
    reserves: ATTESTED_RESERVES,
    solvent: ATTESTED_RESERVES >= declared,
    listed,
  };
}

/**
 * The path a customer holds. Someone still listed gets a fresh one each time the
 * issuer republishes; someone dropped keeps the one they were last given.
 */
function pathFor(customer: NamedCustomer, publication: Publication) {
  const listed = publication.listed.some((c) => c.name === customer.name);
  const source = listed ? publication.listed : BOOK;
  const { tree } = buildLiabilities(source);
  return tree.getPath(tree.findLeafIndex(customer));
}

// ── state ────────────────────────────────────────────────────────────────────

let scenario: ScenarioId = 'honest';
let publication = SCENARIOS[scenario].publish();
let selected: NamedCustomer | null = null;

/** Where this customer sits in the book the issuer published. */
function indexOf(customer: NamedCustomer): number {
  const listed = publication.listed.findIndex((c) => c.name === customer.name);
  return listed >= 0 ? listed : BOOK.findIndex((c) => c.name === customer.name);
}

// ── rendering ────────────────────────────────────────────────────────────────

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

const money = (n: bigint) => n.toLocaleString('en-US');
const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

function row(term: string, value: string, cls = ''): string {
  return `<div class="row"><dt>${term}</dt><dd class="${cls}">${value}</dd></div>`;
}

function renderLedger(): void {
  const { published, reserves, solvent } = publication;
  $('#ledger').innerHTML = [
    row('liabilities_root', shortHash(published.root), 'gold'),
    row('declared_liabilities', money(published.declaredTotal)),
    row('committed_reserves', `${money(reserves)}  · attested`),
    row('solvent', String(solvent), solvent ? 'good' : 'bad'),
  ].join('');
}

function renderPrivate(): void {
  if (!selected) {
    $('#private').innerHTML = [
      row('your secret', 'sealed', 'sealed'),
      row('your balance', 'sealed', 'sealed'),
      row('your merkle path', 'sealed', 'sealed'),
    ].join('');
    return;
  }
  const path = pathFor(selected, publication);
  $('#private').innerHTML = [
    row('your secret', `${selected.secret.slice(0, 10)}… (never sent)`),
    row('your balance', `${money(selected.balance)} (never sent)`),
    row('your merkle path', `${path.siblings.length} siblings + subtotals`),
  ].join('');
}

function describe(verdict: Verdict, customer: NamedCustomer): { title: string; note: string; state: string } {
  switch (verdict.status) {
    case 'covered':
      return {
        state: 'covered',
        title: `${customer.name}, your balance is covered`,
        note: 'Your leaf sits under the published root, and the total the issuer declared is the one the tree actually commits to.',
      };
    case 'total-mismatch':
      return {
        state: 'missing',
        title: 'The issuer understated what it owes',
        note: `The tree commits to ${money(verdict.treeTotal)} but the issuer declared ${money(verdict.declaredTotal)}. This is not about you — every customer sees it right now.`,
      };
    case 'stale':
      return {
        state: '',
        title: 'Your path is out of date',
        note: 'The issuer has republished since you were given this path. Fetch a new one and check again — this is not an alarm.',
      };
    default:
      return {
        state: 'missing',
        title: `${customer.name}, you are not in the published root`,
        note: 'Your balance is not part of what the issuer is claiming to owe. Everyone else may be unaffected — this one is about you.',
      };
  }
}

let cancelTree: (() => void) | null = null;

function check(): void {
  const aperture = $('.aperture');
  const canvas = $<HTMLCanvasElement>('#tree');
  const verdictEl = $('#verdict-text');
  const noteEl = $('#verdict-note');
  const timingEl = $('#timing');

  cancelTree?.();

  if (!selected) {
    aperture.classList.remove('covered', 'missing');
    verdictEl.className = 'verdict';
    verdictEl.textContent = 'Choose a customer to check';
    noteEl.textContent = 'The check runs here, on this device. Nothing is sent anywhere.';
    timingEl.textContent = '';
    drawTree(canvas, null, 0);
    return;
  }

  const path = pathFor(selected, publication);
  const t0 = performance.now();
  const verdict = verifyLocally(selected, path, publication.published);
  const ms = performance.now() - t0;

  // The picture is built from the same fold that produced the verdict.
  const leaf = { hash: hashLeaf(selected.secret, selected.balance), sum: selected.balance };
  const trace = LiabilitiesTree.foldTrace(leaf, path);
  const view: TreeView = {
    trace,
    leafIndex: Math.max(indexOf(selected), 0),
    occupied: publication.listed.length,
    publishedRoot: publication.published.root,
    rootMatches: trace[trace.length - 1].node.hash === publication.published.root,
    declaredTotal: publication.published.declaredTotal,
  };
  cancelTree = animateTree(canvas, view, 1200);

  const { title, note, state } = describe(verdict, selected);
  aperture.classList.remove('covered', 'missing');
  if (state) aperture.classList.add(state);
  verdictEl.className = `verdict ${state}`;
  verdictEl.textContent = title;
  noteEl.textContent = note;
  timingEl.textContent = `answered locally in ${ms.toFixed(1)} ms · no transaction · no trace`;
}

function renderChips(): void {
  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="chip" data-name="${c.name}" aria-pressed="${selected?.name === c.name}">${c.name}</button>`,
  ).join('');
}

function renderScenario(): void {
  document.querySelectorAll<HTMLButtonElement>('.scenario').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario));
  });
  $('#scenario-note').textContent = SCENARIOS[scenario].note;
}

function renderAll(): void {
  renderLedger();
  renderPrivate();
  renderChips();
  renderScenario();
  check();
}

// ── wiring ───────────────────────────────────────────────────────────────────

$('#chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.chip');
  if (!btn) return;
  selected = BOOK.find((c) => c.name === btn.dataset.name) ?? null;
  renderAll();
});

document.querySelectorAll<HTMLButtonElement>('.scenario').forEach((btn) => {
  btn.addEventListener('click', () => {
    scenario = btn.dataset.scenario as ScenarioId;
    publication = SCENARIOS[scenario].publish();
    renderAll();
  });
});

renderAll();
