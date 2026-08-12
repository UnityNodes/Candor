// The tree, drawn from the fold that actually ran.
//
// Every dot is a real slot in the depth-8 tree; every rung of the bright path is
// a real step from LiabilitiesTree.foldTrace, carrying the hash and subtotal the
// circuit would compute. The animation replays that climb — it does not stand in
// for it.

import type { FoldStep } from '../src/merkle-tree.js';

const DEPTH = 8;
const LEAVES = 2 ** DEPTH;

const INK = {
  dormant: 'rgba(122, 140, 168, 0.24)',
  occupied: 'rgba(199, 154, 78, 0.55)',
  beam: '#c79a4e',
  beamGlow: 'rgba(199, 154, 78, 0.30)',
  sibling: 'rgba(241, 245, 249, 0.62)',
  covered: '#6ea88a',
  missing: '#c2564e',
  label: 'rgba(241, 245, 249, 0.88)',
  faint: 'rgba(122, 140, 168, 0.60)',
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

// Horizontal room for the lattice; more headroom at the top than at the foot,
// because the apex carries a label above it and the leaf row does not.
const PAD_X = 26;
const PAD_TOP = 42;
const PAD_BOTTOM = 30;

/**
 * Draws text guaranteed to sit inside the canvas.
 *
 * Anchoring alone is not enough at the edges: the leftmost customer's siblings
 * are a few pixels from x=0, so a centred label there loses its first glyphs.
 * Measuring and clamping is the only thing that actually holds.
 */
function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
): void {
  const width = ctx.measureText(text).width;
  const left = align === 'center' ? x - width / 2 : align === 'right' ? x - width : x;
  const clamped = Math.min(Math.max(left, 4), ctx.canvas.clientWidth - width - 4);

  ctx.textAlign = 'left';
  ctx.fillText(text, clamped, y);
}

const money = (n: bigint) =>
  n >= 1_000_000n
    ? `${(Number(n) / 1e6).toFixed(2)}M`
    : n >= 1_000n
      ? `${(Number(n) / 1e3).toFixed(1)}K`
      : String(n);

/**
 * Level L holds 2^(DEPTH-L) nodes. Levels narrow as they rise so the lattice
 * reads as converging on a single root rather than as a grid.
 */
function levelGeometry(level: number, w: number, h: number) {
  const count = 2 ** (DEPTH - level);
  const t = level / DEPTH;
  const span = (w - PAD_X * 2) * (1 - t * 0.72);
  const left = (w - span) / 2;
  const y = h - PAD_BOTTOM - (h - PAD_TOP - PAD_BOTTOM) * t;
  return { count, span, left, y, step: count > 1 ? span / (count - 1) : 0 };
}

function nodeX(level: number, index: number, w: number, h: number) {
  const g = levelGeometry(level, w, h);
  return g.count === 1 ? w / 2 : g.left + index * g.step;
}

