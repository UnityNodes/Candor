// Product register: the answer first, the book under it, the split that the
// whole idea rests on beneath that. Everything shown comes from ui/engine.ts,
// which runs the same arithmetic the contract's circuits do.

import {
  BOOK,
  SCENARIOS,
  check,
  money,
  publish,
  shortHash,
  type NamedCustomer,
  type Outcome,
  type Publication,
  type ScenarioId,
} from './engine.js';
import { ProofView } from './tree.js';

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

let pub: Publication = publish('honest');
let picked: NamedCustomer | null = null;

const proof = new ProofView($<HTMLCanvasElement>('#tree'));

// ── the answer ───────────────────────────────────────────────────────────────

interface Reading {
  state: '' | 'covered' | 'missing' | 'stale';
  headline: string;
  subline: string;
  title: string;
  note: string;
  noteBad: boolean;
}

function read(out: Outcome, who: NamedCustomer): Reading {
  switch (out.verdict.status) {
    case 'covered':
      return {
        state: 'covered',
        headline: `${who.name}, your money is on their books.`,
        subline: `Your ${money(who.balance)} is inside the ${money(pub.published.declaredTotal)} the exchange published, and that figure is the one its own book adds up to.`,
        title: 'Your path through the book',
        note: 'All eight folds landed where they had to, and the last one produced exactly the root on chain.',
        noteBad: false,
      };
    case 'total-mismatch':
      return {
        state: 'missing',
        headline: 'They owe more than they declared.',
        subline: `The book adds up to ${money(out.treeTotal)}. The exchange declared ${money(out.verdict.declaredTotal)} — short by ${money(out.treeTotal - out.verdict.declaredTotal)}.`,
        title: 'Your path through the book',
        note: 'The folds are sound and your balance is in the book. What does not match is the number attached to the root — and every customer sees that at the same moment.',
        noteBad: true,
      };
    case 'stale':
      return {
        state: 'stale',
        headline: 'This proof is out of date.',
        subline: 'The exchange has published a newer book. Ask for a fresh path and check again — nothing is wrong yet.',
        title: 'Your path through the book',
        note: 'The fold runs against a root that is no longer the current one.',
        noteBad: false,
      };
    default:
      return {
        state: 'missing',
        headline: `${who.name}, you are not on their books.`,
        subline: `The exchange declared ${money(pub.published.declaredTotal)}, and your ${money(who.balance)} is not part of it. Nothing on chain looks wrong to anybody else.`,
        title: 'Your path through the book',
        note: 'The folds run, but the root they produce is not the root on chain. The book you hold a path into is no longer the book that was published.',
        noteBad: true,
      };
  }
}

const AT_REST: Reading = {
  state: '',
  headline: 'Is your money on their books?',
  subline:
    "An exchange claims it can cover everything it owes. This checks whether one person's balance is actually inside that claim.",
  title: 'The book the exchange published',
  note: 'Your balance is one leaf among 256 places. Folding it eight times has to land on exactly the root the exchange put on chain.',
  noteBad: false,
};

// ── panels ───────────────────────────────────────────────────────────────────

function rows(target: string, pairs: Array<[string, string, string?]>): void {
  $(target).innerHTML = pairs
    .map(([k, v, cls = '']) => `<div class="row"><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`)
    .join('');
}

function renderPanels(out: Outcome | null): void {
  rows('#ledger', [
    ['liabilities_root', shortHash(pub.published.root), 'gold'],
    ['declared_liabilities', money(pub.published.declaredTotal)],
    ['committed_reserves', `${money(pub.reserves)} · claimed`],
    ['solvent', pub.solvent ? 'true' : 'false', pub.solvent ? 'good' : 'bad'],
  ]);

  if (!picked || !out) {
    rows('#private', [
      ['your secret', 'nobody picked', 'muted'],
      ['your balance', 'nobody picked', 'muted'],
      ['your path', 'nobody picked', 'muted'],
    ]);
    return;
  }
  rows('#private', [
    ['your secret', `${picked.secret.slice(0, 10)}…`],
    ['your balance', money(picked.balance)],
    ['your path', `${out.path.siblings.length} siblings + subtotals`],
  ]);
}

// ── render ───────────────────────────────────────────────────────────────────

function render(redraw = true): void {
  const out = picked ? check(picked, pub) : null;
  const r = out && picked ? read(out, picked) : AT_REST;

  document.body.className = r.state;
  $('#headline').textContent = r.headline;
  $('#subline').textContent = r.subline;
  $('#proof-title').textContent = r.title;

  const note = $('#proof-note');
  note.className = `proof-note ${r.noteBad ? 'bad' : ''}`;
  note.textContent = r.note;

  $('#meter').textContent = out
    ? `${out.ms.toFixed(1)} ms · nothing sent`
    : `${pub.listed.length} of 256 places used`;

  renderPanels(out);

  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="chip" data-name="${c.name}" aria-pressed="${picked?.name === c.name}">${c.name}</button>`,
  ).join('');

  $('#scenarios').innerHTML = SCENARIOS.map(
    (s) =>
      `<button class="segment" data-scenario="${s.id}" aria-pressed="${pub.scenario === s.id}">${s.label}</button>`,
  ).join('');

  if (redraw) proof.show(out, pub.listed.length, pub.published.declaredTotal);
}

// ── wiring ───────────────────────────────────────────────────────────────────

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const chip = target.closest<HTMLButtonElement>('.chip');
  if (chip) {
    const clicked = BOOK.find((c) => c.name === chip.dataset.name) ?? null;
    // Pressing the selected customer again clears the check.
    picked = clicked?.name === picked?.name ? null : clicked;
    render();
    return;
  }

  const segment = target.closest<HTMLButtonElement>('.segment');
  if (segment) {
    pub = publish(segment.dataset.scenario as ScenarioId);
    render();
  }
});

// Canvas text does not pull in a webfont the way DOM text does: `ctx.font`
// matches only faces that are already loaded, and the drawing asks for weights
// nothing in the markup uses.
void Promise.all([
  document.fonts.load('500 10px "Azeret Mono"'),
  document.fonts.load('500 11px "Archivo"'),
]).then(() => render(true));

render();
