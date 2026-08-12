// Poster register: one sentence carries the page, the ground carries the state,
// and the proof is a small imprint at the foot. Everything comes from
// ui/engine.ts, which runs the same arithmetic the contract's circuits do.

import {
  BOOK,
  SCENARIOS,
  check,
  money,
  publish,
  type NamedCustomer,
  type Outcome,
  type Publication,
  type ScenarioId,
} from '../engine.js';

const $ = <T extends Element>(sel: string): T => document.querySelector<T>(sel)!;

let pub: Publication = publish('honest');
let picked: NamedCustomer | null = null;

interface Reading {
  state: '' | 'covered' | 'missing' | 'stale';
  headline: string;
  under: string;
  reading: string;
}

function read(out: Outcome, who: NamedCustomer): Reading {
  switch (out.verdict.status) {
    case 'covered':
      return {
        state: 'covered',
        headline: `${who.name}, your money is on their books.`,
        under: `Your ${money(who.balance)} folds eight times and lands exactly on the root the exchange published. The total it declared is the one its own book adds up to.`,
        reading: `covered · ${out.ms.toFixed(1)} ms · nothing sent`,
      };
    case 'total-mismatch':
      return {
        state: 'missing',
        headline: 'They owe more than they admit.',
        under: `The book adds up to ${money(out.treeTotal)}. The exchange declared ${money(out.verdict.declaredTotal)}. Every customer sees this at the same moment, not just you.`,
        reading: `short by ${money(out.treeTotal - out.verdict.declaredTotal)} · ${out.ms.toFixed(1)} ms`,
      };
    case 'stale':
      return {
        state: 'stale',
        headline: 'Your proof is out of date.',
        under: 'The exchange has published a newer book since you were given this path. Ask for a fresh one — nothing is wrong yet.',
        reading: `stale · ${out.ms.toFixed(1)} ms`,
      };
    default:
      return {
        state: 'missing',
        headline: `${who.name}, you are not on their books.`,
        under: `The exchange declared ${money(pub.published.declaredTotal)} and your ${money(who.balance)} is not part of it. Nothing on chain looks wrong to anybody else.`,
        reading: `not in the root · ${out.ms.toFixed(1)} ms`,
      };
  }
}

const AT_REST: Reading = {
  state: '',
  headline: 'Is your money on their books?',
  under:
    'An exchange says it can cover what it owes. Pick a name and find out, without telling anyone which name you picked.',
  reading: 'nothing checked yet',
};

/** Nine marks: the leaf, seven folds, the root. Filled as far as they hold. */
function renderTrack(out: Outcome | null): void {
  $('#track').innerHTML = Array.from({ length: 9 }, (_, i) => {
    const last = i === 8;
    const state = !out ? '' : last && !out.rootMatches ? 'off' : 'on';
    return `<span class="mark ${state} ${last ? 'last' : ''}"></span>`;
  }).join('');
}

function render(): void {
  const out = picked ? check(picked, pub) : null;
  const r = out && picked ? read(out, picked) : AT_REST;

  document.body.className = r.state;
  $('#headline').textContent = r.headline;
  $('#subline').textContent = r.under;
  $('#reading').textContent = r.reading;
  $('#claim').textContent = `claims ${money(pub.reserves)} · declares ${money(pub.published.declaredTotal)}`;

  renderTrack(out);

  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="word" data-name="${c.name}" aria-pressed="${picked?.name === c.name}">${c.name}</button>`,
  ).join('');

  $('#scenarios').innerHTML = SCENARIOS.map(
    (s) =>
      `<button class="word" data-scenario="${s.id}" aria-pressed="${pub.scenario === s.id}">${s.label}</button>`,
  ).join('');
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  const name = target.closest<HTMLButtonElement>('[data-name]');
  if (name) {
    const clicked = BOOK.find((c) => c.name === name.dataset.name) ?? null;
    picked = clicked?.name === picked?.name ? null : clicked;
    render();
    return;
  }

  const scenario = target.closest<HTMLButtonElement>('[data-scenario]');
  if (scenario) {
    pub = publish(scenario.dataset.scenario as ScenarioId);
    render();
  }
});

render();
