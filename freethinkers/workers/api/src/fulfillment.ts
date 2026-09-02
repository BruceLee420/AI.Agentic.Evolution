/**
 * Zero-touch order routing.
 *
 * A paid physical item carries its item id (e.g. FT-2026-034-press-tee). The
 * syndicator (commerce/syndicate) pushed a FULFILL:<itemId> mapping into KV
 * naming the provider and the live variant ids, so routing is a lookup, not a
 * guess: printful items become draft Printful orders against the synced
 * product, printify items become Printify orders against the published one.
 * Legacy PF:<itemId> mappings (pre-syndicator) still work as a fallback.
 *
 * Every failure lands in a RETRY: queue that the cron in index.ts drains with
 * capped attempts — a provider outage delays fulfillment, it never loses an
 * order. After MAX_ATTEMPTS the record moves to FAILED: for a human.
 */

import { Env, normSize } from './shared';

export interface Recipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code: string;
  country_code: string;
  zip: string;
  email: string;
}

export interface OrderItem {
  id: string;
  quantity: number;
  price: number;       // what the buyer actually paid (server-computed)
  size?: string;
  color?: string;
}

export interface NormalizedOrder {
  orderId: string;
  email: string;
  ref: string | null;
  recipient: Recipient | null;
  items: OrderItem[];
}

type PrintfulMapping = {
  provider: 'printful';
  syncProductId: number;
  variants: Array<{ variantId: number; size: string | null; color: string | null; price?: number }>;
  price: number | null;
  prices: Record<string, number> | null;
};
type PrintifyMapping = {
  provider: 'printify';
  productId: string;
  variants: Array<{ variantId: number; title: string; price?: number }>;
  price: number | null;
  prices: Record<string, number> | null;
};
export type FulfillMapping = PrintfulMapping | PrintifyMapping;

const MAX_ATTEMPTS = 6;

async function apiCall(url: string, init: RequestInit, label: string) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${label} ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

/* ---------------- provider order creation ---------------- */

async function printfulOrder(env: Env, order: NormalizedOrder, item: OrderItem, map: PrintfulMapping) {
  const match = map.variants.find((v) =>
    (!item.size || normSize(v.size ?? '') === normSize(item.size)) &&
    (!item.color || (v.color ?? '').toLowerCase().includes(item.color.toLowerCase()))
  );
  if (!match) throw new Error(`no printful variant on ${item.id} for size=${item.size} color=${item.color}`);

  // The sync product's variants carry the exact files + positions the
  // syndicator configured, so order by sync_variant_id — never re-guess files.
  const sp = await apiCall(`https://api.printful.com/store/products/${map.syncProductId}`, {
    headers: { authorization: `Bearer ${env.PRINTFUL_KEY}` },
  }, `printful get product ${map.syncProductId}`);
  const sv = (sp.result?.sync_variants ?? []).find((v: any) => v.variant_id === match.variantId);
  if (!sv) throw new Error(`sync product ${map.syncProductId} has no variant ${match.variantId}`);

  const r = await apiCall('https://api.printful.com/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PRINTFUL_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      external_id: `${order.orderId}-${item.id}`.slice(0, 32),
      recipient: order.recipient,
      items: [{ sync_variant_id: sv.id, quantity: item.quantity }],
      confirm: false, // drafts until you trust the pipe — approve in the dashboard
    }),
  }, `printful order ${item.id}`);
  console.log(JSON.stringify({ evt: 'fulfill', provider: 'printful', item: item.id, providerOrder: r.result?.id }));
}

async function printifyOrder(env: Env, order: NormalizedOrder, item: OrderItem, map: PrintifyMapping) {
  const wantSize = item.size ? normSize(item.size) : null;
  const wantColor = item.color?.toLowerCase() ?? null;
  const match = map.variants.find((v) => {
    const t = v.title.toLowerCase();
    const parts = t.split('/').map((p) => normSize(p));
    return (!wantSize || parts.includes(wantSize)) && (!wantColor || t.includes(wantColor));
  });
  if (!match) throw new Error(`no printify variant on ${item.id} for size=${item.size} color=${item.color}`);

  let shopId = env.PRINTIFY_SHOP_ID;
  if (!shopId) {
    const shops = await apiCall('https://api.printify.com/v1/shops.json', {
      headers: { authorization: `Bearer ${env.PRINTIFY_KEY}` },
    }, 'printify shops');
    shopId = String(shops?.[0]?.id ?? '');
    if (!shopId) throw new Error('printify: no shop on account and PRINTIFY_SHOP_ID unset');
  }

  const rec = order.recipient!;
  const [firstName, ...restName] = (rec.name || 'Art Collector').split(' ');
  const r = await apiCall(`https://api.printify.com/v1/shops/${shopId}/orders.json`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PRINTIFY_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      external_id: `${order.orderId}-${item.id}`.slice(0, 32),
      line_items: [{ product_id: map.productId, variant_id: match.variantId, quantity: item.quantity }],
      shipping_method: 1,
      send_shipping_notification: true,
      address_to: {
        first_name: firstName,
        last_name: restName.join(' ') || '-',
        email: rec.email,
        country: rec.country_code,
        region: rec.state_code,
        address1: rec.address1,
        address2: rec.address2 ?? '',
        city: rec.city,
        zip: rec.zip,
      },
    }),
  }, `printify order ${item.id}`);
  console.log(JSON.stringify({ evt: 'fulfill', provider: 'printify', item: item.id, providerOrder: r.id }));
}

