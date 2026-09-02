/**
 * Printify adapter (API v1, https://api.printify.com/v1).
 *
 * Printify's catalog is a marketplace: a blueprint (the garment) is printed by
 * one of several print providers, and variant ids are provider-specific. So
 * nothing is hardcoded — the blueprint is found by name search, the provider is
 * chosen from who actually offers it, and variants resolve by their
 * "Color / Size" titles at sync time. The `verify` command prints every choice
 * before anything is created, because a silent wrong-blueprint sync would list
 * your art on the wrong garment forty times.
 *
 * Unlike Printful, Printify ingests the artwork (via URL) into its media
 * library first and products reference the upload id.
 */

import { makeClient, RateLimiter } from './http.mjs';

const BASE = 'https://api.printify.com/v1';

export function printify({ apiKey, shopId = null, log = console.log }) {
  if (!apiKey) throw new Error('printify: PRINTIFY_KEY missing');
  // Global cap is 600/min; product publishing has a much lower unofficial
  // comfort zone. 90/min keeps a 180-piece run well inside both.
  const request = makeClient({ limiter: new RateLimiter(90), log });
  const auth = { authorization: `Bearer ${apiKey}` };
  const get = (p) => request('GET', `${BASE}${p}`, { headers: auth });
  const post = (p, json) => request('POST', `${BASE}${p}`, { headers: auth, json });

  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
  let cachedShopId = shopId;

  return {
    name: 'printify',

    async whoami() {
      const shops = await get('/shops.json');
      if (!Array.isArray(shops) || !shops.length) throw new Error('printify: key valid but no shops on the account');
      if (!cachedShopId) cachedShopId = shops[0].id;
      const active = shops.find((s) => s.id === cachedShopId) ?? shops[0];
      return { store: active.title, id: active.id, channel: active.sales_channel };
    },

    async shop() {
      if (!cachedShopId) await this.whoami();
      return cachedShopId;
    },

    /** Blueprint by title search — "Bella+Canvas 3001" style. Exact-ish first. */
    async findBlueprint(search) {
      const all = await get('/catalog/blueprints.json');
      const q = norm(search);
      const scored = all
        .map((b) => ({ b, t: norm(`${b.title} ${b.brand ?? ''} ${b.model ?? ''}`) }))
        .filter((x) => q.split(' ').every((w) => x.t.includes(w)));
      if (!scored.length) throw new Error(`printify: no blueprint matches "${search}"`);
      // Shortest matching title is almost always the canonical product rather
      // than a themed variant of it.
      scored.sort((a, z) => a.t.length - z.t.length);
      const b = scored[0].b;
      return { blueprintId: b.id, title: b.title, brand: b.brand };
    },

    /** A provider that can actually print this blueprint. */
    async findProvider(blueprintId, preferId = null) {
      const providers = await get(`/catalog/blueprints/${blueprintId}/print_providers.json`);
      if (!providers.length) throw new Error(`printify: blueprint ${blueprintId} has no print providers`);
      const chosen = preferId ? providers.find((p) => p.id === preferId) ?? providers[0] : providers[0];
      return { providerId: chosen.id, title: chosen.title };
    },

    /** Resolve "Black / M"-style variant titles into ids, reporting misses.
     *  Sizes match by EXACT normalized token ("s" must not match "xs"), with
     *  dimension marks stripped so "18″ × 24″" matches a configured "18x24". */
    async resolveVariants(blueprintId, providerId, { sizes = [], colors = [] } = {}) {
      const r = await get(`/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`);
      const variants = r.variants ?? [];
      const normSize = (s) => norm(s).replace(/[″"”\s]/g, '').replace(/×/g, 'x');
      const wantSizes = sizes.map(normSize);
      const wantColors = colors.map(norm);

      const matched = [];
      for (const v of variants) {
        const t = norm(v.title); // e.g. "black / m" or "18″ × 24″ / matte"
        const parts = t.split('/').map(normSize);
        const sizeOk = !wantSizes.length || parts.some((p) => wantSizes.includes(p));
        const colorOk = !wantColors.length || wantColors.some((c) => t.includes(c));
        if (sizeOk && colorOk) matched.push({ variantId: v.id, title: v.title });
      }
      const missing = wantSizes.filter((s) =>
        !matched.some((m) => norm(m.title).split('/').map(normSize).includes(s)));
      return { matched, missingSizes: missing, totalAvailable: variants.length };
    },

    /** Print-area pixel dimensions for a variant set (for scale math). */
    async printArea(blueprintId, providerId, variantIds) {
      const r = await get(`/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json?show-out-of-stock=1`);
      for (const v of r.variants ?? []) {
        if (!variantIds.includes(v.id)) continue;
        const ph = (v.placeholders ?? []).find((p) => p.position === 'front') ?? (v.placeholders ?? [])[0];
        if (ph) return { position: ph.position, width: ph.width, height: ph.height };
      }
      throw new Error('printify: no placeholder dimensions found for chosen variants');
    },

    /** Art goes into Printify's media library first; products reference the id. */
    async uploadImage({ fileName, url }) {
      const r = await post('/uploads/images.json', { file_name: fileName, url });
      return { imageId: r.id, width: r.width, height: r.height };
    },

    async createProduct({ title, description, blueprintId, providerId, variants, imageId, placement, tags = [] }) {
      const shop = await this.shop();
      const r = await post(`/shops/${shop}/products.json`, {
        title,
        description,
        blueprint_id: blueprintId,
        print_provider_id: providerId,
        tags,
        variants: variants.map((v) => ({
          id: v.variantId,
          price: Math.round(v.retailPrice * 100), // cents
          is_enabled: true,
        })),
        print_areas: [{
          variant_ids: variants.map((v) => v.variantId),
          placeholders: [{
            position: placement.position ?? 'front',
            images: [{ id: imageId, x: placement.x, y: placement.y, scale: placement.scale, angle: placement.angle ?? 0 }],
          }],
        }],
      });
      // Printify generates mockup imagery on creation — capture it.
      const mockups = (r.images ?? []).map((m) => ({ url: m.src, variantIds: m.variant_ids, default: !!m.is_default }));
      return { productId: r.id, mockups };
    },

    /** For API-only shops publishing is a bookkeeping call; harmless if skipped. */
    async publish(productId) {
      const shop = await this.shop();
      const flags = { title: true, description: true, images: true, variants: true, tags: true };
      await post(`/shops/${shop}/products/${productId}/publish.json`, flags).catch((e) => {
        log(`  (publish skipped: ${e.message.split('\n')[0]})`);
      });
    },

    async createOrder({ externalId, addressTo, lineItems }) {
      const shop = await this.shop();
      const r = await post(`/shops/${shop}/orders.json`, {
        external_id: externalId,
        line_items: lineItems.map((li) => ({
          product_id: li.productId,
          variant_id: li.variantId,
          quantity: li.quantity ?? 1,
        })),
        shipping_method: 1, // standard
        send_shipping_notification: true,
        address_to: addressTo,
      });
      return { orderId: r.id, status: r.status };
    },
  };
}
