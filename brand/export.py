#!/usr/bin/env python3
"""Export the brand masters with Inkscape and ImageMagick (both must be installed)."""

from pathlib import Path
import re
import subprocess

BRAND = Path(__file__).resolve().parent
ROOT = BRAND.parent


def export(source, target, width):
    subprocess.run([
        'inkscape', str(source), f'--export-filename={target}',
        f'--export-width={width}',
    ], check=True)


for variant in ('color', 'black', 'white'):
    for size in (64, 128, 256, 512, 1024):
        export(BRAND / f'svg/mark-{variant}.svg',
               BRAND / f'png/mark-{variant}-{size}.png', size)
    for layout, sizes in (('horizontal', (400, 600, 800)), ('stacked', (300, 500))):
        for size in sizes:
            name = f'logo-{layout}-{variant}'
            export(BRAND / f'svg/{name}.svg', BRAND / f'png/{name}-{size}.png', size)

square = BRAND / 'svg/app-icon-square.svg'
for name, size in (('favicon-16x16', 16), ('favicon-32x32', 32),
                   ('apple-touch-icon', 180), ('android-chrome-192x192', 192),
                   ('android-chrome-512x512', 512)):
    export(square, BRAND / f'favicon/{name}.png', size)

subprocess.run([
    'magick', str(BRAND / 'favicon/favicon-16x16.png'),
    str(BRAND / 'favicon/favicon-32x32.png'), str(BRAND / 'favicon/favicon.ico'),
], check=True)

for name, size in (('discord-icon', 512), ('github-avatar', 500), ('npm-icon', 256)):
    export(square, BRAND / f'social/{name}-{size}.png', size)

export(BRAND / 'svg/app-icon.svg', ROOT / 'packages/app/resources/icon.png', 1024)
export(BRAND / 'svg/app-icon-dev.svg', ROOT / 'packages/app/resources/icon-dev.png', 1024)

# Composite the rasterized lockup so ImageMagick does not invoke a second SVG renderer.
subprocess.run([
    'magick', '-size', '1280x640', 'xc:#FFF8E9',
    '(', str(BRAND / 'png/logo-horizontal-color-800.png'), '-trim', '+repage', ')',
    '-gravity', 'center', '-composite', str(BRAND / 'social/og-image-1280x640.png'),
], check=True)

# Keep the guide's nine embedded previews in the same order as its labelled cells.
guide = BRAND / 'brand-guide.html'
masters = [BRAND / f'svg/{name}-{variant}.svg'
           for variant in ('color', 'black', 'white')
           for name in ('mark', 'logo-horizontal', 'logo-stacked')]
source = guide.read_text()
if len(re.findall(r'<svg\b.*?</svg>', source, flags=re.S)) != len(masters):
    raise ValueError('The brand guide must contain one preview for each of the nine logo masters')
previews = iter(masters)
source = re.sub(r'<svg\b.*?</svg>', lambda _: next(previews).read_text().strip(), source, flags=re.S)
guide.write_text(source)
print('Exported PNGs, favicons, social images, app icons, and brand guide previews.')
