# Brand kit

`brand-guide.html` is the reference — open it first.

## What is authored here

| Path | Contents |
|---|---|
| `svg/` | The nine masters. Everything else is derived from these. |
| `png/` | Raster exports of the masters. |
| `favicon/` | Icon set plus `site.webmanifest`. |
| `social/` | OG image and platform avatars. |
| `fonts/` | Bricolage Grotesque variable font and its licence note. |

## How the masters were built

The mark came out of Recraft's Vector model in its "Geometric Logo" style. The
vectoriser flattened the bill tip to a blunt edge, so one curve in the outline
path was extended by hand to restore the point; the shape is otherwise as
generated.

The wordmark is Bricolage Grotesque 700 at font-size 92 with letter-spacing -2,
composed against a mark scaled to 140px tall for the horizontal lockup and 242px
tall for the stacked one, then converted to paths:

```
inkscape FILE --actions="select-all;object-to-path;export-filename:FILE;export-do"
inkscape FILE --actions="select-all;fit-canvas-to-selection;export-filename:FILE;export-do"
```

Inkscape writes its root tag as `<svg\n`, not `<svg `, and re-adds `width`/
`height` attributes matching the viewBox. Anything that inlines these files and
sizes them by attribute will get a full-bleed SVG instead — size them in CSS.

## Colour ramp

Steps 50–950 are OKLCH at hue 251.78, with the brand navy `#1B3A5B` pinned at
step 900 (L 0.342, C 0.069) and chroma scaled by a curve peaking at step 600.
The `@theme` block in the brand guide is the copy-paste form.

## Regenerating a colour variant

The masters are single-colour: every fill in a given file is the same hex, and
the white cheek is negative space. A variant is a search and replace.

```
sed 's/#1b3a5b/#0a2139/gi' svg/logo-horizontal-color.svg > /tmp/variant.svg
```
