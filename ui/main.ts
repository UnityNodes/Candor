// The check, running entirely in the browser.
//
// This imports the same modules the tests and the contract's own pure circuits
// are pinned against — src/hash.ts and src/merkle-tree.ts — so what happens here
// is not an approximation of the circuit. It is the circuit's arithmetic, on the
// customer's machine, with nothing leaving it.

import { buildLiabilities, LiabilitiesTree } from '../src/merkle-tree.js';
import { hashLeaf } from '../src/hash.js';
import { Plate, type Proof } from './plate.js';
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
    note: 'The exchange publishes everyone and declares what it really owes.',
    publish: () => publicationFor(BOOK, (t) => t),
  },
  dropped: {
    note: 'The exchange republishes without Carol and declares 78,000 less. Nothing on chain looks wrong. Carol is the only one who finds out, and only because she looked.',
    publish: () => publicationFor(BOOK.filter((c) => c.name !== 'Carol'), (t) => t),
  },
  shaved: {
    note: 'Nobody is removed. The exchange simply declares half a million less than it owes. Every balance is hashed into the total, so the moment it understates the sum, everyone sees it.',
    publish: () => publicationFor(BOOK, (t) => t - 500_000n),
  },
};

interface Publication {
  published: PublishedState;
  reserves: bigint;
  solvent: boolean;
  /** The book the exchange actually published — where fresh paths come from. */
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
 * The path someone holds. A customer still listed gets a fresh one each time the
 * exchange republishes; one who was dropped keeps the path they were last given.
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

/** Where this customer sits in the book the exchange published. */
function indexOf(customer: NamedCustomer): number {
  const listed = publication.listed.findIndex((c) => c.name === customer.name);
  return listed >= 0 ? listed : BOOK.findIndex((c) => c.name === customer.name);
}

// ── rendering ────────────────────────────────────────────────────────────────

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

const money = (n: bigint) => n.toLocaleString('en-US');
const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;

const plate = new Plate($<HTMLCanvasElement>('#engraving'));

function rows(target: string, pairs: Array<[string, string, string?]>): void {
  $(target).innerHTML = pairs
    .map(([term, value, cls = '']) => `<tr><th>${term}</th><td class="${cls}">${value}</td></tr>`)
    .join('');
}

function renderLedger(): void {
  const { published, reserves, solvent } = publication;
  // The sheet carries the root in its serial: publish a different book, and a
  // visibly different certificate is issued.
  const serial = published.root.slice(0, 10).toUpperCase();
  $('#serial').textContent = serial;
  $('#serial-back').textContent = serial;
  // These are the contract's own field names, because that is literally what
  // sits on chain — the table says "public", so it shows the public thing.
  rows('#ledger', [
    ['liabilities_root', shortHash(published.root), 'gold'],
    ['declared_liabilities', money(published.declaredTotal)],
    ['committed_reserves', `${money(reserves)} · claimed`],
    ['solvent', String(solvent), solvent ? 'good' : 'bad'],
  ]);
  plate.setRoot(published.root);
}

function renderPrivate(): void {
  if (!selected) {
    rows('#private', [
      ['your secret', 'nobody picked', 'sealed'],
      ['your balance', 'nobody picked', 'sealed'],
      ['your path', 'nobody picked', 'sealed'],
    ]);
    return;
  }
  const path = pathFor(selected, publication);
  rows('#private', [
    ['your secret', `${selected.secret.slice(0, 10)}… never sent`],
    ['your balance', `${money(selected.balance)} never sent`],
    ['your path', `${path.siblings.length} steps up the tree`],
  ]);
}

interface Reading {
  answer: string;
  because: string;
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
        sub: customer.name,
        answer: `${customer.name}, your money is on their books.`,
        because:
          'Your rosette and theirs came out identical, so your balance is inside the total the exchange published — and the total it declared is the one its own book adds up to.',
      };
    case 'total-mismatch':
      return {
        state: 'missing',
        seal: 'Short',
        sub: 'the total is wrong',
        answer: 'They owe more than they admit.',
        because: `The rosettes match, so the book itself is real. But it adds up to ${money(verdict.treeTotal)} and the exchange declared ${money(verdict.declaredTotal)}. Everyone sees this at once, not just you.`,
      };
    case 'stale':
      return {
        state: '',
        seal: 'Stale',
        sub: 'get a new path',
        answer: 'Your proof is out of date.',
        because:
          'The exchange has published a newer book since you were given this path. Ask for a fresh one and check again — nothing is wrong yet.',
      };
    default:
      return {
        state: 'missing',
        seal: 'Not listed',
        sub: customer.name,
        answer: `${customer.name}, you are not on their books.`,
        because:
          'The two rosettes came out different. Your balance is not part of what the exchange says it owes, and nothing on chain looks wrong to anyone else.',
      };
  }
}

const AT_REST: Reading = {
  state: '',
  seal: 'Unchecked',
  sub: 'pick a name',
  answer: 'Pick a name above to check.',
  because:
    "The exchange says it holds enough to cover everything it owes. This page checks whether one person's money is actually inside that claim.",
};

function apply(reading: Reading, timing: string): void {
  document.body.classList.remove('covered', 'missing');
  if (reading.state) document.body.classList.add(reading.state);
  $('#verdict-text').textContent = reading.answer;
  $('#verdict-note').textContent = reading.because;
  $('#seal-word').textContent = reading.seal;
  $('#seal-sub').textContent = reading.sub;
  $('#timing').textContent = timing;
}

function check(): void {
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
  const view: Proof = {
    trace,
    leafIndex: Math.max(indexOf(selected), 0),
    occupied: publication.listed.length,
    publishedRoot: publication.published.root,
    rootMatches: trace[trace.length - 1].node.hash === publication.published.root,
    declaredTotal: publication.published.declaredTotal,
  };
  plate.setView(view);

  apply(read(verdict, selected), `checked here in ${ms.toFixed(1)} ms · nothing was sent`);
}

function renderControls(): void {
  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="pick" data-name="${c.name}" aria-pressed="${selected?.name === c.name}">${c.name}</button>`,
  ).join('');
  document.querySelectorAll<HTMLButtonElement>('[data-scenario]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.scenario === scenario));
  });
  // Sits under the control that changes it, not in a footnote somewhere else.
  $('#scenario-note').textContent = SCENARIOS[scenario].note;
}

function renderAll(): void {
  renderLedger();
  renderPrivate();
  renderControls();
  check();
}

// ── wiring ───────────────────────────────────────────────────────────────────

$('#chips').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.pick');
  if (!btn) return;
  // Picking the same name again clears the sheet back to its unchecked state.
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

// Turning the sheet over. The reverse carries the figures and the small print,
// which is where a certificate has always kept them.
const sheet = $<HTMLElement>('#sheet');
const turn = $<HTMLButtonElement>('#turn');
turn.addEventListener('click', () => {
  const turned = sheet.classList.toggle('turned');
  turn.setAttribute('aria-expanded', String(turned));
  turn.querySelector('.corner-hint')!.textContent = turned ? 'the face' : 'the reverse';
});

// Canvas text does not pull in a webfont the way DOM text does: `ctx.font`
// matches only faces that are already loaded, and the plate's lettering asks for
// a weight nothing in the markup uses. Without this the engraving's captions
// silently fall back to the system sans.
void document.fonts.load('500 10px "Archivo"').then(() => plate.start());

renderAll();
