#!/usr/bin/env node
/**
 * SCORE — ranks pieces by how hard they hit in a grid of thumbnails.
 *
 * Be clear about what this is. It measures *visual impact*: colour range,
 * contrast, detail, sharpness, and how much energy sits on the rule-of-thirds
 * lines. Those are the things that make a thumbnail stop a scroll.
 *
 * It does NOT know which of your pieces are your best. It cannot read meaning,
 * story, or why one image matters more than another. Treat it as a first pass
 * that saves you sorting 180 files by hand — then override it. Anything you put
 * in the `order` column always wins and is never overwritten by this script.
 *
 *   node score.mjs                       # scores everything unscored
 *   node score.mjs --rescore             # recompute all scores
 *   node score.mjs --apply-order         # also seed `order` from the ranking
 *   node score.mjs --top 20              # print the leaderboard
 *
 * Reads the same catalog.csv as ingest.mjs and writes the `score` column.
 */
import sharp from 'sharp';
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);

const CATALOG = opt('--catalog', './catalog.csv');
const PREVIEWS = opt('--previews', './out/previews');
const TOP = Number(opt('--top', 15));
const RESCORE = flag('--rescore');
const APPLY_ORDER = flag('--apply-order');

/* ---------------- csv ---------------- */
function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false; else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v !== ''));
}
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = parseCSV(await readFile(CATALOG, 'utf8'));
const header = rows.shift().map((h) => h.trim());
const records = rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));

/* ---------------- metrics ---------------- */

/**
 * Hasler & Süsstrunk colourfulness — the standard measure of how much colour
 * range an image actually uses. Grey images score near zero regardless of
 * how many pixels they have.
 */
function colourfulness(data, ch) {
  let rgSum = 0, rgSq = 0, ybSum = 0, ybSq = 0, n = 0;
  for (let i = 0; i + ch - 1 < data.length; i += ch) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    rgSum += rg; rgSq += rg * rg;
    ybSum += yb; ybSq += yb * yb;
    n++;
  }
  if (!n) return 0;
  const rgMean = rgSum / n, ybMean = ybSum / n;
  const rgStd = Math.sqrt(Math.max(0, rgSq / n - rgMean ** 2));
  const ybStd = Math.sqrt(Math.max(0, ybSq / n - ybMean ** 2));
  return Math.sqrt(rgStd ** 2 + ybStd ** 2) + 0.3 * Math.sqrt(rgMean ** 2 + ybMean ** 2);
}

/** Laplacian variance — the classic focus/detail measure. */
async function sharpness(buf) {
  const lap = await sharp(buf).greyscale()
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw().toBuffer();
  let sum = 0, sq = 0;
  for (const v of lap) { sum += v; sq += v * v; }
  const mean = sum / lap.length;
  return Math.sqrt(Math.max(0, sq / lap.length - mean ** 2));
}

/**
 * Energy on the rule-of-thirds lines vs. the frame overall. High values mean
 * the composition puts its detail where the eye expects it rather than
 * smearing it evenly.
 */
async function thirdsEnergy(buf) {
  const S = 90;
  const g = await sharp(buf).greyscale().resize(S, S, { fit: 'fill' }).raw().toBuffer();
  const at = (x, y) => g[y * S + x];
  let band = 0, bandN = 0, all = 0;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      // local gradient magnitude
      const e = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1));
      all += e;
      const nearThird = [S / 3, (2 * S) / 3].some((t) => Math.abs(x - t) < S * 0.08 || Math.abs(y - t) < S * 0.08);
      if (nearThird) { band += e; bandN++; }
    }
  }
  const allAvg = all / ((S - 2) * (S - 2));
  const bandAvg = bandN ? band / bandN : 0;
  return allAvg ? bandAvg / allAvg : 1;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

async function scoreImage(file) {
  const small = await sharp(file).resize(420, 420, { fit: 'inside' }).removeAlpha().toBuffer();
  const { data, info } = await sharp(small).raw().toBuffer({ resolveWithObject: true });
  const stats = await sharp(small).stats();

  const colour = colourfulness(data, info.channels);            // ~0-120 typical
  const contrast = stats.channels.reduce((a, c) => a + c.stdev, 0) / stats.channels.length; // 0-128
  const detail = stats.entropy ?? 0;                            // 0-8
  const focus = await sharpness(small);                         // 0-80 typical
  const thirds = await thirdsEnergy(small);                     // ~0.7-1.6

  // Weights chosen so no single metric can dominate: a blurry neon smear and a
  // razor-sharp grey study both land mid-pack, which is the honest answer.
  const score =
    28 * clamp01(colour / 90) +
    24 * clamp01(contrast / 70) +
    20 * clamp01(detail / 7.5) +
    18 * clamp01(focus / 45) +
    10 * clamp01((thirds - 0.75) / 0.6);

  return {
    score: Math.round(score * 10) / 10,
    parts: {
      colour: Math.round(colour), contrast: Math.round(contrast),
      detail: detail.toFixed(2), focus: Math.round(focus), thirds: thirds.toFixed(2),
    },
  };
}

/* ---------------- run ---------------- */

let done = 0, skipped = 0;
for (const rec of records) {
  if (rec.score && !RESCORE) { skipped++; continue; }
  const file = join(PREVIEWS, `${rec.id}.png`);
  if (!(await access(file).then(() => true).catch(() => false))) { skipped++; continue; }
  const { score, parts } = await scoreImage(file);
  rec.score = String(score);
  done++;
  console.log(`${String(score).padStart(5)}  ${rec.id}  ${rec.title}`
    + `   [colour ${parts.colour} · contrast ${parts.contrast} · detail ${parts.detail} · focus ${parts.focus} · thirds ${parts.thirds}]`);
}

// Seed the manual order from the ranking — only for pieces you haven't
// already placed yourself.
if (APPLY_ORDER) {
  const ranked = [...records].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  let n = 0, placed = 0;
  for (const r of ranked) {
    n++;
    if (r.order === '') { r.order = String(n * 10); placed++; }
  }
  console.log(`\nSeeded order for ${placed} unplaced pieces (existing order values untouched).`);
}

const COLUMNS = header.includes('score') ? header : [...header, 'score'];
await writeFile(
  CATALOG,
  [COLUMNS.join(','), ...records.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
);

console.log(`\n${done} scored · ${skipped} skipped`);
const board = [...records].filter((r) => r.score)
  .sort((a, b) => Number(b.score) - Number(a.score)).slice(0, TOP);
if (board.length) {
  console.log(`\nTop ${board.length} by visual impact:`);
  board.forEach((r, i) => console.log(` ${String(i + 1).padStart(3)}. ${String(r.score).padStart(5)}  ${r.title}`));
  console.log(`\nThis is a starting point, not a judgement. Reorder freely —`);
  console.log(`the curator page (npm run curate) writes the \`order\` column, which always wins.`);
}
