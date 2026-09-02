/**
 * Sync state — what makes a 180-piece run survivable.
 *
 * Every created listing is recorded the moment it exists, so a crash at piece
 * 141 resumes at 141 instead of duplicating 140 listings. The same file is the
 * source for fulfillment mappings pushed to the worker's KV.
 *
 * Shape:
 * {
 *   "printful": { "<itemId>": { syncProductId, variants:[{variantId,size,color}], mockups:[...] } },
 *   "printify": { "<itemId>": { productId, blueprintId, providerId, variants:[...], mockups:[...] } },
 *   "resolved": { cache of name→id resolutions so reruns skip catalog calls }
 * }
 */

import { readFile, writeFile } from 'node:fs/promises';

export async function loadState(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch { return { printful: {}, printify: {}, resolved: {} }; }
}

export async function saveState(path, state) {
  await writeFile(path, JSON.stringify(state, null, 2));
}

/** Flatten state into the records the worker needs, one per sellable item. */
export function toFulfillmentMappings(state, config) {
  const out = [];
  for (const [provider, entries] of [['printful', state.printful], ['printify', state.printify]]) {
    for (const [itemId, rec] of Object.entries(entries ?? {})) {
      out.push({
        key: `FULFILL:${itemId}`,
        value: {
          provider,
          ...(provider === 'printful'
            ? { syncProductId: rec.syncProductId, variants: rec.variants }
            : { productId: rec.productId, variants: rec.variants }),
          price: rec.price,
          prices: rec.prices ?? null,
        },
      });
    }
  }
  return out;
}
