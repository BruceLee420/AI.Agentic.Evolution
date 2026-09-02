/**
 * Printful adapter (API v1, https://api.printful.com).
 *
 * Design rule: no hardcoded variant IDs. The catalog product id (a stable
 * anchor like 71 = Bella+Canvas 3001) comes from config, but sizes and colours
 * are resolved live against the catalog at sync time. Hardcoded variant lists
 * are how POD integrations rot — a provider retires one colour id and every
 * subsequent order 400s.
 *
 * Printful reads artwork by URL, so print files must be publicly reachable
 * (the R2 printfiles bucket). There is no binary upload path here on purpose.
 */

import { makeClient, RateLimiter } from './http.mjs';

const BASE = 'https://api.printful.com';

export function printful({ apiKey, log = console.log }) {
  if (!apiKey) throw new Error('printful: PRINTFUL_KEY missing');
  // Documented ceiling is 120/min; spend at half that so mockup polling and
  // product creation never fight each other for budget.
  const request = makeClient({ limiter: new RateLimiter(60), log });
  const auth = { authorization: `Bearer ${apiKey}` };
  const get = (p) => request('GET', `${BASE}${p}`, { headers: auth });
  const post = (p, json) => request('POST', `${BASE}${p}`, { headers: auth, json });

  const norm = (s) => String(s).toLowerCase().replace(/[″"”\s]/g, '').replace('×', 'x');

  return {
    name: 'printful',

    /** Sanity call for `verify` — proves the key works and names the store. */
    async whoami() {
      const r = await get('/store');
      return { store: r.result?.name ?? '(unnamed store)', id: r.result?.id };
    },

    async catalogProduct(catalogId) {
      const r = await get(`/products/${catalogId}`);
      return r.result; // { product: {id, title, ...}, variants: [...] }
    },

    /**
     * Resolve requested sizes/colours to live variant ids.
     * Returns matches AND misses — the caller decides whether a miss is fatal,
     * but it is never silent.
     */
    async resolveVariants(catalogId, { sizes = [], colors = [] } = {}) {
      const { product, variants } = await this.catalogProduct(catalogId);
      const wantSizes = sizes.map(norm);
      const wantColors = colors.map(norm);

      const matched = [];
      for (const v of variants) {
        const vSize = norm(v.size ?? '');
        const vColor = norm(v.color ?? '');
        const sizeOk = !wantSizes.length || wantSizes.includes(vSize);
        const colorOk = !wantColors.length || wantColors.some((c) => vColor.includes(c));
        if (sizeOk && colorOk) {
          matched.push({ variantId: v.id, size: v.size, color: v.color ?? null });
        }
      }

      const foundSizes = new Set(matched.map((m) => norm(m.size)));
      const missing = wantSizes.filter((s) => !foundSizes.has(s));
      return { productTitle: product.title, matched, missingSizes: missing };
    },

    /** Print-area pixel dimensions per placement, for position math. */
    async printfiles(catalogId) {
      const r = await get(`/mockup-generator/printfiles/${catalogId}`);
      const result = r.result;
      const byId = new Map((result.printfiles ?? []).map((p) => [p.printfile_id, p]));
      const areas = {};
      for (const vp of result.variant_printfiles ?? []) {
        for (const [placement, pfId] of Object.entries(vp.placements ?? {})) {
          const pf = byId.get(pfId);
          if (pf && !areas[placement]) areas[placement] = { width: pf.width, height: pf.height, dpi: pf.dpi };
        }
      }
      return areas; // e.g. { front: {width, height, dpi}, default: {...} }
    },

    /**
     * Create the sellable product. `files` entries carry a public URL and a
     * position block from scale.mjs.
     */
    async createSyncProduct({ name, thumbnailUrl, variants }) {
      const r = await post('/store/products', {
        sync_product: { name, ...(thumbnailUrl ? { thumbnail: thumbnailUrl } : {}) },
        sync_variants: variants.map((v) => ({
          variant_id: v.variantId,
          retail_price: v.retailPrice.toFixed(2),
          files: v.files, // [{ url, type?, position? }]
        })),
      });
      return { syncProductId: r.result?.id, raw: r.result };
    },

    /** Mockups are an async task: create, then poll until done. */
    async createMockups(catalogId, { variantIds, files }) {
      const create = await post(`/mockup-generator/create-task/${catalogId}`, {
        variant_ids: variantIds,
        format: 'jpg',
        files, // [{ placement, image_url, position }]
      });
      const key = create.result?.task_key;
      if (!key) throw new Error('printful: mockup task did not return a task_key');

      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        const st = await get(`/mockup-generator/task?task_key=${encodeURIComponent(key)}`);
        const s = st.result?.status;
        if (s === 'completed') {
          return (st.result.mockups ?? []).map((m) => ({
            placement: m.placement,
            url: m.mockup_url,
            variantIds: m.variant_ids,
          }));
        }
        if (s === 'failed') throw new Error(`printful mockup task failed: ${st.result?.error ?? 'unknown'}`);
      }
      throw new Error('printful: mockup task timed out after 60s of polling');
    },

    /** Draft order (confirm=false) — a human approves in the dashboard until trust is earned. */
    async createOrder({ externalId, recipient, items, confirm = false }) {
      const r = await post('/orders', {
        external_id: externalId,
        recipient,
        items: items.map((i) => ({
          sync_variant_id: i.syncVariantId ?? undefined,
          variant_id: i.syncVariantId ? undefined : i.variantId,
          quantity: i.quantity ?? 1,
          ...(i.files ? { files: i.files } : {}),
        })),
        confirm,
      });
      return { orderId: r.result?.id, status: r.result?.status };
    },
  };
}
