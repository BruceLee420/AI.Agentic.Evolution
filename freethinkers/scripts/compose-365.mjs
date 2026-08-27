#!/usr/bin/env node
/**
 * FREETHINKERS 365 — composes the year's daily pieces into the single annual
 * artwork sold on New Year's Day.
 *
 *   node compose-365.mjs <dailyDir> [out.png] [--tile 512] [--cols 20]
 *
 * Files sort lexicographically, so FT-2026-001…365 lay out in day order.
 * 20 cols × 512px = 10240px master. Rerun monthly with --tile 54 for a 1080p
 * work-in-progress image — that progress shot is good marketing on its own.
 */
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.indexOf(f) > -1 ? Number(argv[argv.indexOf(f) + 1]) : d);
const TILE = opt('--tile', 512);
const COLS = opt('--cols', 20);

const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) i++;      // skip the flag's value too
  else positional.push(argv[i]);
}
const [dir, out = 'FREETHINKERS-365.png'] = positional;
if (!dir) { console.error('usage: node compose-365.mjs <dailyDir> [out.png]'); process.exit(1); }

const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort();
const rows = Math.ceil(files.length / COLS);
console.log(`${files.length} tiles → ${COLS}×${rows} @ ${TILE}px = ${COLS * TILE}×${rows * TILE}px`);

const composites = await Promise.all(
  files.map(async (f, i) => ({
    input: await sharp(join(dir, f)).resize(TILE, TILE, { fit: 'cover' }).toBuffer(),
    left: (i % COLS) * TILE,
    top: Math.floor(i / COLS) * TILE,
  }))
);

await sharp({ create: { width: COLS * TILE, height: rows * TILE, channels: 3, background: { r: 13, g: 13, b: 15 } } })
  .composite(composites).png().toFile(out);

console.log(`✔ ${out} — run through prepare-art.mjs before it goes anywhere public.`);
