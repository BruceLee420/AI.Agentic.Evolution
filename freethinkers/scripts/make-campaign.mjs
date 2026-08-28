#!/usr/bin/env node
/**
 * CAMPAIGN KIT — one ready-to-post marketing pack per piece.
 *
 * The daily grind of selling art isn't making it, it's posting it. This turns
 * each catalogued piece into a file you can copy straight into a post: caption
 * variants, hashtags, the share URL, and pointers to the QR and share card that
 * were already generated for it.
 *
 * It writes text, not posts. Nothing is scheduled or published automatically —
 * you own what goes out under your name, and platforms punish bulk automation
 * anyway. Copy, tweak the line that doesn't sound like you, post.
 *
 *   node make-campaign.mjs                    # all pieces → ./campaigns/
 *   node make-campaign.mjs --id FT-2026-034   # just one
 *   node make-campaign.mjs --index            # one combined CSV for planning
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);

const SITE = opt('--site', 'https://freethinkers.ai');
const HANDLE = opt('--handle', '@freethinkers.ai');
const ONE = opt('--id', '');
const OUT = opt('--out', './campaigns');

const pieces = JSON.parse(
  await readFile(new URL('../site/src/data/pieces.json', import.meta.url), 'utf8')
);
if (!pieces.length) {
  console.error('No pieces in the catalog yet. Run ingest.mjs first.');
  process.exit(1);
}

const BASE_TAGS = ['#aiart', '#digitalart', '#everydays', '#freethinkers'];

/** Tags derived from the piece itself, so posts aren't identical boilerplate. */
function tagsFor(p) {
  const own = (p.tags ?? []).map((t) => '#' + String(t).replace(/[^a-z0-9]/gi, '').toLowerCase());
  return [...new Set([...own, ...BASE_TAGS])].slice(0, 8).join(' ');
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const list = ONE ? pieces.filter((p) => p.id === ONE) : pieces;
if (!list.length) { console.error(`No piece with id ${ONE}`); process.exit(1); }

await mkdir(OUT, { recursive: true });
const rows = [];

for (const p of list) {
  const url = `${SITE}/art/${p.id}`;
  const cert = `${SITE}/a/${p.id}`;
  const story = (p.story ?? '').trim();
  const day = p.day ?? '—';

  // Three lengths, because the platforms want different things: a caption that
  // stands alone, a short line for image-first feeds, and a one-liner for chat.
  const long = [
    `${p.title} — Day ${day} of 365.`,
    story || null,
    `Signed, dated, and fingerprinted to me. Own the full-resolution master, hang it as a print, or wear it with a QR code that proves it's yours.`,
    url,
    tagsFor(p),
  ].filter(Boolean).join('\n\n');

  const short = `${p.title} · Day ${day}/365. Master, print, or pressed with its own QR. ${url}`;
  const oneliner = `${p.title} — Day ${day}. ${url}`;

  const md = `# ${p.title}

**${p.id}** · Day ${day} · ${p.date ?? ''}

- Piece page: ${url}
- Certificate (QR target): ${cert}
- Share card: site/public/og/${p.id}.png
- QR code: qr/${p.id}.qr.png

---

## Caption — long

${long}

---

## Caption — short

${short}

---

## One-liner

${oneliner}

---

## Hashtags

${tagsFor(p)}

---

## Pinned-comment / first-comment

Platforms bury outbound links in the post body. Put the art in the post and
this in the first comment:

Full piece, master file, and prints → ${url}

---

## Notes

${story ? '' : '⚠ No description set. Add one in catalog.csv — the story is what sells a $300 piece, not the pixels.'}
`;

  await writeFile(`${OUT}/${p.id}.md`, md);
  rows.push({ id: p.id, title: p.title, day, date: p.date ?? '', url, oneliner, tags: tagsFor(p), hasStory: story ? 'yes' : 'NO' });
}

if (flag('--index') || !ONE) {
  const cols = ['id', 'title', 'day', 'date', 'url', 'oneliner', 'tags', 'hasStory'];
  await writeFile(
    `${OUT}/campaign-index.csv`,
    [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n'
  );
}

const missing = rows.filter((r) => r.hasStory === 'NO').length;
console.log(`✔ ${rows.length} campaign pack(s) → ${OUT}/`);
if (!ONE) console.log(`✔ planning sheet → ${OUT}/campaign-index.csv`);
if (missing) {
  console.log(`\n⚠ ${missing} piece(s) have no description.`);
  console.log(`  Captions for those are generic. The story is what sells a $300`);
  console.log(`  piece — fill the description column in catalog.csv and rerun.`);
}
console.log(`\nThese are drafts to copy, not scheduled posts. Nothing is published for you.`);
