// The proof, drawn.
//
// The dots this replaces said "eight steps happened" and nothing else. What the
// customer actually needs to see is the shape of the claim: a book with room for
// 256 people, four of them taken, one of them them — and a path that has to fold
// eight times and land on the figure the exchange published.
//
// Every mark is real. The lattice is the depth-8 tree, the highlighted slot is
// the customer's own index, and each rung of the path carries the hash and
// subtotal from LiabilitiesTree.foldTrace.

import type { Outcome } from '../engine.js';

const DEPTH = 8;
const LEAVES = 2 ** DEPTH;
const DRAW_MS = 760;

const INK = {
  rail: 'rgba(124, 138, 134, 0.28)',
  taken: '#c79a4e',
  mine: '#16211f',
  good: '#0f7b52',
  bad: '#b5342b',
  label: 'rgba(76, 90, 87, 0.95)',
  faint: 'rgba(124, 138, 134, 0.9)',
};

const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

const short = (n: bigint) =>
  n >= 1_000_000n
    ? `${(Number(n) / 1e6).toFixed(2)}M`
    : n >= 1_000n
      ? `${(Number(n) / 1e3).toFixed(1)}K`
      : String(n);

export class ProofView {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private startedAt = 0;
  private out: Outcome | null = null;
  private occupied = 4;
  private declared = 0n;
  private reduced: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.addEventListener('resize', () => this.paint(performance.now()));
  }

  show(out: Outcome | null, occupied: number, declared: bigint): void {
    this.out = out;
    this.occupied = occupied;
    this.declared = declared;
    this.startedAt = performance.now();

    cancelAnimationFrame(this.raf);
    if (!out || this.reduced) {
      this.paint(this.startedAt + DRAW_MS);
      return;
    }
    const frame = (now: number) => {
      this.paint(now);
      if (now - this.startedAt < DRAW_MS) this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  // ── geometry ──────────────────────────────────────────────────────────────

  private geometry(w: number, h: number) {
    const padX = 8;
    // The ruler is a band, not a hairline: it carries the scale of the claim
    // (256 places, four of them people) and has to be legible on its own.
    const base = h - 52;
    const apex = 24;
    const span = w - padX * 2;
    return { padX, base, apex, span };
  }

  /** x of a node, given how far up the tree it sits. Levels narrow as they rise. */
  private nodeX(level: number, index: number, w: number): number {
    const { padX, span } = this.geometry(w, 0);
    const count = 2 ** (DEPTH - level);
    const t = level / DEPTH;
    const width = span * (1 - t * 0.55);
    const left = padX + (span - width) / 2;
    return count === 1 ? w / 2 : left + (index / (count - 1)) * width;
  }

  private levelY(level: number, h: number): number {
    const { base, apex } = this.geometry(0, h);
    return base - (base - apex) * (level / DEPTH) ** 0.85;
  }

  // ── painting ──────────────────────────────────────────────────────────────

  private paint(now: number): void {
    const { ctx, canvas } = this;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = this.out ? easeOutQuart(clamp01((now - this.startedAt) / DRAW_MS)) : 1;

    this.book(w, h);
    if (this.out) this.fold(w, h, t);
    this.legend(w, h);
  }

  /**
   * The whole book: 256 places along the foot, the ones in use picked out. The
   * emptiness is the point — the exchange committed to a tree this size.
   */
  private book(w: number, h: number): void {
    const { ctx } = this;
    const { base } = this.geometry(w, h);
    const mine = this.out?.leafIndex ?? -1;

    for (let i = 0; i < LEAVES; i++) {
      const x = this.nodeX(0, i, w);
      const taken = i < this.occupied;
      const isMine = i === mine;
      // Every 32nd place is drawn longer, so the strip reads as a scale and the
      // eye can count across it instead of guessing at a field of hairlines.
      const major = i % 32 === 0;
      const height = isMine ? 30 : taken ? 22 : major ? 12 : 7;

      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, base - height);
      ctx.strokeStyle = isMine
        ? INK.mine
        : taken
          ? INK.taken
          : major
            ? 'rgba(124, 138, 134, 0.5)'
            : INK.rail;
      ctx.lineWidth = isMine ? 2.4 : taken ? 2 : 1;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(this.nodeX(0, 0, w), base + 0.5);
    ctx.lineTo(this.nodeX(0, LEAVES - 1, w), base + 0.5);
    ctx.strokeStyle = 'rgba(124, 138, 134, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // The scale, numbered, so "256 places" is something you can see rather than
    // a figure you are asked to take on trust.
    ctx.font = '500 10px "Azeret Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(124, 138, 134, 0.95)';
    for (let i = 0; i <= LEAVES; i += 64) {
      const at = Math.min(i, LEAVES - 1);
      this.text(String(i === LEAVES ? 256 : i), this.nodeX(0, at, w), base + 15, 'center', w);
    }
  }

  /** The eight folds, drawn as they run. */
  private fold(w: number, h: number, t: number): void {
    const { ctx } = this;
    const out = this.out!;

    const pts: Array<{ x: number; y: number }> = [];
    let index = out.leafIndex;
    for (let level = 0; level <= DEPTH; level++) {
      pts.push({ x: this.nodeX(level, index, w), y: this.levelY(level, h) });
      index = Math.floor(index / 2);
    }

    const reached = t * DEPTH;
    const whole = Math.floor(reached);
    const frac = reached - whole;
    const done = reached >= DEPTH;
    const ink = !done ? INK.taken : out.rootMatches ? INK.good : INK.bad;

    const hx = whole < DEPTH ? pts[whole].x + (pts[whole + 1].x - pts[whole].x) * frac : pts[DEPTH].x;
    const hy = whole < DEPTH ? pts[whole].y + (pts[whole + 1].y - pts[whole].y) * frac : pts[DEPTH].y;

    // the path so far
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= whole; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineTo(hx, hy);
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // the siblings each fold took on
    ctx.font = '500 10px "Azeret Mono", ui-monospace, monospace';
    for (let level = 1; level <= whole; level++) {
      const step = out.trace[level];
      if (!step.sibling) continue;

      const childIndex = Math.floor(out.leafIndex / 2 ** (level - 1));
      const siblingIndex = step.onRight ? childIndex - 1 : childIndex + 1;
      const count = 2 ** (DEPTH - (level - 1));
      if (siblingIndex < 0 || siblingIndex >= count) continue;

      const sx = this.nodeX(level - 1, siblingIndex, w);
      const sy = this.levelY(level - 1, h);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(pts[level].x, pts[level].y);
      ctx.strokeStyle = 'rgba(124, 138, 134, 0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = INK.faint;
      ctx.fill();

      // Level 1's sibling sits a couple of pixels from the customer's own tick,
      // so its amount would print over the ruler. Put it on the far side of the
      // sibling from the path, and only where the marks are far enough apart.
      if (step.sibling.sum > 0n && level <= 3) {
        const gap = Math.abs(sx - pts[level - 1].x);
        if (gap > 3) {
          ctx.fillStyle = INK.label;
          const away = sx >= pts[level - 1].x ? 1 : -1;
          // A level-1 sibling stands among the ruler's ticks, and the tallest of
          // those is 30px, so its amount has to clear them rather than print
          // inside them.
          this.text(
            `+${short(step.sibling.sum)}`,
            sx + away * 7,
            sy - (level === 1 ? 36 : 9),
            away > 0 ? 'left' : 'right',
            w,
          );
        }
      }
    }

    // the head, carrying the running subtotal
    const head = out.trace[Math.min(whole, DEPTH)];
    ctx.beginPath();
    ctx.arc(hx, hy, done ? 4.5 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = ink;
    ctx.fill();

    ctx.font = '500 12px "Azeret Mono", ui-monospace, monospace';
    if (!done) {
      ctx.fillStyle = INK.mine;
      this.text(short(head.node.sum), hx + 9, hy + 4, 'left', w);
      return;
    }

    // When the fold is sound but the declared figure is not, the path is green
    // and the card is red, which on its own reads as a contradiction. Put the
    // two numbers head to head at the root so the disagreement is the picture,
    // not a sentence underneath it.
    if (head.node.sum !== this.declared) {
      // Below the apex, not above it: the root sits 18px from the top edge and
      // a stacked pair printed upwards loses its first line off the canvas.
      ctx.fillStyle = INK.good;
      this.text(`book ${short(head.node.sum)}`, hx, hy + 18, 'center', w);
      ctx.fillStyle = INK.bad;
      this.text(`declared ${short(this.declared)}`, hx, hy + 33, 'center', w);
    } else {
      ctx.fillStyle = ink;
      this.text(short(head.node.sum), hx, hy - 11, 'center', w);
    }
  }

  /** A key, because three colours of tick mean nothing without one. */
  private legend(w: number, h: number): void {
    const { ctx } = this;
    const { base, padX } = this.geometry(w, h);
    const y = base + 36;

    ctx.font = '500 11px "Archivo", system-ui, sans-serif';
    let x = padX;

    const entry = (colour: string, text: string, weight = 2) => {
      ctx.beginPath();
      ctx.moveTo(x, y - 3);
      ctx.lineTo(x, y - 11);
      ctx.strokeStyle = colour;
      ctx.lineWidth = weight;
      ctx.stroke();

      ctx.fillStyle = INK.label;
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 7, y);
      x += ctx.measureText(text).width + 28;
    };

    entry(INK.taken, `${this.occupied} places used`);
    if (this.out) entry(INK.mine, 'you', 2.4);
    entry(INK.rail, `${LEAVES - this.occupied} still empty`, 1);
  }

  /** Draws text that is guaranteed to stay inside the canvas. */
  private text(s: string, x: number, y: number, align: CanvasTextAlign, w: number): void {
    const { ctx } = this;
    const width = ctx.measureText(s).width;
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    ctx.textAlign = 'left';
    ctx.fillText(s, Math.min(Math.max(left, 2), w - width - 2), y);
  }
}
