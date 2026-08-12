// The engraved plate.
//
// Everything here is read from real values: the published root's rosette comes
// from the root's own bytes, each rosette in the chain comes from the hash at
// that step of LiabilitiesTree.foldTrace, and the counterfoil is the actual
// occupancy of the depth-8 tree. Identical hashes engrave identical rosettes,
// so a customer whose fold lands somewhere other than the published root does
// not have to compare 64 hex characters — the two engravings differ on sight.
//
// The motion is printing, not flying: lines of each rosette ink in, one family
// member at a time, the way a plate lays down.

import { drawBand, drawRosette, rosetteFor } from './guilloche.js';
import type { FoldStep } from '../src/merkle-tree.js';

const DEPTH = 8;
const LEAVES = 2 ** DEPTH;

const PRESS_MS = 1500;

const INK = {
  line: '#17302c',
  gold: '#c79a4e',
  good: '#1d6b4b',
  bad: '#a32c25',
};

/** Fixed baselines for everything the plate prints, measured up from the foot. */
interface Bands {
  /** Top of the engraved area, which is centred rather than filling the sheet. */
  top: number;
  foot: number;
  label: number;
  chain: number;
  totals: number;
  finding: number;
  caption: number;
}

export interface Proof {
  trace: FoldStep[];
  leafIndex: number;
  occupied: number;
  publishedRoot: string;
  rootMatches: boolean;
  declaredTotal: bigint;
}

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
/** Progress of a stage that runs from `from` to `to` inside a 0–1 timeline. */
const stage = (t: number, from: number, to: number) => clamp01((t - from) / (to - from));

const money = (n: bigint) =>
  n >= 1_000_000n
    ? `${(Number(n) / 1e6).toFixed(2)}M`
    : n >= 1_000n
      ? `${(Number(n) / 1e3).toFixed(1)}K`
      : String(n);

