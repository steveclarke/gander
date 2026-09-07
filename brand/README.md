# Brand kit

`brand-guide.html` shows the logo variants, palette, typography, and asset inventory.

The mascot is a curious goose with a swept feather tuft, raised eyebrow, and
smiling orange bill. The approved design has no magnifying glass or accessories.

## Sources

| Path | Contents |
|---|---|
| `svg/mark-color.svg` | The original hand-drawn mascot, with explicit face and bill fills. |
| `svg/mark-black.svg`, `svg/mark-white.svg` | Single-ink variants. Luminance masks cut out the face, bill, and highlights. |
| `svg/logo-*.svg` | Horizontal and stacked lockups in color, black, and white. |
| `svg/app-icon.svg` | Rounded cream tile for the packaged desktop app. |
| `svg/app-icon-square.svg` | Square cream tile for favicons and social avatars. |
| `svg/app-icon-dev.svg` | Inset amber tile distinguishing development from the packaged app. |
| `fonts/` | Bricolage Grotesque variable font and source information. |

The color mascot retains its cream face on any background. The black and white
variants have a transparent face and use one ink color. Do not make a monochrome
variant by replacing every fill: that would erase the expression.

The wordmark retains the existing Bricolage Grotesque 700 lettering, already
converted to paths. All SVG masters work without installed fonts. Lockups and
icons center the mascot on its visible artwork, rather than its square viewBox.
The icon artwork occupies 76% of the tile height.

## Regenerate exports

Install Inkscape and ImageMagick, then run from the repository root:

```sh
python3 brand/export.py
```

The script reads the SVG masters and regenerates all PNGs, the multi-size ICO,
social images, both Electron icons, and the nine embedded brand-guide previews.
Edit the appropriate SVG masters before running it. The guide's palette and
prose are maintained directly in `brand-guide.html`.

## Colors

- Navy `#1B3A5B`: outline, body, eye, and color wordmark.
- Cream `#FFF8E9`: face, breast, eye highlight, and icon background.
- Orange `#F5A340`: bill.
- Sand `#E6DBC5`: breast shading.
- Slate `#47617C`: wing highlight.
- Amber `#E9B65B`: development icon background only.

The existing navy UI ramp remains unchanged: OKLCH hue 251.78, with navy pinned
at step 900. The guide contains the Tailwind `@theme` block.
