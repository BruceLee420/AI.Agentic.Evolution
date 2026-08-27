#!/usr/bin/env node
/**
 * FTWlabs migration: the ~3k concept images → R2, protected, cataloged.
 * Resumable — reruns skip anything already in the manifest, so it survives
 * interruption (and a 3,000-image run will get interrupted).
 *
 *   node migrate-concepts.mjs <conceptsDir> [--bucket ftw-concepts]
 *                             [--prefix 2026] [--manifest concepts-manifest.json]
 *                             [--limit 200]   # do a first batch tonight
 *
 * The manifest is the FTWlabs catalog — copy it to
 * ftwlabs/src/data/concepts.json when you're happy with the batch.
 */
import sharp from 'sharp';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const dir = argv.find((a) => !a.startsWith('--'));
const bucket = opt('--bucket', 'ftw-concepts');
const prefix = opt('--prefix', '2026');
const manifestPath = opt('--manifest', 'concepts-manifest.json');
const limit = Number(opt('--limit', Infinity));

if (!dir) { console.error('usage: node migrate-concepts.mjs <conceptsDir> [--limit N]'); process.exit(1); }

let manifest = [];
try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch {}
const done = new Set(manifest.map((m) => m.originalName));
let seq = manifest.length;

const files = (await readdir(dir)).filter((f) => /\.(png|jpe?g|webp|tiff?)$/i.test(f)).sort();
console.log(`${files.length} concepts on disk, ${done.size} already migrated\n`);

const mark = (w, h, id) => Buffer.from(
  `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
     <text x="${w / 2}" y="${h / 2}" font-size="${Math.round(w / 14)}" fill="#fff" opacity="0.10"
       font-family="sans-serif" text-anchor="middle" transform="rotate(-30 ${w / 2} ${h / 2})">FTWLABS</text>
     <text x="${w - 12}" y="${h - 12}" font-size="16" fill="#fff" opacity="0.75"
       font-family="sans-serif" text-anchor="end">© FTWLABS · ${id}</text>
   </svg>`);

let processed = 0;
for (const f of files) {
  if (done.has(f)) continue;
  if (processed >= limit) { console.log(`\nHit --limit ${limit}. Rerun to continue.`); break; }
  seq += 1; processed += 1;
  const id = `FTW-${String(seq).padStart(4, '0')}`;

  const master = await sharp(join(dir, f)).png().toBuffer();
  const preview = await sharp(master)
    .resize(1080, 1080, { fit: 'inside', withoutEnlargement: true }).toBuffer();
  const { width, height } = await sharp(preview).metadata();
  const marked = await sharp(preview).composite([{ input: mark(width, height, id) }]).png().toBuffer();

  await writeFile(`/tmp/${id}.png`, master);
  await writeFile(`/tmp/${id}.preview.png`, marked);
  await run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/masters/${prefix}/${id}.png`, '--file', `/tmp/${id}.png`]);
  await run('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/public/${prefix}/${id}.png`, '--file', `/tmp/${id}.preview.png`]);

  manifest.push({
    id, originalName: f, title: id, tags: [], width, height,
    sha256: createHash('sha256').update(master).digest('hex').slice(0, 16),
    date: new Date().toISOString().slice(0, 10),
  });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2)); // save each → resumable
  console.log(`✔ ${id}  (${f})  [${processed}]`);
}

console.log(`\nCatalog: ${manifestPath} (${manifest.length} concepts)`);
console.log(`Publish:  cp ${manifestPath} ../ftwlabs/src/data/concepts.json`);
