#!/usr/bin/env node
/**
 * INGEST — drop art in a folder, get a signed, protected, catalogued piece.
 *
 * This is the one command you run whenever you finish a piece:
 *
 *   node ingest.mjs ~/art-drop --signature ./signature.png
 *
 * What it does per image, automatically:
 *   1. Assigns the next FT-YYYY-### id and day number.
 *   2. Reads the title from the filename ("JESUS GOT GAME.png" → JESUS GOT GAME).
 *   3. Reads the date from EXIF, falling back to the file's modified time.
 *   4. Signs the 1080p preview with your signature + date (bottom-right).
 *   5. Embeds the invisible fingerprint (piece id) in the pixels.
 *   6. Writes copyright metadata into both preview and master.
 *   7. Copies the untouched high-res master to out/masters/.
 *   8. Adds a row to catalog.csv and rebuilds site/src/data/pieces.json.
 *
 * Descriptions: open catalog.csv in Excel/Sheets, type them in the
 * `description` column, save, and rerun this command. Your edits are always
 * preserved — the catalog is the source of truth, the drop folder is just
 * the inbox. Rerunning is safe and skips work already done.
 *
 * Options:
 *   --signature <file>   PNG with transparent background (recommended)
 *   --artist "Name"      text signature if no PNG is supplied
 *   --year 2026          id/day namespace (default: current year)
 *   --out ./out          where previews + masters are written
 *   --catalog ./catalog.csv
 *   --start-day 1        day number for the first piece in an empty catalog
 *   --force              reprocess images even if already done
 */
import sharp from 'sharp';
import { readdir, mkdir, readFile, writeFile, stat, access } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFilename, dayOfYear } from './parse-filename.mjs';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);

// Positional args = anything that isn't a flag or a flag's value.
const VALUE_FLAGS = new Set(['--signature', '--artist', '--year', '--out', '--catalog', '--start-day']);
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (VALUE_FLAGS.has(argv[i])) i++;          // skip the flag and its value
  else if (!argv[i].startsWith('--')) positional.push(argv[i]);
}
const dropDir = positional[0];
const YEAR = Number(opt('--year', new Date().getFullYear()));
const OUT = opt('--out', './out');
const CATALOG = opt('--catalog', './catalog.csv');
const SIGNATURE = opt('--signature', '');
const ARTIST = opt('--artist', 'Adrian A. Grimaldo');
const START_DAY = Number(opt('--start-day', 1));
const FORCE = flag('--force');

// Signature keying. Defaults suit dark ink photographed on white paper.
const KEEP_BG = flag('--signature-keep-bg');       // already a clean transparent PNG
const PAPER_LEVEL = Number(opt('--paper-level', 210)); // luma at/above this = paper
const INK_FLOOR = Number(opt('--ink-floor', 90));      // luma at/below this = solid ink
const INK_HEX = opt('--signature-color', '#ffffff');
const TRIM_THRESHOLD = Number(opt('--trim-threshold', 15)); // paper-margin tolerance
// Signature width as a share of the image width. 0.22 reads clearly at gallery
// thumbnail size without competing with the artwork.
const SIG_WIDTH = Number(opt('--signature-width', 0.22));
const SIG_MARGIN = Number(opt('--signature-margin', 24));
const INK_RGB = [1, 3, 5].map((i) => parseInt(INK_HEX.slice(i, i + 2), 16) || 0);

if (!dropDir) {
  console.error('usage: node ingest.mjs <dropFolder> [--signature sig.png] [--artist "Name"]');
  process.exit(1);
}

/* ---------------- tiny CSV (no dependency, handles quoted commas) ---------------- */

/**
 * order  — your manual sequence. Blank means "use the auto score". Anything you
 *          set here always wins; nothing overwrites it. This is the column the
 *          curator page writes when you drag pieces around.
 * score  — auto visual-impact score from score.mjs (0-100). A starting point
 *          for ordering, never a verdict on the work.
 * clip   — optional video filename for the motion version of the piece.
 */
const COLUMNS = ['id', 'filename', 'title', 'date', 'day', 'description', 'tags',
  'ratio', 'order', 'score', 'clip', 'review', 'dupe', 'processed'];

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
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

async function loadCatalog() {
  try {
    const rows = parseCSV(await readFile(CATALOG, 'utf8'));
    const header = rows.shift().map((h) => h.trim());
    return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  } catch { return []; }
}

