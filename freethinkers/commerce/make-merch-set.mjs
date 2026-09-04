#!/usr/bin/env node
/**
 * MATCHED SET — one artwork, two garments that read as a pair.
 *
 *   node make-merch-set.mjs <image> [--name NAME] [--out ./set] [--qr PIECE-ID]
 *
 * Why this isn't just "stretch the same file onto both":
 *
 * A portrait stretched across a cut-and-sew garment lands the face on a
 * shoulder seam, and on shorts it lands across the crotch. It reads as a
 * mistake, not a design. What high-end sets actually do is split the roles:
 *
 *   SHIRT  carries the hero — the figure, upright and uncropped, floating in
 *          an atmosphere extended from the artwork's own colours so the print
 *          reaches every edge without distorting the subject.
 *   SHORTS carry the DNA — a seamless mirror-tile built from the artwork's
 *          glitch and smoke, same palette, no face. Abstract at arm's length,
 *          obviously the same piece up close.
 *
 * Same colours, same source, unmistakably a set — and neither garment has a
 * face sliced by a seam.
 *
 * Outputs 300-DPI PNGs for both the all-over-print (cut & sew) route and the
 * cheaper DTG placement route, and prints the pixel dimensions of each so you
 * can check them against the template size the provider shows at upload.
 */

import { mkdir, access } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import sharp from 'sharp';

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const FLAGS = new Set(['--name', '--out', '--qr', '--motif-scale']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !FLAGS.has(argv[i - 1]));

const SRC = positional[0];
if (!SRC) {
  console.error(`usage: node make-merch-set.mjs <image> [--name NAME] [--out ./set] [--qr PIECE-ID]

  <image>          the artwork (PNG/JPG). Use the highest-resolution master you have.
  --name NAME      base name for output files (default: the image's filename)
  --out DIR        output folder (default: ./set)
  --qr PIECE-ID    also stamp a small scan QR on the DTG shorts leg
  --motif-scale N  how many pattern repeats across the shorts (default 3)`);
  process.exit(1);
}

const OUT = opt('--out', './set');
const NAME = opt('--name', basename(SRC, extname(SRC)).replace(/[^\w-]/g, '-'));
const QR_PIECE = opt('--qr', '');
const MOTIF_REPEATS = Math.max(1, Number(opt('--motif-scale', 3)));

if (!(await access(SRC).then(() => true).catch(() => false))) {
  console.error(`Can't find the image: ${SRC}`);
  console.error('Pass the full path, e.g. node make-merch-set.mjs "G:\\My Drive\\Art.Folder\\1-Drop\\PIECE.png"');
  process.exit(1);
}
await mkdir(OUT, { recursive: true });

/* --------------------------------------------------------------------------
 * Canvas specs.
 *
 * Cut & sew print files are generous on purpose: the provider trims to their
 * own pattern, so extra bleed is safe and a file that's too small is not.
 * These are 300 DPI at the garment's real-world footprint with margin.
 * ------------------------------------------------------------------------ */
const SPECS = {
  teeAop:    { w: 5400, h: 6600, label: 'AOP cut & sew tee (full coverage)' },
  shortsAop: { w: 5400, h: 4800, label: 'AOP cut & sew cotton shorts (full coverage)' },
  teeDtg:    { w: 3600, h: 4200, label: 'DTG tee front (standard cotton tee)' },
  shortsDtg: { w: 1800, h: 1800, label: 'DTG shorts leg placement' },
};

const src = sharp(SRC);
const meta = await src.metadata();
if (!meta.width || !meta.height) { console.error('Could not read image dimensions.'); process.exit(1); }
console.log(`source: ${meta.width}×${meta.height}px  (${SRC})\n`);

/** Average colour of the image edges — the atmosphere we extend outward. */
async function edgeColor() {
  const strip = await sharp(SRC)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.max(1, Math.round(meta.height * 0.06)) })
    .resize(1, 1, { fit: 'fill' })
    .raw()
    .toBuffer();
  return { r: strip[0], g: strip[1], b: strip[2] };
}

/**
 * Hero layout: the artwork, undistorted, over an atmosphere built from a
 * heavily blurred blow-up of itself. The blur carries the exact palette, so
 * the print bleeds to every edge and still looks composed rather than pasted.
 */
async function heroCanvas({ w, h }, { coverage = 0.95, top = 0.44 } = {}) {
  // Centre, not 'attention': a focal-point crop on a portrait yanks the blur
  // off-axis and leaves a dark band where the subject was.
  const bg = await sharp(SRC)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .blur(Math.max(12, Math.round(Math.min(w, h) / 55)))
    .modulate({ saturation: 0.72, brightness: 1.02 })
    .toBuffer();

  // Scale the subject to a share of the canvas, never past its own resolution.
  const targetW = Math.round(w * coverage);
  const scale = Math.min(targetW / meta.width, (h * coverage) / meta.height);
  const artW = Math.max(1, Math.round(meta.width * scale));
  const artH = Math.max(1, Math.round(meta.height * scale));
  const art = await sharp(SRC).resize(artW, artH, { fit: 'inside' }).toBuffer();

  const left = Math.round((w - artW) / 2);
  const topPx = Math.max(0, Math.min(h - artH, Math.round(h * top - artH / 2)));

  return sharp(bg).composite([{ input: art, left, top: topPx }]);
}

/**
 * Seamless mirror-tile from the artwork's most textured region.
 * Mirroring a crop across both axes guarantees the edges meet, so the pattern
 * repeats without visible seams — the standard way to build textile print from
 * a photograph. On this artwork it pulls the smoke and glitch, not the face.
 */
