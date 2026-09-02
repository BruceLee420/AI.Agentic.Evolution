#!/usr/bin/env node
/**
 * End-to-end proof of the syndication pipeline against the mock providers.
 * No keys, no accounts, nothing real is created — but every layer runs:
 * fixture masters → printfiles (QR composites) → verify → run → rerun
 * (idempotency) → mappings, with an injected 429 and 500 along the way so a
 * green result proves the retry layer too.
 *
 *   cd commerce && npm test        (≈1 minute; rate limiters run at real speed)
 */

import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { startMock } from './mock-provider-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SYNC = join(HERE, 'sync-products.mjs');

/* ---------- fixtures ---------- */

const work = await mkdtemp(join(tmpdir(), 'ftw-syndicate-'));
console.log(`work dir: ${work}`);

// 3600×3600: passes 12x16 (225dpi) and 18x24 (150dpi), FAILS 24x36 (100dpi).
// 5400×7200: passes every configured size. Together they prove the DPI gate
// refuses exactly the soft size and nothing else.
await sharp({ create: { width: 3600, height: 3600, channels: 3, background: { r: 24, g: 26, b: 32 } } })
  .png().toFile(join(work, 'FT-TEST-001.png'));
await sharp({ create: { width: 5400, height: 7200, channels: 3, background: { r: 240, g: 236, b: 228 } } })
  .png().toFile(join(work, 'FT-TEST-002.png'));

const catalog = join(work, 'pieces.json');
await writeFile(catalog, JSON.stringify([
  { id: 'FT-TEST-001', title: 'Test Piece One', day: 1, kind: 'daily', story: 'Fixture.', tags: ['test'] },
  { id: 'FT-TEST-002', title: 'Test Piece Two', day: 2, kind: 'daily', story: 'Fixture.', tags: ['test'] },
  { id: 'FT-TEST-COMIC', title: 'Not Daily', day: 3, kind: 'comic' }, // must be filtered out
]));

const mock = await startMock();
console.log(`mock providers on :${mock.port}`);

const statePath = join(work, 'synced-products.json');
const env = {
  ...process.env,
  PRINTFUL_KEY: 'test-key',
  PRINTIFY_KEY: 'test-key',
  PRINTFUL_BASE: `http://127.0.0.1:${mock.port}`,
  PRINTIFY_BASE: `http://127.0.0.1:${mock.port}`,
  PRINTFILE_BASE: `http://127.0.0.1:${mock.port}/files`,
};