const saveCatalog = (records) =>
  writeFile(
    CATALOG,
    [COLUMNS.join(','), ...records.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
  );

/* ---------------- invisible fingerprint (tiled LSB, blue channel) ---------------- */

const MAGIC = 'FT1:';
function embedLSB(raw, channels, payload) {
  const msg = MAGIC + payload + '\0';
  const bits = [...msg].flatMap((c) => [...Array(8)].map((_, i) => (c.charCodeAt(0) >> (7 - i)) & 1));
  for (let px = 0, bit = 0; px * channels + 2 < raw.length; px++, bit++) {
    const i = px * channels + 2;
    raw[i] = (raw[i] & 0xfe) | bits[bit % bits.length];
  }
  return raw;
}
async function stamp(buf, payload) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return sharp(embedLSB(data, info.channels, payload), {
    raw: { width: info.width, height: info.height, channels: info.channels },
  });
}

/* ---------------- signature block ---------------- */

const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/** Text signature + date, bottom-right, with a soft shadow so it reads on any art. */
const signatureSVG = (w, h, dateLabel) => Buffer.from(`
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="s" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="#000" flood-opacity="0.65"/>
      </filter>
    </defs>
    <text x="${w - 24}" y="${h - 42}" text-anchor="end" filter="url(#s)"
          font-family="Georgia, 'Times New Roman', serif" font-style="italic"
          font-size="${Math.max(20, Math.round(w / 32))}" fill="#ffffff" opacity="0.92">${esc(ARTIST)}</text>
    <text x="${w - 24}" y="${h - 18}" text-anchor="end" filter="url(#s)"
          font-family="sans-serif" font-size="${Math.max(12, Math.round(w / 68))}"
          fill="#ffffff" opacity="0.7" letter-spacing="1.5">${esc(dateLabel)}</text>
  </svg>`);

/** Date caption that sits under an image signature. */
const dateSVG = (w, h, dateLabel) => Buffer.from(`
  <svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <text x="${w - 24}" y="${h - 18}" text-anchor="end"
          font-family="sans-serif" font-size="${Math.max(12, Math.round(w / 68))}"
          fill="#ffffff" opacity="0.75" letter-spacing="1.5">${esc(dateLabel)}</text>
  </svg>`);

/**
 * Turns a signature file into a clean transparent overlay.
 *
 * Handles the common case: you signed a sheet of paper and photographed or
 * scanned it, so you have a JPEG of dark ink on a light background. JPEG can't
 * store transparency, so pasting it directly would drop a white box on your
 * art. This keys the paper out by luminance — darker pixel means more opaque —
 * which preserves the soft edges of the pen stroke instead of hard-cutting it.
 *
 * The ink is then recoloured (white by default) so it reads on dark artwork.
 * Pass --signature-keep-bg if you already have a clean transparent PNG and want
 * it composited exactly as-is.
 */
async function prepareSignature(w) {
  const sigW = Math.round(w * SIG_WIDTH);
  // Trim the paper margin first, so the ink itself is what gets scaled and
  // placed. Without this, a signature photographed with lots of empty paper
  // around it lands on the artwork tiny and floating off-position.
  const trimmed = await sharp(SIGNATURE)
    .trim({ threshold: TRIM_THRESHOLD })
    .toBuffer()
    .catch(() => sharp(SIGNATURE).toBuffer()); // uniform image: nothing to trim
  const resized = sharp(trimmed).resize({ width: sigW });

  if (KEEP_BG) return resized.png().toBuffer();

  const { data, info } = await resized.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const [cr, cg, cb] = INK_RGB;

  for (let i = 0; i < data.length; i += ch) {
    // Rec. 601 luma — good enough for separating ink from paper.
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Fully opaque at/below INK_FLOOR, fully clear at/above PAPER_LEVEL.
    let alpha = ((PAPER_LEVEL - lum) / (PAPER_LEVEL - INK_FLOOR)) * 255;
    alpha = Math.max(0, Math.min(255, alpha));
    data[i] = cr; data[i + 1] = cg; data[i + 2] = cb;
    if (ch === 4) data[i + 3] = Math.round(alpha);
  }

  return sharp(data, { raw: { width: info.width, height: info.height, channels: ch } })
    .png().toBuffer();
}

