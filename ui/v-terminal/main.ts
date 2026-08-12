// Machine register: the check, printed as it runs.
//
// The log is not a dramatisation. Every figure is read off the Outcome that
// ui/engine.ts just computed, including the timing, so the transcript is a
// record of work that actually happened in this tab a moment ago.

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
/** Bumped on every run so a slow print from a stale run stops writing. */
let run = 0;

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (s: string, n: number) => s.padEnd(n, ' ');
const right = (s: string, n: number) => s.padStart(n, ' ');

interface Line {
  text: string;
  cls?: string;
  /** Rendered as a bordered banner rather than a line of text. */
  banner?: boolean;
}

const l = (text: string, cls = ''): Line => ({ text, cls });

function transcript(who: NamedCustomer | null, out: Outcome | null): Line[] {
  const { published, reserves, solvent } = pub;
  const lines: Line[] = [
    l(`$ candor publish --book ${SCENARIOS.find((s) => s.id === pub.scenario)!.id}`, 'faint'),
    l(''),
    l('published state', 'dim'),
    l(`  ${pad('liabilities_root', 22)}${published.root}`, 'amber'),
    l(`  ${pad('declared_liabilities', 22)}${money(published.declaredTotal)}`),
    l(`  ${pad('committed_reserves', 22)}${money(reserves)}  (claimed, not proven)`),
    l(`  ${pad('solvent', 22)}${solvent}`, solvent ? 'good' : 'bad'),
    l(''),
  ];

  if (!who || !out) {
    lines.push(
      l('nothing checked yet.', 'dim'),
      l('pick a name below to fold one customer\'s path against the root above.', 'faint'),
    );
    return lines;
  }

  lines.push(
    l(`$ candor verify --as ${who.name.toLowerCase()}`, 'faint'),
    l(''),
    l(`  ${pad('your balance', 22)}${money(who.balance)}  (never sent)`, 'dim'),
    l(`  ${pad('your path', 22)}${out.path.siblings.length} siblings + subtotals  (never sent)`, 'dim'),
    l(''),
    l('  folding, level by level', 'dim'),
  );

  for (let level = 0; level <= 8; level++) {
    const step = out.trace[level];
    const taken = step.sibling ? `+ ${money(step.sibling.sum)}` : 'leaf';
    lines.push(
      l(
        `    ${right(String(level), 2)}  ${pad(taken, 16)}${right(money(step.node.sum), 12)}  ${step.node.hash.slice(0, 16)}…`,
      ),
    );
  }

  const sumOk = out.treeTotal === published.declaredTotal;
  lines.push(
    l(''),
    l(
      `  ${pad('root matches published', 30)}${out.rootMatches ? 'yes' : 'NO'}`,
      out.rootMatches ? 'good' : 'bad',
    ),
    l(
      `  ${pad('declared equals tree total', 30)}${sumOk ? 'yes' : 'NO'}`,
      sumOk ? 'good' : 'bad',
    ),
    l(''),
  );

  switch (out.verdict.status) {
    case 'covered':
      lines.push(
        { text: ' COVERED ', cls: 'good', banner: true },
        l(`  ${who.name}'s balance is inside the total the exchange published.`, 'dim'),
      );
      break;
    case 'total-mismatch':
      lines.push(
        { text: ' UNDERSTATED ', cls: 'bad', banner: true },
        l(
          `  the book adds up to ${money(out.treeTotal)}; the exchange declared ${money(out.verdict.declaredTotal)}.`,
          'dim',
        ),
        l(`  short by ${money(out.treeTotal - out.verdict.declaredTotal)}. every customer sees this, not just ${who.name.toLowerCase()}.`, 'dim'),
      );
      break;
    case 'stale':
      lines.push(
        { text: ' STALE PATH ', cls: 'amber', banner: true },
        l('  the exchange republished. fetch a fresh path and run again.', 'dim'),
      );
      break;
    default:
      lines.push(
        { text: ' NOT IN THE ROOT ', cls: 'bad', banner: true },
        l(`  ${who.name}'s balance is not part of what the exchange claims to owe.`, 'dim'),
        l('  nothing on chain looks wrong to anybody else.', 'dim'),
      );
  }

  lines.push(
    l(''),
    l(`  ${out.ms.toFixed(2)} ms · no transaction · no network request · no trace`, 'faint'),
  );
  return lines;
}

/** Prints the transcript a line at a time, the way the tool would emit it. */
async function print(lines: Line[]): Promise<void> {
  const mine = ++run;
  const out = $('#out');
  out.innerHTML = '';

  for (const line of lines) {
    if (mine !== run) return;
    const el = document.createElement('span');
    el.className = `l ${line.cls ?? ''}`;
    if (line.banner) {
      const b = document.createElement('span');
      b.className = `banner ${line.cls ?? ''}`;
      b.textContent = line.text;
      el.append(b);
    } else {
      el.textContent = line.text || ' ';
    }
    out.append(el);
    out.scrollTop = out.scrollHeight;
    if (!reduced) await new Promise((r) => setTimeout(r, line.text ? 14 : 6));
  }

  if (mine !== run) return;
  const caret = document.createElement('span');
  caret.className = 'l caret';
  out.append(caret);
  out.scrollTop = out.scrollHeight;
}

function render(): void {
  const out = picked ? check(picked, pub) : null;

  $('#host').textContent = `${pub.listed.length}/256 places used`;

  $('#chips').innerHTML = BOOK.map(
    (c) =>
      `<button class="arg" data-name="${c.name}" aria-pressed="${picked?.name === c.name}">${c.name.toLowerCase()}</button>`,
  ).join('');

  $('#scenarios').innerHTML = SCENARIOS.map(
    (s) =>
      `<button class="arg" data-scenario="${s.id}" aria-pressed="${pub.scenario === s.id}">${s.id}</button>`,
  ).join('');

  void print(transcript(picked, out));
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
