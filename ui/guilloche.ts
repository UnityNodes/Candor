// Guilloché.
//
// Security printing uses these rosettes because they cannot be redrawn by hand:
// the pattern is the exact output of a machine's gear ratios, and any deviation
// is visible. That is the same argument the contract makes about a hash, which
// is why the rosettes here are not decoration — every parameter is read out of
// the hash being displayed.
//
// Two identical hashes therefore print identical rosettes, and two different
// hashes print visibly different ones. When the customer's fold lands somewhere
// other than the published root, they do not have to compare 64 hex characters:
// the two engravings simply do not match.

/** A hypotrochoid family, fully determined by the bytes it was read from. */
export interface Rosette {
  /** Ratio of the rolling circle to the fixed one — sets the petal count. */
  petals: number;
  /** How far the tracing point sits from the rolling circle's centre. */
  reach: number;
  /** Lines in the family. More lines, denser engraving. */
  lines: number;
  /** Angle between successive lines in the family. */
  drift: number;
  /** Whole-rosette rotation, so two similar patterns still read apart. */
  phase: number;
}

const byteAt = (hex: string, i: number): number => {
  const at = (i * 2) % (hex.length - 1);
  return parseInt(hex.slice(at, at + 2), 16) || 0;
};

/**
 * Reads a rosette out of a hash.
 *
 * The ranges are chosen so that every hash prints something a plate engraver
 * would recognise — enough petals to read as a rosette, not so many that the
 * lines collapse into a disc.
 */
export function rosetteFor(hash: string): Rosette {
  const hex = hash.startsWith('0x') ? hash.slice(2) : hash;
  return {
    petals: 5 + (byteAt(hex, 0) % 14),
    reach: 0.34 + (byteAt(hex, 1) / 255) * 0.46,
    lines: 22 + (byteAt(hex, 2) % 20),
    drift: 0.006 + (byteAt(hex, 3) / 255) * 0.05,
    phase: (byteAt(hex, 4) / 255) * Math.PI * 2,
  };
}

/**
 * Draws one line of the family: a hypotrochoid, the curve traced by a point
 * fixed to a circle rolling inside another circle.
 */
/**
 * The traced point swings outside the fixed circle by `reach`, so a rosette
 * drawn at its nominal radius overruns it by up to 70%. Scaling the base down
 * by the curve's own maximum extent makes `radius` mean what it says.
 */
const fit = (radius: number, r: Rosette) => radius / (1 - 1 / r.petals + r.reach);

function trace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  nominal: number,
  r: Rosette,
  offset: number,
  steps: number,
): void {
  const radius = fit(nominal, r);
  const inner = radius / r.petals;
  const roll = radius - inner;
  const reach = inner * r.reach * r.petals;
  const turns = Math.PI * 2;

  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * turns;
    const k = (roll / inner) * t;
    const a = t + r.phase + offset;
    const x = cx + roll * Math.cos(a) + reach * Math.cos(k - offset * 3);
    const y = cy + roll * Math.sin(a) - reach * Math.sin(k - offset * 3);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export interface RosetteInk {
  /** Line colour. Two-plate printing: one ink for the field, one for the mark. */
  stroke: string;
  /** Line weight in CSS pixels. Engraving is hairlines, not strokes. */
  width?: number;
  /** 0–1, how much of the family has been printed. Drives the plate animation. */
  printed?: number;
}

export function drawRosette(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  r: Rosette,
  ink: RosetteInk,
): void {
  const printed = ink.printed ?? 1;
  const count = Math.max(1, Math.round(r.lines * printed));
  // Small rosettes need fewer samples; a 20px mark does not repay 900 of them.
  const steps = Math.max(120, Math.min(760, Math.round(radius * 7)));

  ctx.save();
  ctx.strokeStyle = ink.stroke;
  ctx.lineWidth = ink.width ?? 0.6;
  ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) trace(ctx, cx, cy, radius, r, i * r.drift, steps);
  ctx.restore();
}

/**
 * The repeating band that runs around the edge of a certificate. Same machine,
 * unrolled: a wave whose frequency and amplitude come from the same hash, so
 * the border belongs to the document it frames.
 */
export function drawBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  height: number,
  r: Rosette,
  ink: RosetteInk,
  vertical = false,
): void {
  const lines = Math.max(3, Math.round(r.lines / 3));
  const freq = (r.petals * Math.PI * 2) / Math.max(length, 1);

  ctx.save();
  ctx.strokeStyle = ink.stroke;
  ctx.lineWidth = ink.width ?? 0.5;
  for (let n = 0; n < lines; n++) {
    const shift = (n / lines) * Math.PI * 2;
    const amp = (height / 2) * (0.45 + 0.55 * Math.cos(shift));
    ctx.beginPath();
    for (let i = 0; i <= length; i += 2) {
      const w =
        Math.sin(i * freq + shift + r.phase) * amp +
        Math.sin(i * freq * 2.7 + shift * 1.6) * amp * 0.32;
      const px = vertical ? x + w : x + i;
      const py = vertical ? y + i : y + w;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}