async function signPreview(previewBuf, dateLabel) {
  const { width: w, height: h } = await sharp(previewBuf).metadata();
  const layers = [];

  const hasSig = SIGNATURE && (await access(SIGNATURE).then(() => true).catch(() => false));
  if (hasSig) {
    const sig = await prepareSignature(w);
    const sigH = (await sharp(sig).metadata()).height;
    // Soft shadow behind the mark so it survives light passages in the art.
    const shadow = await sharp(sig).blur(3).toBuffer();
    const left = w - (await sharp(sig).metadata()).width - SIG_MARGIN;
    const top = h - sigH - SIG_MARGIN - 16;   // leaves room for the date line
    layers.push({ input: shadow, left, top: top + 2 });
    layers.push({ input: sig, left, top });
    layers.push({ input: dateSVG(w, h, dateLabel) });
  } else {
    layers.push({ input: signatureSVG(w, h, dateLabel) });
  }
  return sharp(previewBuf).composite(layers).png().toBuffer();
}

/* ---------------- title + date ----------------
 * Filenames carry the metadata (TITLE_YYYY-MM-DD_FINAL_3001.jpg), so the
 * parser does the work. Where a filename's date is unusable — an impossible
 * day, no date at all — we fall back to the file's own timestamp and mark the
 * row `review` so it surfaces instead of quietly landing on a wrong day. */

async function fileDate(file) {
  try {
    const meta = await sharp(file).metadata();
    const raw = meta.exif && meta.exif.toString('latin1').match(/(\d{4}):(\d{2}):(\d{2})/);
    if (raw) return `${raw[1]}-${raw[2]}-${raw[3]}`;
  } catch { /* fall through */ }
  const s = await stat(file);
  return new Date(s.mtime).toISOString().slice(0, 10);
}

async function describe(fileName, fullPath) {
  const p = parseFilename(fileName, { fallbackYear: YEAR });
  const date = p.date ?? (await fileDate(fullPath));
  return {
    title: p.title,
    date,
    day: dayOfYear(date),
    confidence: p.confidence,
    issues: p.issues,
  };
}

/* ---------------- run ---------------- */

await mkdir(join(OUT, 'previews'), { recursive: true });
await mkdir(join(OUT, 'masters'), { recursive: true });

const catalog = await loadCatalog();
const seen = new Set(catalog.map((r) => r.filename));
const files = (await readdir(dropDir))
  .filter((f) => /\.(png|jpe?g|tiff?|webp)$/i.test(f))
  .sort();

console.log(`Drop folder: ${files.length} images · catalog: ${catalog.length} existing\n`);

// 1) Add any new files to the catalog (never touching rows you've edited).
let nextNum = catalog.length
  ? Math.max(...catalog.map((r) => Number(String(r.id).split('-').pop()) || 0))
  : 0;
let nextDay = catalog.length
  ? Math.max(...catalog.map((r) => Number(r.day) || 0))
  : START_DAY - 1;

const flagged = [];
for (const f of files) {
  if (seen.has(f)) continue;
  const full = join(dropDir, f);
  const meta = await sharp(full).metadata().catch(() => ({}));
  const info = await describe(f, full);
  nextNum += 1;
  if (info.confidence !== 'high') flagged.push({ file: f, ...info });
  catalog.push({
    id: `FT-${YEAR}-${String(nextNum).padStart(3, '0')}`,
    filename: f,
    title: info.title,
    date: info.date,
    day: String(info.day ?? ++nextDay),
    review: info.confidence === 'high' ? '' : info.issues.join('; '),
    description: '',
    tags: '',
    ratio: meta.width && meta.height
      ? (Math.abs(meta.width / meta.height - 1) < 0.02 ? '1 / 1' : `${meta.width} / ${meta.height}`)
      : '1 / 1',
    order: '',
    score: '',
    clip: '',
    processed: '',
  });
  console.log(`+ catalogued ${f} → FT-${YEAR}-${String(nextNum).padStart(3, '0')}`);
}
await saveCatalog(catalog);

// 1b) Duplicate detection by content hash.
// Filenames lie — SPACESUIT.3 appears on two different days, and near-identical
// titles are common. Hashing the actual bytes finds true duplicates regardless
// of what they're called. Dupes are marked, never deleted; that call is yours.
const hashes = new Map();
// Which copy survives matters, because the names differ even when the bytes
// don't ("HAWK.EYE" vs "HAWK.EYE.COPY"). Check cleanly-dated rows first, then
// shorter titles — so the original beats the copy instead of whichever
// happened to sort first.
const dedupeOrder = [...catalog].sort((a, b) => {
  const ar = a.review ? 1 : 0, br = b.review ? 1 : 0;
  if (ar !== br) return ar - br;
  return (a.title ?? '').length - (b.title ?? '').length;
});

