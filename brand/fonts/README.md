# Fonts

Latin subsets of the two families the customer page uses, served from the same
origin as the page itself. The page tells the customer that nothing about them
leaves the device; a stylesheet link to a font CDN would report the visit to a
third party before the first glyph was drawn, so the fonts ship with the page.

| File | Family | Axes |
|---|---|---|
| `archivo-var.woff2` | Archivo | weight 400–700, width 62–125% |
| `azeret-mono-var.woff2` | Azeret Mono | weight 300–600 |

Both are variable, so one file each covers every width and weight the page
asks for — 116 KB for the whole typographic system.

**Why these.** The wordmark SVGs only ever named Inter as a fallback, so
typography was never a committed part of the brand the way the gold and the
aperture are. Archivo at its expanded widths carries the institutional,
stamped-form authority the page needs at display size; Azeret Mono is doing
real work rather than costume — hashes and tabular figures have to be
monospaced. The pairing sits on a contrast axis (wide grotesque against
geometric mono) rather than being two of the same thing.

Both are licensed under the **SIL Open Font License 1.1**, which permits
redistribution and web embedding:

- Archivo (Omnibus-Type) — <https://github.com/Omnibus-Type/Archivo>
- Azeret Mono (Displaay) — <https://github.com/displaay/Azeret>

Declared in [`ui/fonts.css`](../../ui/fonts.css); Vite copies this directory to
the site root, so they are served at `/fonts/…`.
