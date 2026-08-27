#!/usr/bin/env node
/**
 * Printful product setup, per piece:
 *   1. Composites the garment print file — artwork above its QR code.
 *   2. Prints the KV mapping commands the worker needs (`PF:{itemId}`), which is
 *      what lets an order webhook place a Printful order automatically.
 *
 *   PRINTFUL_KEY=... node printful-sync.mjs ./out/previews ./qr
 *
 * Verify current variant ids in the Printful catalog API before going live —
 * they change, and a stale id silently fails an order.
 */
import sharp from 'sharp';
import { readdir, mkdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import 'dotenv/config';

const KEY = process.env.PRINTFUL_KEY;
if (!KEY) { console.error('Set PRINTFUL_KEY (env or .env)'); process.exit(1); }

const [previewDir = './out/previews', qrDir = './qr'] = process.argv.slice(2);
const PF = (path, body) =>
  fetch(`https://api.printful.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  }).then((r) => r.json());

await mkdir('./printfiles', { recursive: true });
const pieces = (await readdir(previewDir)).filter((f) => /^FT-.*\.png$/.test(f));

for (const f of pieces) {
  const id = basename(f, '.png');

  // 4500×5400 DTG canvas: art centered up top, QR beneath it.
  const art = await sharp(join(previewDir, f)).resize(3600, 3600, { fit: 'inside' }).toBuffer();
  const { width: aw, height: ah } = await sharp(art).metadata();
  const qr = await sharp(join(qrDir, `${id}.qr.png`)).resize(900).toBuffer();
  const file = `./printfiles/${id}.press.png`;

  await sharp({ create: { width: 4500, height: 5400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: art, top: 300, left: Math.round((4500 - aw) / 2) },
      { input: qr, top: 300 + ah + 150, left: Math.round((4500 - 900) / 2) },
    ])
    .png().toFile(file);
  console.log(`✔ print file ${file}`);

  // Printful needs print files at a public URL. Upload ./printfiles to a public
  // R2 bucket (e.g. printfiles.freethinkers.ai), then map for the worker:
  console.log(`  npx wrangler kv key put --namespace-id $PRICING_NS "PF:${id}-press" ` +
    `'{"variant_id": <SWEATSHIRT_VARIANT>, "print_file_url": "https://printfiles.freethinkers.ai/${id}.press.png"}'`);
  console.log(`  npx wrangler kv key put --namespace-id $PRICING_NS "PF:${id}-print" ` +
    `'{"variant_id": <POSTER_VARIANT>, "print_file_url": "https://printfiles.freethinkers.ai/${id}.png"}'`);
}

console.log('\nStore check:', JSON.stringify(await PF('/store/products')).slice(0, 200));
