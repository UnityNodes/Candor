// The field.
//
// Every mark here is a real slot in the depth-8 tree, and the bright trace is
// the customer's actual fold — the steps come from LiabilitiesTree.foldTrace,
// carrying the hash and the running subtotal the circuit computes. Nothing is
// illustrative.
//
// It runs as a continuous surface rather than a one-shot drawing: at rest a
// slow sweep passes over the book, which is what a page about *looking* should
// do while nobody has looked yet.

import type { FoldStep } from '../src/merkle-tree.js';

const DEPTH = 8;
const LEAVES = 2 ** DEPTH;

const PAD_X = 34;
const PAD_TOP = 58;
const PAD_BOTTOM = 46;

const REVEAL_MS = 900;
const CLIMB_MS = 1150;
const SWEEP_MS = 7000;

const INK = {
  occupied: '#c79a4e',
  covered: '#59c08b',
  missing: '#e2564a',
  ink: '#f1f5f9',
};

export interface TreeView {
  /** The real fold: index 0 is the leaf, index 8 the root. */
  trace: FoldStep[];
  /** Which leaf slot the customer occupies. */
  leafIndex: number;
  /** How many slots the issuer actually filled. */
  occupied: number;
  /** The root the issuer published, to compare the climb against. */
  publishedRoot: string;
  /** Whether the climb lands on that root at all. */
  rootMatches: boolean;
  /** What the issuer says it owes, which the climb may contradict. */
  declaredTotal: bigint;
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

const money = (n: bigint) =>
  n >= 1_000_000n
    ? `${(Number(n) / 1e6).toFixed(2)}M`
    : n >= 1_000n
      ? `${(Number(n) / 1e3).toFixed(1)}K`
      : String(n);

export class TreeField {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private born = 0;
  private climbFrom = 0;
  private view: TreeView | null = null;
  private reduced: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Passing a view starts the climb; passing null returns the field to rest. */
  setView(view: TreeView | null, now = performance.now()): void {
    this.view = view;
    this.climbFrom = now;
    if (this.reduced) this.paint(now);
    else if (!this.raf) this.start();
  }

