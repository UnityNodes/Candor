# Fonts

Latin subsets of the two families the customer page uses, served from the same
origin as the page itself. The page tells the customer that nothing about them
leaves the device; a stylesheet link to a font CDN would report the visit to a
third party before the first glyph was drawn, so the fonts ship with the page.

| File | Family | Weights |
|---|---|---|
| `instrument-serif-400.woff2` | Instrument Serif | 400 |
| `ibm-plex-sans.woff2` | IBM Plex Sans (variable) | 400–600 |
| `ibm-plex-mono-400.woff2` | IBM Plex Mono | 400 |
| `ibm-plex-mono-500.woff2` | IBM Plex Mono | 500 |

IBM Plex Sans is a variable font: one file covers every weight the page asks
for, so it is declared once over a range rather than three times over the same
bytes.

Both families are licensed under the **SIL Open Font License 1.1**, which
permits redistribution and web embedding:

- Instrument Serif — <https://github.com/Instrument/instrument-serif>
- IBM Plex — <https://github.com/IBM/plex>

Declared in [`ui/fonts.css`](../../ui/fonts.css); Vite copies this directory to
the site root, so they are served at `/fonts/…`.