export class Plate {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private pressedAt = 0;
  private view: Proof | null = null;
  private root = '';
  private reduced: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.addEventListener('resize', () => this.paint(performance.now()));
  }

  /** The root the issuer published — engraved whether or not anyone has checked. */
  setRoot(root: string): void {
    this.root = root;
    this.paint(performance.now());
  }

  setView(view: Proof | null, now = performance.now()): void {
    this.view = view;
    this.pressedAt = now;
    if (this.reduced || !view) this.paint(now);
    else this.run();
  }

  start(): void {
    this.paint(performance.now());
  }

  /** Runs only while a plate is being pressed; a printed certificate is still. */
  private run(): void {
    cancelAnimationFrame(this.raf);
    const frame = (now: number) => {
      this.paint(now);
      if (now - this.pressedAt < PRESS_MS) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // ── painting ──────────────────────────────────────────────────────────────

  private paint(now: number): void {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h || !this.root) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = this.reduced || !this.view ? 1 : easeOutQuart(clamp01((now - this.pressedAt) / PRESS_MS));
    const narrow = w < 720;

    this.counterfoil(w, h, narrow);

    if (!this.view) {
      this.soloRoot(w, h, narrow);
      return;
    }
    this.comparison(w, h, t, narrow);
  }

  /** Before anyone checks: the issuer's root, alone, as the plate's centrepiece. */
  private soloRoot(w: number, h: number, narrow: boolean): void {
    const { ctx } = this;
    const bed = this.bands(w, h, narrow);
    const r = Math.min(w * 0.3, (bed.caption - bed.top - 34) / 2, narrow ? 128 : 200);
    const cy = bed.caption - 24 - r;

    drawRosette(ctx, w / 2, cy, r, rosetteFor(this.root), {
      stroke: INK.gold,
      width: 0.55,
    });
    drawRosette(ctx, w / 2, cy, r * 0.42, rosetteFor(this.root.slice(10)), {
      stroke: INK.line,
      width: 0.45,
    });

    this.caption('WHAT THE EXCHANGE PUBLISHED', w / 2, bed.caption, INK.line);
  }

  /**
   * The plate's vertical budget, measured up from the foot.
   *
   * Every line on it gets a fixed band rather than a fraction of the height:
   * with fractions, shortening the canvas quietly slid the rosette captions
   * down into the chain of steps below them.
   */
  private bands(w: number, h: number, narrow: boolean): Bands {
    // The engraved area is a centred box, not the whole canvas: anchoring every
    // band to the canvas foot meant a taller sheet simply grew empty at the top.
    const box = Math.min(h, narrow ? h : w * 0.56);
    const top = (h - box) / 2;
    const foot = top + box;
    return narrow
      ? { top, foot: foot - 14, label: foot - 32, chain: foot - 64, totals: foot - 88, finding: foot - 106, caption: foot - 124 }
      : { top, foot: foot - 16, label: foot - 38, chain: foot - 84, totals: foot - 116, finding: foot - 116, caption: foot - 138 };
  }

  /** After a check: the customer's climb, engraved beside what was published. */
  private comparison(w: number, h: number, t: number, narrow: boolean): void {
    const view = this.view!;
    const { ctx } = this;

    const bed = this.bands(w, h, narrow);
    const big = Math.min(w * 0.17, narrow ? 66 : 172, (bed.caption - bed.top - 32) / 2);
    const cy = bed.caption - 22 - big;
    const gap = narrow ? w * 0.24 : w * 0.2;
    const mineX = w / 2 - gap;
    const theirsX = w / 2 + gap;

    const mine = view.trace[DEPTH].node.hash;
    const matches = view.rootMatches;

    // The published plate is already printed; only the customer's is pressed now.
    drawRosette(ctx, theirsX, cy, big, rosetteFor(this.root), { stroke: INK.gold, width: 0.55 });
    drawRosette(ctx, theirsX, cy, big * 0.42, rosetteFor(this.root.slice(10)), {
      stroke: INK.line,
      width: 0.45,
    });
    this.caption('THEIRS', theirsX, bed.caption, INK.line);

    const printed = stage(t, 0.34, 0.92);
    if (printed > 0) {
      drawRosette(ctx, mineX, cy, big, rosetteFor(mine), {
        stroke: matches ? INK.gold : INK.bad,
        width: 0.55,
        printed,
      });
      drawRosette(ctx, mineX, cy, big * 0.42, rosetteFor(mine.slice(10)), {
        stroke: matches ? INK.line : INK.bad,
        width: 0.45,
        printed,
      });
    }
    this.caption('YOURS', mineX, bed.caption, matches ? INK.line : INK.bad);

    // ── the finding, set between the two plates ─────────────────────────────
    // A didone equals sign is two hairlines and disappears at this size, so the
    // comparison is spelled out on a rule instead.
    const finding = matches ? 'IDENTICAL' : 'NOT THE SAME';
    if (t > 0.9) {
      const reach = gap - big - 10;
      if (reach > 26) {
        ctx.save();
        ctx.strokeStyle = matches ? INK.good : INK.bad;
        ctx.lineWidth = 0.8;
        for (const dy of matches ? [-3, 3] : [0]) {
          ctx.beginPath();
          ctx.moveTo(w / 2 - reach, cy + dy);
          ctx.lineTo(w / 2 + reach, cy + dy);
          ctx.stroke();
        }
        if (!matches) {
          ctx.beginPath();
          ctx.moveTo(w / 2 - 9, cy + 9);
          ctx.lineTo(w / 2 + 9, cy - 9);
          ctx.stroke();
        }
        ctx.restore();
        this.caption(finding, w / 2, cy - 14, matches ? INK.good : INK.bad);
      } else {
        // Too narrow for a rule between the plates — but this is the finding,
        // so it takes its own band below them rather than being dropped.
        this.caption(finding, w / 2, bed.finding, matches ? INK.good : INK.bad, 'center', narrow);
      }
    }

    // ── the eight steps that got there ──────────────────────────────────────
    this.chain(w, h, t, narrow, bed);

    // ── the sum the tree commits to, against the sum declared ───────────────
    const treeTotal = view.trace[DEPTH].node.sum;
    if (t > 0.94 && treeTotal !== view.declaredTotal) {
      this.caption(
        `BOOK ADDS UP TO ${money(treeTotal)}  ·  THEY DECLARED ${money(view.declaredTotal)}`,
        w / 2,
        bed.totals,
        INK.bad,
        'center',
        narrow,
      );
    }
  }

  /**
   * The fold itself: nine marks, leaf to root, each engraved from the hash of
   * that step. They grow as the subtotal they carry does.
   */
  private chain(w: number, h: number, t: number, narrow: boolean, bed: Bands): void {
    const view = this.view!;
    const { ctx } = this;

    // Stops short of the right margin: that is where the seal is struck.
    const y = bed.chain;
    const left = w * (narrow ? 0.08 : 0.07);
    const span = w * (narrow ? 0.84 : 0.6);
    const step = span / DEPTH;

    ctx.save();
    ctx.strokeStyle = 'rgba(23, 48, 44, 0.32)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + span * clamp01(t / 0.36), y);
    ctx.stroke();
    ctx.restore();

    for (let level = 0; level <= DEPTH; level++) {
      const at = stage(t, (level / DEPTH) * 0.34, (level / DEPTH) * 0.34 + 0.12);
      if (at <= 0) continue;

      const x = left + level * step;
      const radius = (narrow ? 8 : 11) + level * (narrow ? 1.1 : 1.7);
      const node = view.trace[level].node;
      const last = level === DEPTH;

      drawRosette(ctx, x, y, radius, rosetteFor(node.hash), {
        stroke: last && !view.rootMatches ? INK.bad : INK.gold,
        width: 0.45,
        printed: at,
      });
    }

    this.caption('YOU', left, bed.chain + (narrow ? 24 : 30), INK.line);
    this.caption('THE WHOLE BOOK', left + span, bed.chain + (narrow ? 24 : 30), INK.line);
  }

  /**
   * All 256 places in the book, as a counterfoil along the foot of the plate.
   * The issuer committed to a tree this size; four of the places are people.
   */
  private counterfoil(w: number, h: number, narrow: boolean): void {
    const { ctx } = this;
    const bed = this.bands(w, h, narrow);
    const occupied = this.view?.occupied ?? 4;
    const mine = this.view?.leafIndex ?? -1;

    const y = bed.foot;
    const left = 8;
    const span = w - 16;
    const gap = span / (LEAVES - 1);

    ctx.save();
    for (let i = 0; i < LEAVES; i++) {
      const x = left + i * gap;
      const taken = i < occupied;
      const isMine = i === mine;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - (isMine ? 17 : taken ? 12 : 5));
      ctx.strokeStyle = isMine ? INK.bad : taken ? INK.gold : 'rgba(23, 48, 44, 0.26)';
      ctx.lineWidth = isMine ? 1.8 : taken ? 1.5 : 0.7;
      ctx.stroke();
    }
    ctx.restore();

    drawBand(ctx, left, y + 6, span, 7, rosetteFor(this.root), {
      stroke: 'rgba(199, 154, 78, 0.55)',
      width: 0.45,
    });

    this.caption(
      `${occupied} OF ${LEAVES} PLACES USED`,
      left,
      bed.label,
      'rgba(23, 48, 44, 0.6)',
      'left',
      narrow,
    );
  }

  private caption(
    text: string,
    x: number,
    y: number,
    colour: string,
    align: CanvasTextAlign = 'center',
    narrow = false,
  ): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = `500 ${narrow ? 8.5 : 9.5}px "Archivo", system-ui, sans-serif`;
    ctx.letterSpacing = '0.22em';
    ctx.fillStyle = colour;

    // Anchoring alone does not hold: the chain's last label is centred at 92%
    // of the width, so half of it falls off the plate. Measure and clamp.
    const width = ctx.measureText(text).width;
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    ctx.textAlign = 'left';
    ctx.fillText(text, Math.min(Math.max(left, 4), this.canvas.clientWidth - width - 4), y);
    ctx.restore();
  }
}