async function motifCanvas({ w, h }) {
  // Take a wide band from the upper third: on these pieces that's where the
  // smoke and datamosh live, and it's reliably away from the face.
  const cropH = Math.round(meta.height * 0.3);
  const cropW = Math.round(meta.width * 0.5);
  const crop = await sharp(SRC)
    .extract({
      left: Math.round(meta.width * 0.08),
      top: Math.round(meta.height * 0.06),
      width: Math.min(cropW, meta.width - Math.round(meta.width * 0.08)),
      height: Math.min(cropH, meta.height - Math.round(meta.height * 0.06)),
    })
    .toBuffer();

  const cellW = Math.max(2, Math.round(w / MOTIF_REPEATS / 2));
  const cellH = Math.max(2, Math.round(h / MOTIF_REPEATS / 2));
  const cell = await sharp(crop).resize(cellW, cellH, { fit: 'cover' }).toBuffer();

  // 2×2 mirrored block → tiles seamlessly in both directions.
  const block = await sharp({
    create: { width: cellW * 2, height: cellH * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([
      { input: cell, left: 0, top: 0 },
      { input: await sharp(cell).flop().toBuffer(), left: cellW, top: 0 },
      { input: await sharp(cell).flip().toBuffer(), left: 0, top: cellH },
      { input: await sharp(cell).flip().flop().toBuffer(), left: cellW, top: cellH },
    ])
    .png()
    .toBuffer();

  const tiles = [];
  for (let y = 0; y < h; y += cellH * 2)
    for (let x = 0; x < w; x += cellW * 2)
      tiles.push({ input: block, left: x, top: y });

  const { r, g, b } = await edgeColor();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } })
    .composite(tiles)
    // Pull it back a touch so the shorts support the shirt instead of shouting.
    .modulate({ saturation: 0.9, brightness: 0.96 });
}

/** Transparent-background placement file for DTG. */
async function placementCanvas({ w, h }, { coverage = 0.94 } = {}) {
  const scale = Math.min((w * coverage) / meta.width, (h * coverage) / meta.height);
  const artW = Math.max(1, Math.round(meta.width * scale));
  const artH = Math.max(1, Math.round(meta.height * scale));
  const art = await sharp(SRC).resize(artW, artH, { fit: 'inside' }).toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: art, left: Math.round((w - artW) / 2), top: Math.round((h - artH) / 2) }]);
}

/* ---------- write everything ---------- */

const written = [];
async function write(pipeline, file, spec) {
  const path = join(OUT, file);
  await pipeline.png({ compressionLevel: 9 }).withMetadata({ density: 300 }).toFile(path);
  const m = await sharp(path).metadata();
  written.push({ file, w: m.width, h: m.height, label: spec.label });
}

await write(await heroCanvas(SPECS.teeAop), `${NAME}-tee-aop.png`, SPECS.teeAop);
await write(await motifCanvas(SPECS.shortsAop), `${NAME}-shorts-aop.png`, SPECS.shortsAop);
await write(await placementCanvas(SPECS.teeDtg), `${NAME}-tee-dtg.png`, SPECS.teeDtg);

// DTG shorts: the motif reads better small than a shrunken portrait would.
let shortsDtg = await motifCanvas(SPECS.shortsDtg);
if (QR_PIECE) {
  const { default: QRCode } = await import('qrcode');
  const origin = process.env.SITE_ORIGIN ?? 'https://freethinkers.ai';
  const qrSize = Math.round(SPECS.shortsDtg.w * 0.26);
  const qr = await QRCode.toBuffer(`${origin}/a/${QR_PIECE}?via=press`, {
    width: qrSize, margin: 1, errorCorrectionLevel: 'H',
    color: { dark: '#0d0d0f', light: '#f6f4ef' },
  });
  shortsDtg = sharp(await shortsDtg.png().toBuffer()).composite([{
    input: qr,
    left: SPECS.shortsDtg.w - qrSize - Math.round(SPECS.shortsDtg.w * 0.06),
    top: SPECS.shortsDtg.h - qrSize - Math.round(SPECS.shortsDtg.h * 0.06),
  }]);
}
await write(shortsDtg, `${NAME}-shorts-dtg.png`, SPECS.shortsDtg);

/* ---------- report ---------- */

console.log(`Matched set written to ${OUT}/\n`);
for (const w of written) {
  const dpiAt = (inches) => Math.floor(Math.min(w.w / inches, w.h / inches));
  console.log(`  ${w.file}`);
  console.log(`    ${w.w}×${w.h}px @300dpi · ${w.label}`);
  if (w.w < 3000 && w.file.includes('aop'))
    console.log('    ⚠ small for cut & sew — use a higher-resolution source if you have one');
  void dpiAt;
}

const shortSide = Math.min(meta.width, meta.height);
console.log(`
Source resolution check: ${meta.width}×${meta.height}`);
if (shortSide < 2400) {
  console.log(`  ⚠ ${shortSide}px on the short side is thin for cut & sew. It will print,
    but upscale the master first (scripts/upscale.mjs) for a crisp result.`);
} else {
  console.log('  ✔ enough resolution for cut & sew at full coverage.');
}

console.log(`
Next:
  1. Open the two *-aop.png files and look at them. The tee should read as the
     figure; the shorts should read as fabric, not as a cropped face.
  2. Printify → Catalog → search "All Over Print Unisex Cotton Shorts" and
     "AOP Cut & Sew Tee" → upload the matching file to each.
  3. Their editor shows the exact template size — if it asks for more pixels
     than these files have, rerun with a higher-resolution source.`);
