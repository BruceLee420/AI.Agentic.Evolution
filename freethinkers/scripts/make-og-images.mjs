#!/usr/bin/env node
/**
 * Social share cards (1200×630) for every piece and concept.
 *
 * Worth the ten minutes: a post with a real preview card gets meaningfully more
 * clicks than a bare link, and tonight every click counts. Cards use the
 * watermarked preview when one exists and fall back to a branded gradient when
 * it doesn't — so you can generate these before the art pipeline has run.
 *
 *   node make-og-images.mjs                       # both sites, from catalog data
 *   node make-og-images.mjs --previews ./out/previews
 *
 * Output: ../site/public/og/{id}.png and ../ftwlabs/public/og/{id}.png
 * Reference from a page head:
 *   <meta property="og:image" content="https://freethinkers.ai/og/FT-2026-001.png" />
 */
import sharp from 'sharp';
import { readFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const previewDir = opt('--previews', '');

const W = 1200, H = 630;
const hue = (id) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

const overlay = (title, id, brand, accent) => Buffer.from(`
  <svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#0d0d0f" stop-opacity="0.95"/>
        <stop offset="65%" stop-color="#0d0d0f" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#0d0d0f" stop-opacity="0.15"/>
      </linearGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#fade)"/>
    <text x="64" y="150" font-family="sans-serif" font-size="22" font-weight="700"
          fill="${accent}" letter-spacing="4">${esc(brand)}</text>
    <text x="64" y="300" font-family="sans-serif" font-size="72" font-weight="800"
          fill="#f6f4ef">${esc(title).slice(0, 26)}</text>
    <text x="64" y="360" font-family="sans-serif" font-size="28"
          fill="#9a9aa2">${esc(id)}</text>
    <text x="64" y="560" font-family="sans-serif" font-size="24" fill="#f6f4ef"
          opacity="0.85">Own the master →</text>
  </svg>`);

async function card(id, title, brand, accent, outDir) {
  let base;
  const src = previewDir ? join(previewDir, `${id}.png`) : null;
  const hasPreview = src && await access(src).then(() => true).catch(() => false);

  if (hasPreview) {
    base = await sharp(src).resize(W, H, { fit: 'cover', position: 'attention' }).toBuffer();
  } else {
    const h = hue(id);
    base = await sharp({
      create: { width: W, height: H, channels: 3, background: { r: 13, g: 13, b: 15 } },
    })
      .composite([{
        input: Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="hsl(${h},55%,28%)"/>
            <stop offset="100%" stop-color="hsl(${(h + 55) % 360},45%,10%)"/>
          </linearGradient></defs>
          <rect width="${W}" height="${H}" fill="url(#g)"/></svg>`),
      }])
      .png().toBuffer();
  }

  await sharp(base)
    .composite([{ input: overlay(title, id, brand, accent) }])
    .png().toFile(join(outDir, `${id}.png`));
}

/* ---------- Freethinkers ---------- */
const siteOut = new URL('../site/public/og/', import.meta.url);
await mkdir(siteOut, { recursive: true });
const pieces = JSON.parse(await readFile(new URL('../site/src/data/pieces.json', import.meta.url), 'utf8'));
for (const p of pieces) {
  await card(p.id, p.title ?? p.id, 'FREETHINKERS.AI', '#ff4d00', siteOut.pathname);
  process.stdout.write('.');
}
console.log(`\n✔ ${pieces.length} Freethinkers cards → site/public/og/`);

/* ---------- FTWlabs ---------- */
const labOut = new URL('../ftwlabs/public/og/', import.meta.url);
await mkdir(labOut, { recursive: true });
const concepts = JSON.parse(await readFile(new URL('../ftwlabs/src/data/concepts.json', import.meta.url), 'utf8'));
for (const c of concepts) {
  await card(c.id, c.title ?? c.id, 'FTWLABS', '#00e5a0', labOut.pathname);
  process.stdout.write('.');
}
console.log(`\n✔ ${concepts.length} FTWlabs cards → ftwlabs/public/og/`);
console.log('\nCards are referenced automatically by the piece and concept pages.');
