/**
 * Checkout abstraction for Freethinkers.AI.
 *
 * Three rails, one env flip (PUBLIC_CHECKOUT_PROVIDER):
 *   gumroad   outbound payment links — takes money before any approval process
 *   stripe    the worker's /api/checkout builds a server-priced Checkout
 *             Session (regional tax/shipping, webhook → Printful/Printify)
 *   snipcart  on-site cart with server-validated prices + its own webhook
 */

export type Provider = 'gumroad' | 'stripe' | 'snipcart';

export const PROVIDER: Provider =
  (import.meta.env.PUBLIC_CHECKOUT_PROVIDER as Provider) ?? 'gumroad';

export const API_BASE = import.meta.env.PUBLIC_API_BASE ?? 'https://api.freethinkers.ai';

/** True when the rail is an outbound payment link rather than an on-site cart. */
export const isLinkRail = PROVIDER !== 'snipcart';

/** The price ladder — mirrors workers/api/src/index.ts. Keep both in sync. */
export function ladder(sold: number, base = 300, tierSize = 12, pct = 12) {
  const tier = Math.floor(sold / tierSize);
  const rate = 1 + pct / 100;
  return {
    tier: tier + 1,
    price: Math.round(base * rate ** tier * 100) / 100,
    nextPrice: Math.round(base * rate ** (tier + 1) * 100) / 100,
    remainingAtTier: tierSize - (sold % tierSize),
  };
}