/** Pre-syndicator mappings: PF:<itemId> → { variant_id, print_file_url }. */
async function legacyPrintfulOrder(env: Env, order: NormalizedOrder, item: OrderItem) {
  const map = (await env.PRICING.get(`PF:${item.id}`, 'json')) as
    | { variant_id: number; print_file_url: string } | null;
  if (!map) throw new Error(`no fulfillment mapping for ${item.id} (neither FULFILL: nor PF:)`);
  await apiCall('https://api.printful.com/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.PRINTFUL_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      external_id: `${order.orderId}-${item.id}`.slice(0, 32),
      recipient: order.recipient,
      items: [{ variant_id: map.variant_id, quantity: item.quantity ?? 1, files: [{ url: map.print_file_url }] }],
      confirm: false,
    }),
  }, `printful legacy order ${item.id}`);
  console.log(JSON.stringify({ evt: 'fulfill', provider: 'printful-legacy', item: item.id }));
}

/* ---------------- routing + retry queue ---------------- */

export async function fulfillItem(env: Env, order: NormalizedOrder, item: OrderItem): Promise<void> {
  const map = (await env.PRICING.get(`FULFILL:${item.id}`, 'json')) as FulfillMapping | null;
  if (!map) return legacyPrintfulOrder(env, order, item);
  if (!order.recipient) throw new Error(`physical item ${item.id} but order has no shipping address`);
  if (map.provider === 'printful') return printfulOrder(env, order, item, map);
  return printifyOrder(env, order, item, map);
}

/** Fulfill now; on any failure, park the order in the retry queue instead of losing it. */
export async function fulfillOrRetry(env: Env, order: NormalizedOrder, item: OrderItem): Promise<void> {
  try {
    await fulfillItem(env, order, item);
  } catch (e) {
    const key = `RETRY:${Date.now()}:${crypto.randomUUID().slice(0, 8)}`;
    await env.PRICING.put(key, JSON.stringify({
      order: { orderId: order.orderId, email: order.email, ref: order.ref, recipient: order.recipient, items: [] },
      item,
      attempts: 1,
      lastError: String(e).slice(0, 300),
    }));
    console.log(JSON.stringify({ evt: 'fulfill_queued', item: item.id, error: String(e).slice(0, 200) }));
  }
}

/** Cron sweep: drain the retry queue with capped attempts. */
export async function retrySweep(env: Env): Promise<void> {
  const { keys } = await env.PRICING.list({ prefix: 'RETRY:', limit: 25 });
  for (const k of keys) {
    const rec = (await env.PRICING.get(k.name, 'json')) as
      | { order: NormalizedOrder; item: OrderItem; attempts: number; lastError: string } | null;
    if (!rec) { await env.PRICING.delete(k.name); continue; }

    try {
      await fulfillItem(env, rec.order, rec.item);
      await env.PRICING.delete(k.name);
      console.log(JSON.stringify({ evt: 'retry_fulfilled', item: rec.item.id, attempt: rec.attempts + 1 }));
    } catch (e) {
      const attempts = rec.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        // Dead-letter for a human: `wrangler kv key list --prefix FAILED:`
        await env.PRICING.put(`FAILED:${k.name.slice('RETRY:'.length)}`,
          JSON.stringify({ ...rec, attempts, lastError: String(e).slice(0, 300) }));
        await env.PRICING.delete(k.name);
        console.log(JSON.stringify({ evt: 'retry_dead_letter', item: rec.item.id, attempts }));
      } else {
        await env.PRICING.put(k.name, JSON.stringify({ ...rec, attempts, lastError: String(e).slice(0, 300) }));
        console.log(JSON.stringify({ evt: 'retry_failed', item: rec.item.id, attempts }));
      }
    }
  }
}