for (const rec of dedupeOrder) {
  const src = join(dropDir, rec.filename);
  if (!(await access(src).then(() => true).catch(() => false))) continue;
  if (rec.dupe) continue;
  const h = createHash('sha256').update(await readFile(src)).digest('hex').slice(0, 16);
  if (hashes.has(h) && hashes.get(h) !== rec.id) {
    rec.dupe = `identical to ${hashes.get(h)}`;
  } else {
    hashes.set(h, rec.id);
    rec.dupe = '';
  }
}
const dupes = catalog.filter((r) => r.dupe);
await saveCatalog(catalog);

// 2) Process anything not yet done. Exact duplicates are skipped.
let processed = 0, missing = 0;
for (const rec of catalog) {
  const src = join(dropDir, rec.filename);
  if (!(await access(src).then(() => true).catch(() => false))) { missing++; continue; }
  if (rec.dupe) continue;
  if (rec.processed === 'yes' && !FORCE) continue;

  const dateLabel = rec.date;
  const preview1080 = await sharp(src)
    .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true })
    .png().toBuffer();

  const signed = await signPreview(preview1080, dateLabel);
  const fingerprinted = await stamp(signed, rec.id);

  const meta = {
    exif: {
      IFD0: {
        Copyright: `© ${YEAR} ${ARTIST} / FREETHINKERS.AI — all rights reserved`,
        Artist: ARTIST,
        ImageDescription: `${rec.id} | ${rec.title} | ${rec.date}`,
      },
    },
  };

  await fingerprinted.withMetadata(meta).png().toFile(join(OUT, 'previews', `${rec.id}.png`));
  // Master: pixels untouched (full resolution), metadata stamped.
  await sharp(src).withMetadata(meta).png().toFile(join(OUT, 'masters', `${rec.id}.png`));

  rec.processed = 'yes';
  processed++;
  console.log(`✔ ${rec.id}  ${rec.title}  (${rec.date})`);
}
await saveCatalog(catalog);

// 3) Rebuild the site catalog.
// Display order: your manual `order` first (lowest number = first), then
// anything unordered by score, then by day. Your hand always beats the machine.
const ranked = [...catalog].sort((a, b) => {
  const ao = a.order === '' ? Infinity : Number(a.order);
  const bo = b.order === '' ? Infinity : Number(b.order);
  if (ao !== bo) return ao - bo;
  const as = Number(a.score) || 0, bs = Number(b.score) || 0;
  if (as !== bs) return bs - as;
  return (Number(a.day) || 0) - (Number(b.day) || 0);
});

const pieces = ranked.map((r) => ({
  id: r.id,
  title: r.title,
  story: r.description || '',
  date: r.date,
  day: Number(r.day) || null,
  ratio: r.ratio || '1 / 1',
  editionSize: 120,
  tags: r.tags ? r.tags.split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [],
  ...(r.clip ? { clip: r.clip } : {}),
  ...(r.score ? { score: Number(r.score) } : {}),
}));
await writeFile(
  new URL('../site/src/data/pieces.json', import.meta.url),
  JSON.stringify(pieces, null, 2)
);

const noDesc = catalog.filter((r) => !r.description).length;
const needReview = catalog.filter((r) => r.review);

console.log(`
─────────────────────────────────────────────
 ${processed} processed · ${catalog.length} in catalog · ${pieces.length} live on the site
${missing ? ` ${missing} catalog rows have no file in the drop folder (kept, not processed)\n` : ''}${
  noDesc ? ` ${noDesc} pieces still need a description — add them in ${CATALOG} and rerun.` : ' Every piece has a description.'}`);

if (dupes.length) {
  console.log(`\n ${dupes.length} exact duplicate(s) found by content hash — skipped, not deleted:`);
  dupes.forEach((d) => console.log(`   ${d.filename}  →  ${d.dupe}`));
  console.log(`   Clear the \`dupe\` column to force one through.`);
}

if (needReview.length) {
  console.log(`\n ${needReview.length} date(s) I could not read cleanly. These used the file's own`);
  console.log(` timestamp instead — check the \`date\` and \`day\` columns in ${CATALOG}:`);
  needReview.forEach((r) => console.log(`   ${r.filename}\n     → ${r.date} (day ${r.day}) — ${r.review}`));
}

console.log(`

 Next:
   Previews → R2:  for f in ${OUT}/previews/*; do npx wrangler r2 object put "ft-public/previews/$(basename $f)" --file "$f"; done
   Masters  → R2:  for f in ${OUT}/masters/*;  do npx wrangler r2 object put "ft-masters/masters/$(basename $f)" --file "$f"; done
   Cards:          node make-og-images.mjs --previews ${OUT}/previews
`);