  start(): void {
    // With motion turned down there is nothing to animate — the field is drawn
    // in its settled state — so hold no frame loop at all and repaint only when
    // the layout changes underneath it.
    if (this.reduced) {
      const repaint = () => this.paint(performance.now());
      repaint();
      window.addEventListener('resize', repaint);
      return;
    }

    if (this.raf) return;
    const frame = (now: number) => {
      if (!this.born) this.born = now;
      this.paint(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ── geometry ──────────────────────────────────────────────────────────────

  /**
   * On a wide screen the type takes the left of the plate and the field takes
   * the right, so the drawing is inset rather than centred. Below that width
   * they stack and the field spans everything.
   */
  private region(w: number) {
    const x0 = w >= 1000 ? w * 0.44 : 0;
    return { x0: x0 + PAD_X, width: w - x0 - PAD_X * 2 };
  }

  private levelGeometry(level: number, w: number, h: number) {
    const count = 2 ** (DEPTH - level);
    const t = level / DEPTH;
    const { x0, width } = this.region(w);
    const span = width * (1 - t * 0.62);
    const left = x0 + (width - span) / 2;
    // Three quarters of the 511 nodes live in the bottom two levels, so the
    // vertical spacing opens up where the density is and closes toward the
    // apex, where each level holds a handful.
    const y = h - PAD_BOTTOM - (h - PAD_TOP - PAD_BOTTOM) * t ** 0.8;
    return { count, span, left, y, step: count > 1 ? span / (count - 1) : 0 };
  }

  private nodeX(level: number, index: number, w: number, h: number) {
    const g = this.levelGeometry(level, w, h);
    return g.count === 1 ? w / 2 : g.left + index * g.step;
  }

  /**
   * Draws text guaranteed to sit inside the canvas. Anchoring alone does not
   * hold at the edges: the leftmost customer's siblings are a few pixels from
   * x=0, so a centred label there loses its first glyphs.
   */
  private label(
    text: string,
    x: number,
    y: number,
    align: CanvasTextAlign,
    backed = false,
  ): void {
    const { ctx } = this;
    const metrics = ctx.measureText(text);
    const width = metrics.width;
    const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
    const at = Math.min(Math.max(left, 6), this.canvas.clientWidth - width - 6);

    // A number that has to be read exactly cannot be left sitting on the weave.
    // On a short canvas there is nowhere to move it to, so it gets a ground.
    //
    // Sized from the glyph metrics rather than from the font string: parseFloat
    // on `500 15px "Azeret Mono"` returns the weight, not the size, and quietly
    // gives you a 500px-tall backing plate.
    if (backed) {
      const ink = ctx.fillStyle;
      const top = y - metrics.actualBoundingBoxAscent - 3;
      const height = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 6;
      ctx.fillStyle = 'rgba(5, 7, 14, 0.72)';
      ctx.fillRect(at - 4, top, width + 8, height);
      ctx.fillStyle = ink;
    }

    ctx.textAlign = 'left';
    ctx.fillText(text, at, y);
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

    const view = this.view;
    const reveal = this.reduced ? 1 : easeOutQuart(clamp01((now - this.born) / REVEAL_MS));
    const climb = !view ? 0 : this.reduced ? 1 : easeOutQuart(clamp01((now - this.climbFrom) / CLIMB_MS));

    const sumMatches = view ? view.trace[DEPTH].node.sum === view.declaredTotal : false;
    const good = view ? view.rootMatches && sumMatches : false;

    this.lattice(w, h, view, reveal, now);
    if (view) this.climbPath(w, h, view, climb, sumMatches, good);
  }

  /**
   * All 511 nodes. Drawing the whole capacity — not just the four slots in use —
   * is the only way the scale of what the issuer committed to is visible: a
   * book with room for 256 names, four of them taken.
   */
  private lattice(w: number, h: number, view: TreeView | null, reveal: number, now: number): void {
    const { ctx } = this;
    const occupied = view?.occupied ?? 4;

    // A slow band travelling over the book. Nothing is happening yet, but the
    // page is about looking, so it looks.
    const sweep = this.reduced ? -1 : ((now % SWEEP_MS) / SWEEP_MS) * (w + 260) - 130;

    // Every edge is a real hash: each node is fed by exactly two below it. At
    // this weight they do not read as lines, they read as the weave the marks
    // are set into — which is what turns 511 scattered dots into a structure.
    ctx.strokeStyle = 'rgba(130, 152, 184, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let level = 1; level <= DEPTH; level++) {
      const above = this.levelGeometry(level, w, h);
      const below = this.levelGeometry(level - 1, w, h);
      const gate = clamp01(reveal * 1.35 - level * 0.035);
      for (let i = 0; i < above.count; i++) {
        if (i / above.count > gate) break;
        const px = this.nodeX(level, i, w, h);
        ctx.moveTo(this.nodeX(level - 1, i * 2, w, h), below.y);
        ctx.lineTo(px, above.y);
        ctx.lineTo(this.nodeX(level - 1, i * 2 + 1, w, h), below.y);
      }
    }
    ctx.stroke();

    for (let level = DEPTH; level >= 0; level--) {
      const g = this.levelGeometry(level, w, h);
      const filledNodes = Math.ceil(occupied / 2 ** level);
      // The intro sweeps in from the left, so the ruler assembles rather than
      // appearing. Upper levels land fractionally later than the leaves.
      const gate = clamp01(reveal * 1.35 - level * 0.035);

      if (level === 0) {
        // A dense band of hairlines rather than dots: 256 of anything reads as
        // noise unless it reads as a ruler, and the ruler is the whole point —
        // this is the size of the book, most of it empty.
        for (let i = 0; i < g.count; i++) {
          if (i / g.count > gate) break;
          const x = this.nodeX(0, i, w, h);
          const filled = i < filledNodes;
          const near = sweep < 0 ? 0 : Math.max(0, 1 - Math.abs(x - sweep) / 150) ** 2;

          ctx.beginPath();
          ctx.moveTo(x, g.y);
          ctx.lineTo(x, g.y - (filled ? 34 : 11 + near * 9));
          ctx.strokeStyle = filled ? INK.occupied : `rgba(130, 152, 184, ${0.3 + near * 0.55})`;
          ctx.lineWidth = filled ? 2.5 : 1;
          ctx.stroke();
        }
        continue;
      }

      // Levels 1 and 2 still hold 128 and 64 nodes; keeping them as short
      // strokes carries the density up out of the ruler instead of dropping
      // straight to scattered dots.
      const ticks = level <= 2;
      for (let i = 0; i < g.count; i++) {
        if (i / Math.max(g.count, 1) > gate) break;
        const x = this.nodeX(level, i, w, h);
        const filled = i < filledNodes;
        const near = sweep < 0 ? 0 : Math.max(0, 1 - Math.abs(x - sweep) / 150) ** 2;
        const colour = filled ? INK.occupied : `rgba(130, 152, 184, ${0.26 + near * 0.45})`;

        if (ticks) {
          ctx.beginPath();
          ctx.moveTo(x, g.y + (filled ? 8 : 4));
          ctx.lineTo(x, g.y - (filled ? 8 : 4));
          ctx.strokeStyle = colour;
          ctx.lineWidth = filled ? 2.2 : 1;
          ctx.stroke();
          continue;
        }

        ctx.beginPath();
        ctx.arc(x, g.y, 1.9 + level * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      }
    }

    ctx.font = '400 11px "Azeret Mono", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(160, 175, 196, 0.9)';
    ctx.letterSpacing = '0.1em';
    const base = this.levelGeometry(0, w, h);
    this.label(
      `${occupied} OF ${LEAVES} SLOTS TAKEN`,
      base.left + base.span,
      base.y + 22,
      'right',
    );
    ctx.letterSpacing = '0px';
  }

  /** The customer's fold, one level at a time, exactly as the circuit runs it. */
  private climbPath(
    w: number,
    h: number,
    view: TreeView,
    progress: number,
    sumMatches: boolean,
    good: boolean,
  ): void {
    const { ctx } = this;

    const pts: Array<{ x: number; y: number }> = [];
    let index = view.leafIndex;
    for (let level = 0; level <= DEPTH; level++) {
      pts.push({ x: this.nodeX(level, index, w, h), y: this.levelGeometry(level, w, h).y });
      index = Math.floor(index / 2);
    }

    const reached = progress * DEPTH;
    const whole = Math.floor(reached);
    const frac = reached - whole;
    const done = reached >= DEPTH;
    const end = good ? INK.covered : INK.missing;

    const hx = whole < DEPTH ? pts[whole].x + (pts[whole + 1].x - pts[whole].x) * frac : pts[DEPTH].x;
    const hy = whole < DEPTH ? pts[whole].y + (pts[whole + 1].y - pts[whole].y) * frac : pts[DEPTH].y;

    // ── siblings already consumed ───────────────────────────────────────────
    ctx.font = '400 11px "Azeret Mono", ui-monospace, monospace';
    for (let level = 1; level <= whole; level++) {
      const step = view.trace[level];
      if (!step?.sibling) continue;

      const g = this.levelGeometry(level - 1, w, h);
      const childIndex = Math.floor(view.leafIndex / 2 ** (level - 1));
      const siblingIndex = step.onRight ? childIndex - 1 : childIndex + 1;
      if (siblingIndex < 0 || siblingIndex >= g.count) continue;

      const sx = this.nodeX(level - 1, siblingIndex, w, h);
      const alpha = 0.9 - Math.min((reached - level) / 2.2, 1) * 0.55;

      ctx.beginPath();
      ctx.moveTo(sx, g.y);
      ctx.lineTo(pts[level].x, pts[level].y);
      ctx.strokeStyle = `rgba(241, 245, 249, ${alpha * 0.3})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sx, g.y, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(241, 245, 249, ${alpha})`;
      ctx.fill();

      if (step.sibling.sum > 0n && level <= 3) {
        ctx.fillStyle = `rgba(241, 245, 249, ${alpha * 0.85})`;
        const away = sx >= pts[level - 1].x ? 1 : -1;
        this.label(`+${money(step.sibling.sum)}`, sx + away * 9, g.y - 11, away > 0 ? 'left' : 'right');
      }
    }

    // ── the beam ────────────────────────────────────────────────────────────
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const trace = (width: number, colour: string) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i <= whole; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (whole < DEPTH) ctx.lineTo(hx, hy);
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    trace(12, done ? hexA(end, 0.16) : 'rgba(199, 154, 78, 0.15)');
    trace(3, done ? end : INK.occupied);

    // ── the head, carrying the running subtotal ─────────────────────────────
    const head = view.trace[Math.min(whole, DEPTH)];

    ctx.beginPath();
    ctx.arc(hx, hy, done ? 6.5 : 4.5, 0, Math.PI * 2);
    ctx.fillStyle = done ? end : INK.occupied;
    ctx.fill();

    ctx.font = '500 15px "Azeret Mono", ui-monospace, monospace';
    ctx.fillStyle = INK.ink;
    if (!done) {
      this.label(money(head.node.sum), hx + 14, hy + 5, 'left', true);
      return;
    }

    // ── the apex ────────────────────────────────────────────────────────────
    const apex = pts[DEPTH];
    if (view.rootMatches && !sumMatches) {
      // The climb lands exactly where the issuer said it would; what disagrees
      // is the number. Drawing a fork in the hash here would be a lie, so the
      // two totals go head to head instead.
      ctx.fillStyle = INK.covered;
      this.label(`tree ${money(head.node.sum)}`, hx, hy + 30, 'center', true);
      ctx.fillStyle = INK.missing;
      this.label(`declared ${money(view.declaredTotal)}`, hx, hy + 50, 'center', true);
    } else {
      ctx.fillStyle = good ? INK.covered : INK.missing;
      this.label(money(head.node.sum), hx, hy + 30, 'center', true);
    }

    ctx.font = '400 11px "Azeret Mono", ui-monospace, monospace';
    ctx.letterSpacing = '0.08em';

    if (view.rootMatches) {
      ctx.fillStyle = 'rgba(89, 192, 139, 0.95)';
      this.label('LANDS ON THE PUBLISHED ROOT', apex.x, apex.y - 24, 'center', true);
    } else {
      // The published root as a second, separate apex. The gap between them is
      // the entire finding, so it gets room and a broken line.
      const ghostX = Math.min(apex.x + 150, w - 74);

      ctx.setLineDash([3, 6]);
      ctx.beginPath();
      ctx.moveTo(apex.x + 11, apex.y);
      ctx.lineTo(ghostX - 11, apex.y);
      ctx.strokeStyle = hexA(INK.missing, 0.75);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(ghostX, apex.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
      ctx.fill();

      ctx.fillStyle = hexA(INK.missing, 0.95);
      this.label('YOUR CLIMB', apex.x, apex.y - 24, 'center', true);
      ctx.fillStyle = 'rgba(170, 185, 205, 0.95)';
      this.label('PUBLISHED ROOT', ghostX, apex.y - 24, 'center', true);
    }
    ctx.letterSpacing = '0px';
  }
}

/** #rrggbb + alpha, so one palette entry can serve both fills and washes. */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