export function drawTree(
  canvas: HTMLCanvasElement,
  view: TreeView | null,
  progress: number,
): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return;

  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }

  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // rAF hands back the frame's start time, which can predate a performance.now()
  // taken moments earlier — so progress can arrive negative. Clamp before it
  // reaches an array index.
  progress = Math.min(Math.max(progress, 0), 1);

  // ── the lattice ──────────────────────────────────────────────────────────
  // Occupied subtrees sit on the left; everything else is an empty slot the
  // tree still commits to. Drawing all 511 nodes is what makes the scale real.
  for (let level = 0; level <= DEPTH; level++) {
    const g = levelGeometry(level, w, h);
    const occupiedNodes = view ? Math.ceil(view.occupied / 2 ** level) : 0;

    if (level === 0) {
      // 256 dots read as noise. Ticks read as a ruler, which is the point:
      // this is the whole capacity of the tree, mostly empty.
      for (let i = 0; i < g.count; i++) {
        const filled = i < occupiedNodes;
        const x = nodeX(0, i, w, h);
        ctx.beginPath();
        ctx.moveTo(x, g.y - (filled ? 6 : 2.5));
        ctx.lineTo(x, g.y);
        ctx.strokeStyle = filled ? INK.occupied : INK.dormant;
        ctx.lineWidth = filled ? 1.6 : 1;
        ctx.stroke();
      }
      continue;
    }

    const dot = 1.3 + level * 0.2;
    for (let i = 0; i < g.count; i++) {
      ctx.beginPath();
      ctx.arc(nodeX(level, i, w, h), g.y, dot, 0, Math.PI * 2);
      ctx.fillStyle = i < occupiedNodes ? INK.occupied : INK.dormant;
      ctx.fill();
    }
  }

  if (view) {
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = INK.faint;
    label(ctx, `${view.occupied} of ${LEAVES} slots filled`, PAD_X, h - 6, 'left');
  }

  if (!view) return;

  // ── the path the customer's leaf takes ───────────────────────────────────
  const pts: Array<{ x: number; y: number }> = [];
  let index = view.leafIndex;
  for (let level = 0; level <= DEPTH; level++) {
    const g = levelGeometry(level, w, h);
    pts.push({ x: nodeX(level, index, w, h), y: g.y });
    index = Math.floor(index / 2);
  }

  const reached = Math.min(progress * DEPTH, DEPTH);
  const whole = Math.floor(reached);
  const frac = reached - whole;
  const sumMatches = view.trace[DEPTH].node.sum === view.declaredTotal;
  const clean = view.rootMatches && sumMatches;
  const endColour = clean ? INK.covered : INK.missing;

  // the beam, with a soft bloom under it
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [width, colour] of [
    [7, INK.beamGlow],
    [2, INK.beam],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i <= whole; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (whole < DEPTH && frac > 0) {
      const a = pts[whole];
      const b = pts[whole + 1];
      ctx.lineTo(a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac);
    }
    ctx.strokeStyle = reached >= DEPTH ? (width === 2 ? endColour : colour) : colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // ── siblings consumed so far, and the subtotal each one adds ─────────────
  ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';

  for (let level = 1; level <= whole; level++) {
    const step = view.trace[level];
    if (!step?.sibling) continue;

    const g = levelGeometry(level - 1, w, h);
    const childIndex = Math.floor(view.leafIndex / 2 ** (level - 1));
    const siblingIndex = step.onRight ? childIndex - 1 : childIndex + 1;
    if (siblingIndex < 0 || siblingIndex >= g.count) continue;

    const sx = nodeX(level - 1, siblingIndex, w, h);
    const age = Math.min((reached - level) / 1.6, 1);
    const alpha = 0.95 - age * 0.55;

    ctx.beginPath();
    ctx.arc(sx, g.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(241, 245, 249, ${alpha})`;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(sx, g.y);
    ctx.lineTo(pts[level].x, pts[level].y);
    ctx.strokeStyle = `rgba(241, 245, 249, ${alpha * 0.32})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (step.sibling.sum > 0n && level <= 3) {
      ctx.fillStyle = `rgba(241, 245, 249, ${alpha * 0.8})`;
      // Lay the amount on the far side of the sibling from the path, so it
      // never sits on the beam it is being added to.
      const away = sx >= pts[level - 1].x ? 1 : -1;
      label(ctx, `+${money(step.sibling.sum)}`, sx + away * 8, g.y - 9, away > 0 ? 'left' : 'right');
    }
  }

  // ── the running subtotal, riding the head of the beam ────────────────────
  const head = view.trace[Math.min(whole, DEPTH)];
  const hx = whole < DEPTH && frac > 0
    ? pts[whole].x + (pts[whole + 1].x - pts[whole].x) * frac
    : pts[whole].x;
  const hy = whole < DEPTH && frac > 0
    ? pts[whole].y + (pts[whole + 1].y - pts[whole].y) * frac
    : pts[whole].y;

  ctx.beginPath();
  ctx.arc(hx, hy, reached >= DEPTH ? 5 : 3.5, 0, Math.PI * 2);
  ctx.fillStyle = reached >= DEPTH ? endColour : INK.beam;
  ctx.fill();

  ctx.font = '500 12px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = INK.label;
  if (reached >= DEPTH) {
    if (view.rootMatches && !sumMatches) {
      // Same root, different totals — put the two numbers head to head.
      ctx.fillStyle = INK.covered;
      label(ctx, `tree ${money(head.node.sum)}`, hx, hy + 20, 'center');
      ctx.fillStyle = INK.missing;
      label(ctx, `declared ${money(view.declaredTotal)}`, hx, hy + 36, 'center');
    } else {
      label(ctx, money(head.node.sum), hx, hy + 20, 'center');
    }
  } else {
    label(ctx, money(head.node.sum), hx + 12, hy + 4, 'left');
  }

  // ── the apex: does the climb land on what the issuer published? ──────────
  if (reached >= DEPTH) {
    const apex = pts[DEPTH];
    ctx.font = '500 10px "IBM Plex Mono", ui-monospace, monospace';

    if (clean || view.rootMatches) {
      // When only the total disagrees, the climb still lands exactly where the
      // issuer said it would. Drawing a fork in the hash here would be a lie;
      // the two numbers below the apex carry the finding instead.
      ctx.fillStyle = INK.covered;
      label(ctx, 'lands on the published root', apex.x, apex.y - 18, 'center');
    } else {
      // The published root as a second, separate apex. The gap between them is
      // the whole finding, so give it room.
      const ghostX = Math.min(apex.x + 130, w - 60);
      ctx.beginPath();
      ctx.arc(ghostX, apex.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = INK.faint;
      ctx.fill();

      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(apex.x + 9, apex.y);
      ctx.lineTo(ghostX - 9, apex.y);
      ctx.strokeStyle = INK.missing;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = INK.missing;
      label(ctx, 'your climb', apex.x, apex.y - 18, 'center');
      ctx.fillStyle = INK.faint;
      label(ctx, 'published root', ghostX, apex.y - 18, 'center');
    }
  }
}

/** Replays the climb. Returns a cancel handle. */
export function animateTree(
  canvas: HTMLCanvasElement,
  view: TreeView,
  durationMs: number,
): () => void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    drawTree(canvas, view, 1);
    return () => {};
  }

  let raf = 0;
  const started = performance.now();

  const frame = (now: number) => {
    const t = Math.min(Math.max((now - started) / durationMs, 0), 1);
    drawTree(canvas, view, easeOutQuart(t));
    if (t < 1) raf = requestAnimationFrame(frame);
  };

  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
