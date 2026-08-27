#!/usr/bin/env node
/**
 * UPSCALE — masters → print-ready files at real print dimensions.
 *
 * What this replaces and what it doesn't:
 *
 * This does high-quality Lanczos resampling with a light unsharp pass — the
 * same class of operation as Photoshop's "Preserve Details" resample. For most
 * prints up to about 24x36 it is genuinely fine, and it removes the manual
 * Photoshop step from your loop entirely.
 *
 * It is NOT a machine-learning upscaler. Topaz Gigapixel and Real-ESRGAN
 * hallucinate plausible new detail; this only redistributes detail that is
 * already there. If you are printing very large from a small source, or a piece
 * matters enough to fuss over, run that one through an ML upscaler by hand.
 * For a 180-piece catalogue, automate with this and hand-treat the exceptions.
 *
 *   node upscale.mjs ./out/masters ./out/print --size 18x24
 *   node upscale.mjs ./out/masters ./out/print --size 24x36 --dpi 300
 *   node upscale.mjs ./out/masters ./out/print --max-scale 3
 *
 * Reports the true source DPI at the target size, so you know which pieces are
 * actually being stretched too far.
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const positional = [];
const VALUE_FLAGS = new Set(['--size', '--dpi', '--max-scale', '--sharpen']);
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.has(argv[i])) i++;
  else if (!argv[i].startsWith('--')) positional.push(argv[i]);
}
const [inDir = './out/masters', outDir = './out/print'] = positional;

const SIZE = opt('--size', '18x24');
const DPI = Number(opt('--dpi', 300));
const MAX_SCALE = Number(opt('--max-scale', 4));
const SHARPEN = Number(opt('--sharpen', 1));

const [inW, inH] = SIZE.split('x').map(Number);
if (!inW || !inH) { console.error('--size must look like 18x24 (inches)'); process.exit(1); }
const targetW = Math.round(inW * DPI);
const targetH = Math.round(inH * DPI);

await mkdir(outDir, { recursive: true });
const files = (await readdir(inDir)).filter((f) => /\.(png|jpe?g|tiff?|webp)$/i.test(f));

console.log(`Target: ${inW}"x${inH}" @ ${DPI}dpi = ${targetW}x${targetH}px`);
console.log(`${files.length} masters\n`);

const warnings = [];
for (const f of files) {
  const id = basename(f, extname(f));
  const src = join(inDir, f);
  const meta = await sharp(src).metadata();

  // Scale needed to cover the target, and the DPI that actually delivers.
  const scale = Math.max(targetW / meta.width, targetH / meta.height);
  const trueDpi = Math.round(Math.min(meta.width / inW, meta.height / inH));

  if (scale > MAX_SCALE) {
    warnings.push(`${id}: needs ${scale.toFixed(1)}x (source ${meta.width}x${meta.height}, only ${trueDpi}dpi at this size)`);
  }

  await sharp(src)
    .resize(targetW, targetH, { fit: 'cover', kernel: sharp.kernel.lanczos3, withoutEnlargement: false })
    // Light unsharp restores the micro-contrast resampling softens. Heavy
    // sharpening on an upscale just looks crunchy in print.
    .sharpen({ sigma: SHARPEN })
    .withMetadata({ density: DPI })
    .png({ compressionLevel: 6 })
    .toFile(join(outDir, `${id}.print.png`));

  console.log(`✔ ${id}  ${meta.width}x${meta.height} → ${targetW}x${targetH}  (${scale.toFixed(2)}x, source ${trueDpi}dpi)`);
}

if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} piece(s) stretched past ${MAX_SCALE}x — these are the ones worth`);
  console.log(`  running through an ML upscaler by hand, or printing smaller:\n`);
  warnings.forEach((w) => console.log(`  ${w}`));
}
console.log(`\nDone → ${outDir}`);
console.log(`Rule of thumb: 300dpi is ideal, 150dpi is acceptable for large pieces viewed`);
console.log(`from a distance, below 100dpi will look soft no matter what you do to it.`);
