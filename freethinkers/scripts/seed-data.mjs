#!/usr/bin/env node
/**
 * Seeds the catalog files the sites import, if they don't exist yet.
 *
 * pieces.json and concepts.json are YOUR data — written by ingest.mjs and
 * migrate-concepts.mjs, and deliberately untracked so a `git pull` can never
 * overwrite a run you just did. But the sites import them at build time, so a
 * fresh clone would fail to build with nothing there.
 *
 * This copies the committed .sample.json into place only when the real file is
 * missing. It never overwrites your data.
 *
 *   node seed-data.mjs        (runs automatically before dev/build)
 */
import { access, copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const pairs = [
  ['../site/src/data/pieces.sample.json', '../site/src/data/pieces.json'],
  ['../ftwlabs/src/data/concepts.sample.json', '../ftwlabs/src/data/concepts.json'],
];

for (const [sampleRel, targetRel] of pairs) {
  const sample = new URL(sampleRel, import.meta.url);
  const target = new URL(targetRel, import.meta.url);

  if (await access(target).then(() => true).catch(() => false)) continue;
  if (!(await access(sample).then(() => true).catch(() => false))) continue;

  await mkdir(dirname(fileURLToPath(target)), { recursive: true });
  await copyFile(sample, target);
  console.log(`seeded ${targetRel.replace('../', '')} from sample (placeholder data)`);
}
