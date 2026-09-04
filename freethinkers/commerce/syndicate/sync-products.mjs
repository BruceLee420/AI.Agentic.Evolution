#!/usr/bin/env node
/**
 * SYNC — art assets in, live provider listings out.
 *
 * Run from the commerce/ directory (paths below are relative to it):
 *
 *   node syndicate/sync-products.mjs printfiles    # build print-ready files (+ QR press composites)
 *   node syndicate/sync-products.mjs verify        # resolve everything, create nothing
 *   node syndicate/sync-products.mjs run [--limit N] [--pieces FT-2026-001,FT-2026-002]
 *   node syndicate/sync-products.mjs mappings      # emit worker KV mappings + push script
 *
 * Per piece × configured product it: resolves the provider's live catalog ids
 * by name, computes the print-area fit from the actual master dimensions,
 * creates the listing with correctly scaled placement, captures mockups, and
 * records everything in synced-products.json (idempotent — reruns skip
 * finished work, a crash resumes where it stopped).
 *
 * `verify` is the step that keeps this honest: it prints every name→id
 * resolution and every DPI number BEFORE anything exists on a store, because
 * the expensive failure here isn't an API error — it's 180 listings quietly
 * created against the wrong garment.
 *
 * Requires: PRINTFUL_KEY and/or PRINTIFY_KEY in env, art already ingested
 * (scripts/out/masters), print files uploaded to config.fileBase.
 */

