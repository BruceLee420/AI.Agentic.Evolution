/**
 * Checkout abstraction — lets you swap payment rails without touching the UI.
 *
 * Why this exists: Snipcart is the right long-term rail (cart, server-validated
 * pricing, webhook → Printful), but it needs a paid plan + domain verification
 * before it can take a live payment. Gumroad and Stripe Payment Links can take
 * money within the hour. So the site ships provider-agnostic: launch on the
 * fast rail tonight, flip one env var to Snipcart when it's approved.
 *
 * Set PUBLIC_CHECKOUT_PROVIDER = gumroad | stripe | snipcart
 */

export type Provider = 'gumroad' | 'stripe' | 'snipcart';

export const PROVIDER: Provider =
  (import.meta.env.PUBLIC_CHECKOUT_PROVIDER as Provider) ?? 'gumroad';

export const API_BASE = import.meta.env.PUBLIC_API_BASE ?? 'https://api.ftwlabs.ai';

export interface BuyTarget {
  id: string;
  name: string;
  price: number;
  /** Direct payment URL for gumroad/stripe rails (per-product link). */
  payUrl?: string;
  /** Worker endpoint Snipcart re-validates price against. */
  productUrl?: string;
  image?: string;
}

/**
 * Returns the attributes a buy button needs for the active provider.
 * Snipcart reads data-item-* attributes; the link rails just need an href.
 */
export function buyAttrs(t: BuyTarget): Record<string, string> {
  if (PROVIDER === 'snipcart') {
    return {
      class: 'snipcart-add-item',
      'data-item-id': t.id,
      'data-item-name': t.name,
      'data-item-price': t.price.toFixed(2),
      'data-item-url': t.productUrl ?? `${API_BASE}/api/products/${t.id}`,
      ...(t.image ? { 'data-item-image': t.image } : {}),
    };
  }
  // gumroad / stripe: an outbound payment link
  return {
    'data-pay-url': t.payUrl ?? '',
    'data-item-id': t.id,
  };
}

/** True when the rail uses an outbound link rather than an on-site cart. */
export const isLinkRail = PROVIDER !== 'snipcart';
