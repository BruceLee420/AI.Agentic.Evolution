#!/usr/bin/env node
/**
 * Art pipeline: masters in → protected assets out.
 *
 *   node prepare-art.mjs <inDir> <outDir> [--stego] [--brand FREETHINKERS.AI]
 *   node prepare-art.mjs --buyer <orderHash> <master.png> <out.png>  # per-buyer master
 *   node prepare-art.mjs --decode <file.png>                         # read stego payload
 *
 * Per input image (name it {PIECE-ID}.png, e.g. FT-2026-001.png):
 *   out/previews/{id}.png   1080p, visible corner mark + diagonal watermark
 *                           [+ invisible LSB watermark with --stego]
 *   out/masters/{id}.png    pixels untouched, copyright metadata stamped
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const BRAND = opt('--brand', 'FREETHINKERS.AI');
const MAGIC = 'FT1:';

/* ---------- invisible LSB watermark (blue channel, tiled) ----------
 * Tiled so edge-cropping doesn't destroy it. Survives PNG re-save; does NOT
 * survive heavy JPEG recompression — one forensic signal among several.
 * (Harden with the Python `invisible-watermark` DWT-DCT package if leaks
 * become a real problem.) */
function embedLSB(raw, channels, payload) {
  const msg = MAGIC + payload + '\0';
  const bits = [...msg].flatMap((c) => [...Array(8)].map((_, i) => (c.charCodeAt(0) >> (7 - i)) & 1));
  for (let px = 0, bit = 0; px * channels + 2 < raw.length; px++, bit++) {
    const i = px * channels + 2;
    raw[i] = (raw[i] & 0xfe) | bits[bit % bits.length];
  }
  return raw;
}

function decodeLSB(raw, channels) {
  let bits = '';
  for (let px = 0; px * channels + 2 < raw.length && bits.length < 8 * 512; px++)
    bits += raw[px * channels + 2] & 1;
  let out = '';
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const ch = String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
    if (ch === '\0') break;
    out += ch;
  }
  return out.startsWith(MAGIC) ? out.slice(MAGIC.length) : null;
}

async function stampLSB(input, payload) {
  const { data, info } = await sharp(input).raw().toBuffer({ resolveWithObject: true });
  return sharp(embedLSB(data, info.channels, payload), {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
}

const watermarkSVG = (w, h, id) => Buffer.from(`
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <style>text{font-family:sans-serif;fill:#ffffff}</style>
    <text x="${w / 2}" y="${h / 2}" font-size="${Math.round(w / 14)}" opacity="0.10"
          text-anchor="middle" transform="rotate(-30 ${w / 2} ${h / 2})">${BRAND}</text>
    <text x="${w - 14}" y="${h - 14}" font-size="${Math.max(14, Math.round(w / 60))}"
          opacity="0.75" text-anchor="end">© ${BRAND} · ${id}</text>
  </svg>`);

const meta = (id, extra = '') => ({
  exif: { IFD0: { Copyright: `© ${BRAND} — all rights reserved`, ImageDescription: `${id}${extra}` } },
});

/* ---------- modes ---------- */

if (flag('--decode')) {
  const file = argv[argv.indexOf('--decode') + 1];
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const payload = decodeLSB(data, info.channels);
  console.log(payload ? `✔ payload: ${payload}` : '✘ no Freethinkers watermark found');
  process.exit(payload ? 0 : 1);
}

if (flag('--buyer')) {
  const [orderHash, input, output] = argv.slice(argv.indexOf('--buyer') + 1);
  const id = basename(input, extname(input));
  await (await stampLSB(input, `${id}|${orderHash}`))
    .withMetadata(meta(id, ` | order:${orderHash}`)).png().toFile(output);
  console.log(`✔ buyer-fingerprinted master → ${output}`);
  process.exit(0);
}

const [inDir, outDir] = argv.filter((a) => !a.startsWith('--'));
if (!inDir || !outDir) {
  console.error('usage: node prepare-art.mjs <inDir> <outDir> [--stego]');
  process.exit(1);
}
await mkdir(join(outDir, 'previews'), { recursive: true });
await mkdir(join(outDir, 'masters'), { recursive: true });

const files = (await readdir(inDir)).filter((f) => /\.(png|jpe?g|tiff?|webp)$/i.test(f));
console.log(`${files.length} images → ${outDir}\n`);

for (const f of files) {
  const id = basename(f, extname(f));
  const src = join(inDir, f);

  const preview = await sharp(src)
    .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true }).toBuffer();
  const { width, height } = await sharp(preview).metadata();
  let pipe = sharp(preview).composite([{ input: watermarkSVG(width, height, id) }]);
  if (flag('--stego')) pipe = await stampLSB(await pipe.png().toBuffer(), id);
  await pipe.withMetadata(meta(id)).png().toFile(join(outDir, 'previews', `${id}.png`));

  await sharp(src).withMetadata(meta(id)).png().toFile(join(outDir, 'masters', `${id}.png`));
  console.log(`✔ ${id}`);
}

console.log(`
Upload to R2:
  for f in ${outDir}/previews/*; do npx wrangler r2 object put "ft-public/previews/$(basename $f)" --file "$f"; done
  for f in ${outDir}/masters/*;  do npx wrangler r2 object put "ft-masters/masters/$(basename $f)" --file "$f"; done
`);
