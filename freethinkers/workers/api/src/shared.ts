/**
 * Shared plumbing for the worker: the environment shape, response helpers,
 * the price ladder, and the HMAC used for every signed token.
 */

export interface Env {
  PRICING: KVNamespace;
  ENTITLEMENTS: KVNamespace;
  MASTERS: R2Bucket;
  PUBLIC_ART: R2Bucket;
  SITE_ORIGIN: string;
  ALLOWED_ORIGINS: string;
  BASE_PRICE: string;
  TIER_SIZE: string;
  TIER_INCREASE_PCT: string;
  PRINT_PRICE: string;
  PRESS_PRICE: string;
  FREE_APPAREL_FROM_TIER: string;
  FREE_APPAREL_ITEM: string;
  DOWNLOAD_TTL_HOURS: string;
  DOWNLOAD_MAX_USES: string;
  REF_COMMISSION_PCT: string;
  STRIPE_AUTOMATIC_TAX: string;
  STRIPE_SHIP_COUNTRIES: string;
  PRINTIFY_SHOP_ID: string;
  // Secrets — set with `wrangler secret put`, never in files.
  SIGNING_KEY: string;
  SNIPCART_SECRET: string;
  PRINTFUL_KEY: string;
  PRINTIFY_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
}

export const cors = (env: Env, origin: string | null) => {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.some((a) => origin === a);
  return {
    'access-control-allow-origin': ok ? origin! : allowed[0] ?? '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    // Lets the site send the ft_ref attribution cookie to /api/checkout.
    ...(ok ? { 'access-control-allow-credentials': 'true' } : {}),
  };
};

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/* ---------------- pricing ladder ---------------- */

export function ladder(env: Env, sold: number) {
  const base = Number(env.BASE_PRICE);
  const size = Number(env.TIER_SIZE);
  const rate = 1 + Number(env.TIER_INCREASE_PCT) / 100;
  const tier = Math.floor(sold / size);
  return {
    tier: tier + 1,
    price: Math.round(base * rate ** tier * 100) / 100,
    nextPrice: Math.round(base * rate ** (tier + 1) * 100) / 100,
    remainingAtTier: size - (sold % size),
  };
}

export const soldCount = async (env: Env, id: string) =>
  Number((await env.PRICING.get(`SOLD:${id}`)) ?? 0);

/* ---------------- HMAC (WebCrypto) ---------------- */

export async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "18″ × 24″" and "18x24" agree after this. Mirrors commerce/syndicate/scale.mjs. */
export const normSize = (s: string) =>
  String(s).toLowerCase().replace(/[″"”\s]/g, '').replace(/×/g, 'x');

/** Item ids like FT-2026-034-print-poster / FT-2026-034-press (legacy) are physical. */
export const isPhysicalItem = (id: string) => /-(print|press)(-\w+)?$/.test(id);
