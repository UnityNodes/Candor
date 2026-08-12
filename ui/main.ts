// The bearer's check, running entirely in the browser.
//
// This imports the same modules the tests and the contract's own pure circuits
// are pinned against — src/hash.ts and src/merkle-tree.ts — so what happens here
// is not an approximation of the circuit. It is the circuit's arithmetic, on the
// customer's machine, with nothing leaving it.

import { buildLiabilities, LiabilitiesTree } from '../src/merkle-tree.js';
import { hashLeaf } from '../src/hash.js';
import { TreeField, type TreeView } from './tree.js';
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
    note: 'The issuer engraves the whole book and declares what it really owes. Every bearer folds their path to the published root and to the published total.',
    publish: () => publicationFor(BOOK, (t) => t),
  },
  dropped: {
    note: 'The issuer re-engraves a root with Carol struck out and declares 78,000 less. Nothing on chain looks wrong. Carol is the only one who finds out — and only because she looked.',
    publish: () => publicationFor(BOOK.filter((c) => c.name !== 'Carol'), (t) => t),
  },
  shaved: {
    note: 'Nobody is struck out — the issuer simply declares half a million less than it owes. Because every node hashes its own subtotal, restating the sum moves the root, and every bearer sees it at once.',
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
 * The path a bearer holds. Someone still listed gets a fresh one each time the
 * issuer republishes; someone struck out keeps the one they were last given.
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

/** Where this bearer sits in the book the issuer published. */
function indexOf(customer: NamedCustomer): number {
  const listed = publication.listed.findIndex((c) => c.name === customer.name);
  return listed >= 0 ? listed : BOOK.findIndex((c) => c.name === customer.name);
}

// ── rendering ────────────────────────────────────────────────────────────────

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

const money = (n: bigint) => n.toLocaleString('en-US');
const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

const plate = new TreeField($<HTMLCanvasElement>('#tree'));

function rows(target: string, pairs: Array<[string, string, string?]>): void {
  $(target).innerHTML = pairs
    .map(([term, value, cls = '']) => `<tr><th>${term}</th><td class="${cls}">${value}</td></tr>`)
    .join('');
}

function renderLedger(): void {
  const { published, reserves, solvent } = publication;
  // A certificate carries its root in its serial: change the book, change the
  // number on the sheet.
  $('#serial').textContent = published.root.slice(0, 10).toUpperCase();
  rows('#ledger', [
    ['liabilities_root', shortHash(published.root), 'gold'],
    ['declared_liabilities', money(published.declaredTotal)],
    ['committed_reserves', `${money(reserves)} · attested`],
    ['solvent', String(solvent), solvent ? 'good' : 'bad'],
  ]);
  plate.setRoot(published.root);
}

function renderPrivate(): void {
  if (!selected) {
    rows('#private', [
      ['bearer', 'unnamed', 'sealed'],
      ['balance', 'unnamed', 'sealed'],
      ['merkle path', 'unnamed', 'sealed'],
    ]);
    return;
  }
  const path = pathFor(selected, publication);
  rows('#private', [
    ['bearer secret', `${selected.secret.slice(0, 10)}… never sent`],
    ['balance', `${money(selected.balance)} never sent`],
    ['merkle path', `${path.siblings.length} siblings + subtotals`],
  ]);
}

interface Reading {
  lede: string;
  note: string;
  state: string;
  seal: string;
  sub: string;
}

function read(verdict: Verdict, customer: NamedCustomer): Reading {
  switch (verdict.status) {
    case 'covered':
      return {
        state: 'covered',
        seal: 'Covered',
        sub: `${customer.name} · one leaf`,
        lede: `${customer.name}'s balance is committed under the root the issuer published.`,
        note: 'Both engravings above are struck from the same hash, and the total the issuer declared is the one the tree actually commits to.',
      };
    case 'total-mismatch':
      return {
        state: 'missing',
        seal: 'Understated',
        sub: 'the total is short',
        lede: 'The issuer declared less than its own book adds up to.',
        note: `The tree commits to ${money(verdict.treeTotal)}; the issuer declared ${money(verdict.declaredTotal)}. This is not about one bearer — every one of them sees it at the same moment.`,
      };
    case 'stale':
      return {
        state: '',
        seal: 'Superseded',
        sub: 'fetch a fresh path',
        lede: 'This path was issued against an earlier root.',
        note: 'The issuer has re-engraved since the bearer was given this path. Fetch a new one and press again — this is not an alarm.',
      };
    default:
      return {
        state: 'missing',
        seal: 'Struck out',
        sub: `${customer.name} · absent`,
        lede: `${customer.name}'s balance is not part of what the issuer claims to owe.`,
        note: 'The two engravings above were struck from different hashes. Every other bearer may be unaffected — this one is about them alone.',
      };
  }
}

const AT_REST: Reading = {
  state: '',
  seal: 'Unexamined',
  sub: 'no bearer named',
  lede: 'This is what an issuer has put on chain. Name a bearer below and the plate is pressed against it, here, on this device.',
  note: "The bearer's balance and their place in the book are never sent anywhere, not even to perform the check.",
};

function apply(reading: Reading, timing: string): void {
  document.body.classList.remove('covered', 'missing');
  if (reading.state) document.body.classList.add(reading.state);
  $('#verdict-text').textContent = reading.lede;
  $('#verdict-note').textContent = reading.note;
  $('#seal-word').textContent = reading.seal;
  $('#seal-sub').textContent = reading.sub;
  $('#timing').textContent = timing;
}

function press(): void {
  if (!selected) {
    apply(AT_REST, '');
    plate.setView(null);
    return;
  }

  const path = pathFor(selected, publication);
  const t0 = performance.now();
  const verdict = verifyLocally(selected, path, publication.published);
  const ms = performance.now() - t0;

  // The engraving is struck from the same fold that produced the verdict.
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
  plate.setView(view);

  apply(read(verdict, selected), `pressed in ${ms.toFixed(1)} ms · no transaction · no trace`);
}

function renderStubs(): void {
  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="pick" data-name="${c.name}" aria-pressed="${selected?.name === c.name}">${c.name}</button>`,
  ).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario));
  });
  $('#scenario-note').textContent = SCENARIOS[scenario].note;
}

function renderAll(): void {
  renderLedger();
  renderPrivate();
  renderStubs();
  press();
}

// ── wiring ───────────────────────────────────────────────────────────────────

$('#chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pick');
  if (!btn) return;
  // Naming the same bearer again returns the sheet to its unexamined state.
  const clicked = BOOK.find((c) => c.name === btn.dataset.name) ?? null;
  selected = clicked?.name === selected?.name ? null : clicked;
  renderAll();
});

document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((btn) => {
  btn.addEventListener('click', () => {
    scenario = btn.dataset.scenario as ScenarioId;
    publication = SCENARIOS[scenario].publish();
    renderAll();
  });
});

// Canvas text does not pull in a webfont the way DOM text does: `ctx.font`
// matches only faces that are already loaded, and the plate's captions ask for
// a weight nothing in the markup uses. Without this the engraving's lettering
// silently falls back to the system sans.
void Promise.all([
  document.fonts.load('500 10px "Archivo"'),
  document.fonts.load('600 42px "Bodoni Moda"'),
]).then(() => plate.start());

renderAll();