import { readFile, writeFile, access, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import config, { itemId } from '../products.config.mjs';
import { printful } from './printful.mjs';
import { printify } from './printify.mjs';
import { loadState, saveState, toFulfillmentMappings } from './state.mjs';
import { printfulPosition, printifyPlacement, effectiveDpi, parseSizeInches } from './scale.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (f, d) => (argv.indexOf(f) > -1 ? argv[argv.indexOf(f) + 1] : d);
const LIMIT = Number(opt('--limit', Infinity));
const ONLY = (opt('--pieces', '') || '').split(',').filter(Boolean);
const STATE_PATH = opt('--state', './synced-products.json');
const MASTERS = opt('--masters', '../scripts/out/masters');
const PIECES_JSON = opt('--catalog', '../site/src/data/pieces.json');
const API_BASE = process.env.PRINTFUL_BASE ?? null;   // test hook: mock server
const API_BASE_PY = process.env.PRINTIFY_BASE ?? null;

if (!['printfiles', 'verify', 'run', 'mappings'].includes(cmd)) {
  console.error('usage: sync-products.mjs printfiles|verify|run|mappings [--limit N] [--pieces id,id]');
  process.exit(1);
}

/* ---------- inputs (paths resolve from CWD — run from commerce/) ---------- */

const pieces = JSON.parse(await readFile(PIECES_JSON, 'utf8'))
  .filter((p) => (p.kind ?? 'daily') === 'daily')
  .filter((p) => !ONLY.length || ONLY.includes(p.id))
  .slice(0, LIMIT);
if (!pieces.length) { console.error('No pieces to sync. Run ingest first.'); process.exit(1); }

const state = await loadState(STATE_PATH);
const log = (m) => console.log(m);

const providers = {};
if (process.env.PRINTFUL_KEY) {
  providers.printful = printful({ apiKey: process.env.PRINTFUL_KEY, log });
  if (API_BASE) patchBase(providers.printful, API_BASE); // test hook
}
if (process.env.PRINTIFY_KEY) {
  providers.printify = printify({ apiKey: process.env.PRINTIFY_KEY, log });
  if (API_BASE_PY) patchBase(providers.printify, API_BASE_PY);
}
if (!Object.keys(providers).length && (cmd === 'verify' || cmd === 'run')) {
  console.error('Set PRINTFUL_KEY and/or PRINTIFY_KEY. Nothing to talk to.');
  process.exit(1);
}

// Test hook: rebind an adapter to a mock server by rebuilding it with a
// patched fetch. Kept out of the adapters so production code has no test path.
function patchBase(adapter, base) {
  const origFetch = globalThis.fetch;
  const real = adapter.__realBase ?? (adapter.name === 'printful' ? 'https://api.printful.com' : 'https://api.printify.com/v1');
  adapter.__realBase = real;
  if (!globalThis.__syndicatePatched) {
    globalThis.__syndicatePatched = true;
    globalThis.fetch = (url, init) => {
      let u = String(url);
      if (u.startsWith('https://api.printful.com')) u = u.replace('https://api.printful.com', process.env.PRINTFUL_BASE ?? 'https://api.printful.com');
      if (u.startsWith('https://api.printify.com/v1')) u = u.replace('https://api.printify.com/v1', process.env.PRINTIFY_BASE ?? 'https://api.printify.com/v1');
      return origFetch(u, init);
    };
  }
}

/* ---------- catalog resolution (cached in state) ---------- */

async function resolveProduct(prod) {
  const cacheKey = `${prod.provider}:${prod.key}`;
  if (state.resolved[cacheKey]) return state.resolved[cacheKey];

  let resolved;
  if (prod.provider === 'printful') {
    const pf = providers.printful;
    if (!pf) throw new Error(`piece needs printful but PRINTFUL_KEY is not set (product ${prod.key})`);
    const wanted = { sizes: prod.options.size ?? [], colors: prod.options.color ?? [] };
    const { productTitle, matched, missingSizes } = await pf.resolveVariants(prod.catalogId, wanted);
    if (!matched.length) throw new Error(`printful ${prod.key}: no variants matched sizes=${wanted.sizes} colors=${wanted.colors} on catalog ${prod.catalogId} ("${productTitle}")`);
    const areas = await pf.printfiles(prod.catalogId).catch(() => ({}));
    resolved = { provider: 'printful', catalogId: prod.catalogId, productTitle, variants: matched, missingSizes, areas };
  } else if (prod.provider === 'printify') {
    const py = providers.printify;
    if (!py) throw new Error(`piece needs printify but PRINTIFY_KEY is not set (product ${prod.key})`);
    const bp = await py.findBlueprint(prod.blueprintSearch);
    const pr = await py.findProvider(bp.blueprintId, prod.providerId ?? null);
    const wanted = { sizes: prod.options.size ?? [], colors: prod.options.color ?? [] };
    const { matched, missingSizes } = await py.resolveVariants(bp.blueprintId, pr.providerId, wanted);
    if (!matched.length) throw new Error(`printify ${prod.key}: no variants matched on "${bp.title}" via ${pr.title}`);
    const area = await py.printArea(bp.blueprintId, pr.providerId, matched.map((m) => m.variantId));
    resolved = { provider: 'printify', blueprintId: bp.blueprintId, blueprintTitle: bp.title, providerId: pr.providerId, providerTitle: pr.title, variants: matched, missingSizes, area };
  } else {
    throw new Error(`unknown provider "${prod.provider}" on product ${prod.key}`);
  }

  state.resolved[cacheKey] = resolved;
  await saveState(STATE_PATH, state);
  return resolved;
}

/* ---------- verify ---------- */

async function verify() {
  console.log('— provider access —');
  for (const p of Object.values(providers)) {
    const who = await p.whoami();
    console.log(`  ✔ ${p.name}: connected to "${who.store}"`);
  }

  console.log('\n— catalog resolution (nothing is created by verify) —');
  const allProducts = Object.entries(config.categories)
    .flatMap(([cat, c]) => (c.products ?? []).map((p) => ({ cat, ...p })));

  for (const prod of allProducts) {
    if (!providers[prod.provider]) { console.log(`  – ${prod.cat}/${prod.key}: skipped (${prod.provider} key not set)`); continue; }
    const r = await resolveProduct(prod);
    const label = r.provider === 'printful'
      ? `catalog ${r.catalogId} "${r.productTitle}"`
      : `blueprint ${r.blueprintId} "${r.blueprintTitle}" via ${r.providerTitle}`;
    console.log(`  ✔ ${prod.cat}/${prod.key} → ${r.provider}: ${label}`);
    console.log(`      variants matched: ${r.variants.length}${r.missingSizes.length ? `  ⚠ missing sizes: ${r.missingSizes.join(', ')}` : ''}`);
  }

  console.log('\n— print resolution check on your actual masters —');
  const sample = pieces.slice(0, 3);
  for (const piece of sample) {
    const file = join(MASTERS, `${piece.id}.png`);
    if (!(await access(file).then(() => true).catch(() => false))) { console.log(`  – ${piece.id}: master not found at ${file}`); continue; }
    const meta = await sharp(file).metadata();
    for (const prod of config.categories.print.products) {
      for (const size of prod.options.size) {
        const inches = parseSizeInches(size);
        const dpi = effectiveDpi(meta.width, meta.height, inches.w, inches.h);
        const mark = dpi >= (prod.minDpi ?? 150) ? '✔' : '⚠';
        console.log(`  ${mark} ${piece.id} @ ${size}: ${dpi}dpi${dpi < (prod.minDpi ?? 150) ? ' — below minimum, will be skipped in run' : ''}`);
      }
    }
  }
  console.log('\nverify complete — review the resolutions above, then `run`.');
}

/* ---------- run ---------- */

async function run() {
  const allProducts = Object.entries(config.categories)
    .flatMap(([cat, c]) => (c.products ?? []).map((p) => ({ cat, ...p })));

  let created = 0, skipped = 0, warned = 0;

  for (const piece of pieces) {
    const masterFile = join(MASTERS, `${piece.id}.png`);
    const hasMaster = await access(masterFile).then(() => true).catch(() => false);
    if (!hasMaster) { console.log(`– ${piece.id}: no master file, skipping piece`); continue; }
    const meta = await sharp(masterFile).metadata();

    for (const prod of allProducts) {
      if (!providers[prod.provider]) continue;
      const id = itemId(piece.id, prod.cat, prod.key);
      if (state[prod.provider]?.[id]) { skipped++; continue; }

      const r = await resolveProduct(prod);
      // Which print file this product prints from: a cut & sew set file
      // (make-merch-set.mjs), the QR press composite, or the plain master.
      const artUrl = `${config.fileBase}/${
        prod.printFile ? `${piece.id}-${prod.printFile}.png`
        : prod.useQrComposite ? `${piece.id}.press.png`
        : `${piece.id}.png`
      }`;
      const title = `${piece.title} — ${prod.label}`;

      try {
        if (prod.provider === 'printful') {
          // Per-size price map for prints; flat price for garments.
          const variants = r.variants
            .filter((v) => {
              if (!prod.price || typeof prod.price === 'number') return true;
              const key = Object.keys(prod.price).find((k) => normSize(v.size) === normSize(k));
              if (!key) return false;
              // DPI gate per size — refuse to list soft prints.
              const inches = parseSizeInches(key);
              const dpi = effectiveDpi(meta.width, meta.height, inches.w, inches.h);
              if (dpi < (prod.minDpi ?? 150)) { warned++; console.log(`  ⚠ ${id} ${key}: ${dpi}dpi — not listed`); return false; }
              return true;
            })
            .map((v) => {
              const retail = typeof prod.price === 'number'
                ? prod.price
                : prod.price[Object.keys(prod.price).find((k) => normSize(v.size) === normSize(k))];
              const area = r.areas[prod.placement ?? 'default'] ?? r.areas.front ?? Object.values(r.areas)[0];
              const files = [{
                url: artUrl,
                ...(area ? { position: printfulPosition(meta.width, meta.height, area, prod.fit) } : {}),
              }];
              return { variantId: v.variantId, retailPrice: retail, files, size: v.size, color: v.color };
            });
          if (!variants.length) { console.log(`  – ${id}: nothing listable`); continue; }

          const { syncProductId } = await providers.printful.createSyncProduct({
            name: title,
            variants,
          });

          let mockups = [];
          const area = r.areas[prod.placement ?? 'default'] ?? r.areas.front ?? Object.values(r.areas)[0];
          if (area) {
            mockups = await providers.printful.createMockups(prod.catalogId ?? r.catalogId, {
              variantIds: variants.slice(0, 2).map((v) => v.variantId),
              files: [{ placement: prod.placement ?? 'default', image_url: artUrl, position: printfulPosition(meta.width, meta.height, area, prod.fit) }],
            }).catch((e) => { console.log(`  (mockups skipped: ${e.message.split('\n')[0]})`); return []; });
          }

          state.printful[id] = {
            syncProductId,
            variants: variants.map((v) => ({ variantId: v.variantId, size: v.size, color: v.color ?? null, price: v.retailPrice })),
            price: typeof prod.price === 'number' ? prod.price : null,
            prices: typeof prod.price === 'object' ? prod.price : null,
            mockups,
          };
        } else {
          const py = providers.printify;
          const up = await py.uploadImage({ fileName: `${piece.id}.png`, url: artUrl });
          const placement = {
            position: 'front',
            ...printifyPlacement(up.width ?? meta.width, up.height ?? meta.height, r.area, prod.fit),
          };
          const variants = r.variants.map((v) => ({ variantId: v.variantId, retailPrice: prod.price, title: v.title }));
          const { productId, mockups } = await py.createProduct({
            title,
            description: piece.story || `${piece.title}, Day ${piece.day} of the FREETHINKERS 365.`,
            blueprintId: r.blueprintId,
            providerId: r.providerId,
            variants,
            imageId: up.imageId,
            placement,
            tags: piece.tags ?? [],
          });
          await py.publish(productId);
          state.printify[id] = {
            productId,
            blueprintId: r.blueprintId,
            providerId: r.providerId,
            variants: variants.map((v) => ({ variantId: v.variantId, title: v.title, price: v.retailPrice })),
            price: prod.price,
            mockups,
          };
        }

        await saveState(STATE_PATH, state); // after EVERY listing — resumability
        created++;
        console.log(`✔ ${id} → ${prod.provider}`);
      } catch (e) {
        // One bad listing must not kill the batch; state already holds
        // everything created so far and the error names the exact item.
        console.error(`✘ ${id}: ${e.message.split('\n')[0]}`);
      }
    }
  }

  console.log(`\n${created} created · ${skipped} already synced · ${warned} size(s) refused on DPI`);
  console.log(`State: ${STATE_PATH}\nNext:  node sync-products.mjs mappings`);
}

const normSize = (s) => String(s).toLowerCase().replace(/[″"”\s]/g, '').replace('×', 'x');

/* ---------- printfiles ---------- */

/**
 * Build the print-ready files the providers will fetch by URL:
 *   printfiles/<id>.png        — the master, as-is (prints and hoodies)
 *   printfiles/<id>.press.png  — master + the piece's QR beneath it (press line)
 * The QR lands on freethinkers.ai/a/<id>?via=press — same target as
 * scripts/qr-generate.mjs — so every garment scan shows up in the worker's
 * scan-economy counters. Then upload the folder to the bucket behind
 * config.fileBase; the exact commands are printed at the end.
 */
async function printfiles() {
  const { default: QRCode } = await import('qrcode');
  const ORIGIN = process.env.SITE_ORIGIN ?? 'https://freethinkers.ai';
  await mkdir('./printfiles', { recursive: true });

  let built = 0;
  for (const piece of pieces) {
    const masterFile = join(MASTERS, `${piece.id}.png`);
    if (!(await access(masterFile).then(() => true).catch(() => false))) {
      console.log(`– ${piece.id}: no master at ${masterFile}, skipping`);
      continue;
    }
    await copyFile(masterFile, `./printfiles/${piece.id}.png`);

    const meta = await sharp(masterFile).metadata();
    const W = meta.width;
    const qrSize = Math.round(W * 0.18);
    const gap = Math.round(W * 0.05);
    const qrBuf = await QRCode.toBuffer(`${ORIGIN}/a/${piece.id}?via=press`, {
      width: qrSize, margin: 1,
      errorCorrectionLevel: 'H',            // survives fabric distortion + partial cover
      color: { dark: '#0d0d0f', light: '#f6f4ef' },
    });
    await sharp({ create: { width: W, height: meta.height + gap + qrSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([
        { input: await sharp(masterFile).png().toBuffer(), top: 0, left: 0 },
        { input: qrBuf, top: meta.height + gap, left: Math.round((W - qrSize) / 2) },
      ])
      .png()
      .toFile(`./printfiles/${piece.id}.press.png`);
    built++;
    console.log(`✔ ${piece.id} → printfiles/${piece.id}.png + .press.png`);
  }

  console.log(`\n${built} piece(s) built. Upload them so providers can fetch by URL:`);
  console.log('  npx wrangler r2 bucket create ft-printfiles        (once)');
  console.log('  # then per file (PowerShell-safe, one line each):');
  console.log('  Get-ChildItem printfiles | ForEach-Object { npx wrangler r2 object put ("ft-printfiles/" + $_.Name) --file $_.FullName }');
  console.log(`  # and connect the bucket to ${config.fileBase} (R2 → Settings → Public access → Custom domain)`);
}

/* ---------- mappings ---------- */

async function mappings() {
  const maps = toFulfillmentMappings(state, config);
  if (!maps.length) { console.log('State is empty — run sync first.'); return; }
  await writeFile('./fulfillment-mappings.json', JSON.stringify(maps, null, 2));

  const lines = maps.map((m) =>
    `npx wrangler kv key put --namespace-id $PRICING_NS ${JSON.stringify(m.key)} ${JSON.stringify(JSON.stringify(m.value))}`);
  await writeFile('./push-mappings.sh', '#!/bin/sh\nset -e\n' + lines.join('\n') + '\n');
  console.log(`✔ ${maps.length} mapping(s) → fulfillment-mappings.json`);
  console.log('✔ push script → push-mappings.sh  (set PRICING_NS first)');
}

await ({ printfiles, verify, run, mappings })[cmd]();
