#!/usr/bin/env node
/**
 * QR codes for the Press line — one per piece, landing on its certificate page.
 *
 *   node qr-generate.mjs FT-2026-001      # one piece
 *   node qr-generate.mjs --all            # every piece in site/src/data/pieces.json
 *
 * Outputs ./qr/{id}.qr.png (1200px) and ./qr/{id}.qr.svg (vector, for print files).
 * Scan URLs carry ?via=press so worker logs show which sales the garments drove.
 */
import QRCode from 'qrcode';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const BASE = process.env.SITE_ORIGIN ?? 'https://freethinkers.ai';
const OUT = './qr';
await mkdir(OUT, { recursive: true });

const ids = process.argv.includes('--all')
  ? JSON.parse(await readFile(new URL('../site/src/data/pieces.json', import.meta.url), 'utf8')).map((p) => p.id)
  : process.argv.slice(2);

if (!ids.length) { console.error('usage: node qr-generate.mjs <PIECE-ID...> | --all'); process.exit(1); }

for (const id of ids) {
  const url = `${BASE}/a/${id}?via=press`;
  await QRCode.toFile(`${OUT}/${id}.qr.png`, url, {
    width: 1200, margin: 2,
    errorCorrectionLevel: 'H',           // survives fabric distortion + partial cover
    color: { dark: '#0d0d0f', light: '#f6f4ef' },
  });
  await writeFile(`${OUT}/${id}.qr.svg`, await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H' }));
  console.log(`✔ ${id} → ${url}`);
}
console.log(`\nQR files in ${OUT}/ — printful-sync.mjs composites them onto garment print files.`);
