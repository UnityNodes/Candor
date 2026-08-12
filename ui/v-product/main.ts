// Product register: the answer first, the evidence under it, the controls in
// reach. Everything the page shows comes from ui/engine.ts, which runs the same
// arithmetic the contract's circuits do.

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
} from '../engine.js';

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

let pub: Publication = publish('honest');
let picked: NamedCustomer | null = null;

// ── the answer ───────────────────────────────────────────────────────────────

interface Reading {
  state: '' | 'covered' | 'missing' | 'stale';
  glyph: string;
  headline: string;
  subline: string;
  proof: string;
  proofBad: boolean;
}

function read(out: Outcome, who: NamedCustomer): Reading {
  switch (out.verdict.status) {
    case 'covered':
      return {
        state: 'covered',
        glyph: '✓',
        headline: `${who.name}, your balance is covered`,
        subline: `Your ${money(who.balance)} is inside the ${money(pub.published.declaredTotal)} the exchange published, and that figure is the one its own book adds up to.`,
        proof: 'All eight folds landed where they had to. The last one produced exactly the root on chain.',
        proofBad: false,
      };
    case 'total-mismatch':
      return {
        state: 'missing',
        glyph: '!',
        headline: 'The exchange owes more than it declared',
        subline: `Its book adds up to ${money(out.treeTotal)}, but it declared ${money(out.verdict.declaredTotal)}. That gap is ${money(out.treeTotal - out.verdict.declaredTotal)}.`,
        proof: `The folds are sound — your balance is in the book. The number attached to the root is not the number the book produces.`,
        proofBad: true,
      };
    case 'stale':
      return {
        state: 'stale',
        glyph: '↻',
        headline: 'This proof is out of date',
        subline: 'The exchange has published a newer book. Ask for a fresh path and check again — nothing is wrong yet.',
        proof: 'The fold is against a root that is no longer the current one.',
        proofBad: false,
      };
    default:
      return {
        state: 'missing',
        glyph: '✕',
        headline: `${who.name}, you are not in the published book`,
        subline: `The exchange declared ${money(pub.published.declaredTotal)} and your ${money(who.balance)} is not part of it. Nothing on chain looks wrong to anybody else.`,
        proof: 'The folds run, but the root they produce is not the root on chain. Somewhere on the way up, the book you were given no longer matches the book that was published.',
        proofBad: true,
      };
  }
}

const AT_REST: Reading = {
  state: '',
  glyph: '?',
  headline: 'Pick a customer to check',
  subline:
    "The exchange claims it can cover everything it owes. This checks whether one person's balance is actually inside that claim.",
  proof:
    'Your balance is one leaf in a tree of 256 places. Folding it eight times has to land on the root the exchange published.',
  proofBad: false,
};

// ── the eight folds ──────────────────────────────────────────────────────────

function renderSteps(out: Outcome | null): void {
  const broken = out ? !out.rootMatches : false;

  const cells = Array.from({ length: 9 }, (_, level) => {
    const first = level === 0;
    const last = level === 8;
    const label = first ? 'you' : last ? 'root' : String(level);
    // Only the first three siblings carry a legible amount at this size; past
    // that the numbers crowd each other and stop being readable.
    const sibling = out && level > 0 && level <= 3 ? out.trace[level].sibling : null;
    const amount = sibling && sibling.sum > 0n ? `+${short(sibling.sum)}` : '';

    const state = !out ? '' : broken && last ? 'broken' : 'done';
    return `<div class="step ${state} ${first || last ? 'end' : ''}">
      <span class="dot"></span>
      <span class="step-label">${label}</span>
      <span class="step-amount">${amount}</span>
    </div>`;
  });

  $('#steps').innerHTML = cells.join('');
}

const short = (n: bigint) =>
  n >= 1_000_000n
    ? `${(Number(n) / 1e6).toFixed(2)}M`
    : n >= 1_000n
      ? `${(Number(n) / 1e3).toFixed(1)}K`
      : String(n);

// ── panels ───────────────────────────────────────────────────────────────────

function rows(target: string, pairs: Array<[string, string, string?]>): void {
  $(target).innerHTML = pairs
    .map(
      ([k, v, cls = '']) =>
        `<div class="row"><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`,
    )
    .join('');
}

function renderPanels(out: Outcome | null): void {
  rows('#ledger', [
    ['root', shortHash(pub.published.root)],
    ['declared', money(pub.published.declaredTotal)],
    ['reserves', money(pub.reserves)],
    ['solvent', pub.solvent ? 'yes' : 'no', pub.solvent ? 'good' : 'bad'],
  ]);

  if (!picked || !out) {
    rows('#private', [
      ['secret', 'nobody picked', 'muted'],
      ['balance', 'nobody picked', 'muted'],
      ['path', 'nobody picked', 'muted'],
    ]);
    return;
  }
  rows('#private', [
    ['secret', `${picked.secret.slice(0, 8)}…`],
    ['balance', money(picked.balance)],
    ['path', `${out.path.siblings.length} siblings`],
  ]);
}

// ── render ───────────────────────────────────────────────────────────────────

function render(): void {
  const out = picked ? check(picked, pub) : null;
  const reading = out && picked ? read(out, picked) : AT_REST;

  const status = $('#status');
  status.className = `status ${reading.state}`;
  $('#badge').textContent = reading.glyph;
  $('#headline').textContent = reading.headline;
  $('#subline').textContent = reading.subline;

  const note = $('#proof-note');
  note.className = `proof-note ${reading.proofBad ? 'bad' : ''}`;
  note.textContent = reading.proof;

  $('#meter').textContent = out
    ? `${out.ms.toFixed(1)} ms · nothing sent`
    : `${pub.listed.length} of 256 places used`;

  renderSteps(out);
  renderPanels(out);

  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="chip" data-name="${c.name}" aria-pressed="${picked?.name === c.name}">${c.name}</button>`,
  ).join('');

  $('#scenarios').innerHTML = SCENARIOS.map(
    (s) =>
      `<button class="segment" data-scenario="${s.id}" aria-pressed="${pub.scenario === s.id}">${s.label}</button>`,
  ).join('');
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

render();