// Async spawn, NOT spawnSync: the mock lives in THIS process, and a blocked
// parent event loop would leave the child's requests hanging forever.
function sync(...args) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [SYNC, ...args, '--catalog', catalog, '--masters', work, '--state', statePath],
      { cwd: work, env });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => c.kill('SIGKILL'), 240_000);
    c.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { console.error(out); reject(new Error(`sync-products ${args[0]} exited ${code}`)); }
      else resolve(out);
    });
  });
}

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ✔ ${name}`); }
  catch (e) { failures++; console.error(`  ✘ ${name}: ${e.message}`); }
};

/* ---------- printfiles: QR press composites ---------- */

console.log('\n== printfiles ==');
const pfOut = await sync('printfiles');
check('both pieces built', () => assert.match(pfOut, /2 piece\(s\) built/));
check('press composite exists', () =>
  assert.ok(existsSync(join(work, 'printfiles', 'FT-TEST-001.press.png'))));
{
  const meta = await sharp(join(work, 'printfiles', 'FT-TEST-001.press.png')).metadata();
  check('composite keeps art width', () => assert.equal(meta.width, 3600));
  check('composite adds QR strip below', () => assert.ok(meta.height > 3600, `height ${meta.height}`));
}

/* ---------- verify: resolution only, nothing created ---------- */

console.log('\n== verify ==');
const vOut = await sync('verify');
check('printful connected', () => assert.match(vOut, /printful: connected to "Mock Printful Store"/));
check('printify connected', () => assert.match(vOut, /printify: connected to "Mock Printify Shop"/));
check('poster resolved by name', () => assert.match(vOut, /print\/poster → printful: catalog 1 "Enhanced Matte Paper Poster"/));
check('tee resolved to canonical blueprint (shortest title wins)', () =>
  assert.match(vOut, /blueprint 6 "Unisex Jersey Short Sleeve Tee" via Monster Digital/));
check('DPI gate flags the soft size in verify', () => assert.match(vOut, /FT-TEST-001 @ 24x36: 100dpi — below minimum/));
check('verify created nothing', () => assert.equal(mock.hits.pfProducts.length + mock.hits.pyProducts.length, 0));

/* ---------- run: create everything ---------- */

console.log('\n== run ==');
const rOut = await sync('run');
const state = JSON.parse(await readFile(statePath, 'utf8'));

check('6 printful + 2 printify listings created', () => assert.match(rOut, /8 created · 0 already synced · 1 size\(s\) refused on DPI/));
check('printful got exactly 6 product creations', () => assert.equal(mock.hits.pfProducts.length, 6));
check('printify got exactly 2 product creations', () => assert.equal(mock.hits.pyProducts.length, 2));
check('429 was injected and survived', () => assert.equal(mock.hits.pf429, 1));
check('500 was injected and survived', () => assert.equal(mock.hits.py500, 1));

check('soft 24x36 excluded from piece 1 poster', () => {
  const v = state.printful['FT-TEST-001-print-poster'].variants;
  assert.deepEqual(v.map((x) => x.size).sort(), ['12″×16″', '18″×24″']);
});
check('piece 2 poster lists all three sizes', () =>
  assert.equal(state.printful['FT-TEST-002-print-poster'].variants.length, 3));
check('hoodie lists Black only (White filtered out)', () => {
  const v = state.printful['FT-TEST-001-press-hoodie'].variants;
  assert.equal(v.length, 5);
  assert.ok(v.every((x) => x.color === 'Black'));
});
check('tee matched 10 variants, XS never falsely matched S', () => {
  const v = state.printify['FT-TEST-001-press-tee'].variants;
  assert.equal(v.length, 10);
  assert.ok(v.every((x) => !/\bXS\b/.test(x.title)));
});
check('printful position block is scaled + centered (3600² art in 3600×4800 area)', () => {
  const files = mock.hits.pfProducts.find((p) => p.sync_product.name.includes('Test Piece One — Matte Print'))
    .sync_variants[0].files;
  assert.deepEqual(files[0].position, { area_width: 3600, area_height: 4800, width: 3600, height: 3600, left: 0, top: 600 });
});
check('printify prices are in cents', () => {
  assert.ok(mock.hits.pyProducts[0].variants.every((v) => v.price === 4500));
});
check('printify placement is centered relative with sane scale', () => {
  const img = mock.hits.pyProducts[0].print_areas[0].placeholders[0].images[0];
  assert.equal(img.x, 0.5);
  assert.equal(img.y, 0.5);
  assert.ok(img.scale > 0 && img.scale <= 1, `scale ${img.scale}`);
});
check('press listings point at the QR composite file', () => {
  const hoodieFiles = mock.hits.pfProducts.find((p) => p.sync_product.name.includes('Hoodie')).sync_variants[0].files;
  assert.match(hoodieFiles[0].url, /FT-TEST-001\.press\.png$/);
});
check('mockup tasks ran', () => assert.ok(mock.hits.pfMockupTasks >= 1));
check('non-daily piece was never synced', () =>
  assert.ok(!Object.keys(state.printful).some((k) => k.includes('COMIC'))));

/* ---------- rerun: idempotency ---------- */

console.log('\n== rerun (idempotency) ==');
const r2 = await sync('run');
check('rerun creates nothing, skips all 8', () => assert.match(r2, /0 created · 8 already synced/));
check('no extra provider calls on rerun', () =>
  assert.equal(mock.hits.pfProducts.length + mock.hits.pyProducts.length, 8));

/* ---------- mappings ---------- */

console.log('\n== mappings ==');
const mOut = await sync('mappings');
check('8 mappings emitted', () => assert.match(mOut, /8 mapping\(s\)/));
{
  const maps = JSON.parse(await readFile(join(work, 'fulfillment-mappings.json'), 'utf8'));
  check('mapping keys carry the FULFILL: prefix', () =>
    assert.ok(maps.every((m) => m.key.startsWith('FULFILL:FT-TEST-'))));
  check('printful mapping routes with syncProductId', () => {
    const m = maps.find((x) => x.key === 'FULFILL:FT-TEST-001-print-poster');
    assert.equal(m.value.provider, 'printful');
    assert.ok(m.value.syncProductId);
    assert.equal(m.value.prices['18x24'], 80);
  });
  check('printify mapping routes with productId', () => {
    const m = maps.find((x) => x.key === 'FULFILL:FT-TEST-001-press-tee');
    assert.equal(m.value.provider, 'printify');
    assert.ok(m.value.productId);
    assert.equal(m.value.price, 45);
  });
}

await mock.close();
console.log(failures ? `\n✘ ${failures} CHECK(S) FAILED` : '\n✔ ALL E2E CHECKS PASS');
process.exit(failures ? 1 : 0);
