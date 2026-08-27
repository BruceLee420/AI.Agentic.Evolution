#!/usr/bin/env node
/**
 * Generates demo catalog data so both sites render and deploy BEFORE the real
 * art is uploaded. Replace with real output from migrate-concepts.mjs /
 * prepare-art.mjs when the pipeline runs.
 *
 *   node make-demo-data.mjs [conceptCount]
 */
import { writeFile, mkdir } from 'node:fs/promises';

const N = Number(process.argv[2] ?? 144);
const TAGS = ['abstract', 'portrait', 'landscape', 'glitch', 'type', 'study', 'monochrome', 'neon', 'organic', 'geometry'];
const TITLES = ['Study', 'Fragment', 'Iteration', 'Signal', 'Residue', 'Draft', 'Variant', 'Echo', 'Trace', 'Field'];

const concepts = Array.from({ length: N }, (_, i) => {
  const n = i + 1;
  return {
    id: `FTW-${String(n).padStart(4, '0')}`,
    title: `${TITLES[n % TITLES.length]} ${String(n).padStart(3, '0')}`,
    tags: [TAGS[n % TAGS.length], TAGS[(n * 7 + 3) % TAGS.length]].filter((t, j, a) => a.indexOf(t) === j),
    date: new Date(2026, 0, 1 + (n % 240)).toISOString().slice(0, 10),
  };
});

// Freethinkers: one finished piece per day of the year so far.
const DAYS = Number(process.argv[3] ?? 36);
const pieces = Array.from({ length: DAYS }, (_, i) => {
  const d = new Date(2026, 0, 1 + i);
  return {
    id: `FT-2026-${String(i + 1).padStart(3, '0')}`,
    title: `${TITLES[i % TITLES.length]} No. ${i + 1}`,
    story: 'Replace with the real story — collectors buy the narrative as much as the pixels.',
    date: d.toISOString().slice(0, 10),
    day: i + 1,
    ratio: i % 3 === 0 ? '4 / 5' : '1 / 1',
    editionSize: 120,
    tags: [TAGS[i % TAGS.length]],
  };
});

await mkdir(new URL('../ftwlabs/src/data/', import.meta.url), { recursive: true });
await mkdir(new URL('../site/src/data/', import.meta.url), { recursive: true });
await writeFile(new URL('../ftwlabs/src/data/concepts.json', import.meta.url), JSON.stringify(concepts, null, 2));
await writeFile(new URL('../site/src/data/pieces.json', import.meta.url), JSON.stringify(pieces, null, 2));

console.log(`✔ ${concepts.length} demo concepts → ftwlabs/src/data/concepts.json`);
console.log(`✔ ${pieces.length} demo pieces   → site/src/data/pieces.json`);
console.log('\nReplace both with real pipeline output before launch.');
