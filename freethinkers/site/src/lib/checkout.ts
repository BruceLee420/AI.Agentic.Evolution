/**
 * Checkout abstraction for Freethinkers.AI.
 *
 * Snipcart is the long-term rail (cart + server-validated price ladder +
 * webhook → Printful), but it needs a paid plan and domain verification before
 * it can take a live payment. Gumroad / Stripe Payment Links can take money
 * today. Ship on the fast rail, flip PUBLIC_CHECKOUT_PROVIDER when approved.
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
