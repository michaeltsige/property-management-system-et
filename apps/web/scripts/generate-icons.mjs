/**
 * Regenerate the PWA/favicon PNGs from the trimmed brand SVG.
 *
 * Why this exists: the previous icons were rendered from the untrimmed
 * 2048x2048 mark onto a white tile, so every icon showed a fat white border
 * and a tiny logo (review round 1, issue #13). These icons render the trimmed
 * mark full-bleed on a brand-teal tile - recognizable at 16px in a browser tab
 * and in dark-mode tab strips, matching the maskable icon that already used
 * this style.
 *
 * Usage: pnpm --filter web icons:generate
 *
 * Sources:
 *   public/brand/rentalo-mark-light.svg  (bright mark, made for dark surfaces)
 * Outputs (all referenced from manifest + layout metadata):
 *   public/icons/icon-192.png            rounded tile, any purpose
 *   public/icons/icon-512.png            rounded tile, any purpose
 *   public/icons/apple-touch-icon.png    full-bleed square (iOS applies its mask)
 *   public/icons/icon-maskable-512.png   full-bleed, mark inside the safe zone
 *   src/app/icon.png                     the favicon (copy of icon-192)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const MARK = path.join(web, 'public/brand/rentalo-mark-light.svg');

/** The same dark teal the maskable icon has always used. */
const TILE = '#0D4F48';

async function markBuffer(sizePx) {
  // The trimmed SVG has width/height attributes of 2048; density scaling gives
  // librsvg room to rasterize crisply before the resize.
  return sharp(MARK, { density: 300 })
    .resize(sizePx, sizePx)
    .png()
    .toBuffer();
}

async function tileBuffer(sizePx, radiusPx) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}"><rect width="${sizePx}" height="${sizePx}" rx="${radiusPx}" fill="${TILE}"/></svg>`;
  return Buffer.from(svg);
}

async function generateIcon({ size, radius, markRatio, file }) {
  const markSize = Math.round(size * markRatio);
  const [mark, tile] = await Promise.all([markBuffer(markSize), tileBuffer(size, radius)]);
  const inset = Math.round((size - markSize) / 2);
  await sharp(tile)
    .composite([{ input: mark, top: inset, left: inset }])
    .png()
    .toFile(path.join(web, file));
  console.log(`OK ${file} (${size}x${size})`);
}

await generateIcon({ size: 192, radius: 42, markRatio: 0.74, file: 'public/icons/icon-192.png' });
await generateIcon({ size: 512, radius: 113, markRatio: 0.74, file: 'public/icons/icon-512.png' });
await generateIcon({ size: 180, radius: 0, markRatio: 0.74, file: 'public/icons/apple-touch-icon.png' });
// Maskable safe zone: a circle of radius 0.4xsize must contain the mark.
await generateIcon({ size: 512, radius: 0, markRatio: 0.6, file: 'public/icons/icon-maskable-512.png' });
// Next.js serves src/app/icon.png as the favicon.
await generateIcon({ size: 192, radius: 42, markRatio: 0.74, file: 'src/app/icon.png' });
