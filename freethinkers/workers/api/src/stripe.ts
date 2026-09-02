/**
 * Stripe rail — serverless checkout + signature-verified webhook.
 *
 * /api/checkout builds a Checkout Session with SERVER-computed prices: mint
 * prices come from the ladder, physical prices from the FULFILL: mappings the
 * syndicator pushed. The client only ever says WHAT it wants, never what it
 * costs. The priced cart is parked in KV (STRIPEORD:) and its key rides in
 * session metadata — Stripe caps metadata values at 500 chars, so the cart
 * itself never has to fit in one.
 *
 * /api/webhooks/stripe verifies the Stripe-Signature header by hand (HMAC
 * SHA-256 of `${t}.${rawBody}` against STRIPE_WEBHOOK_SECRET — no SDK in a
 * worker), then hands back a NormalizedOrder for the same processOrder path
 * the Snipcart webhook uses. One fulfillment brain, two payment rails.
 *
 * Regional tax: set STRIPE_AUTOMATIC_TAX=1 after activating Stripe Tax in the
 * dashboard — the session then computes tax per buyer location. Shipping
 * addresses are collected whenever the cart holds a physical item, limited to
 * STRIPE_SHIP_COUNTRIES.
 */

import { Env, json, cors, ladder, soldCount, normSize, isPhysicalItem, hmac } from './shared';
import type { NormalizedOrder, OrderItem, FulfillMapping } from './fulfillment';

const CART_TTL_DAYS = 7;

/** Flatten nested params into Stripe's form encoding (a[b][0][c]=x). */
function formEncode(value: unknown, prefix: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>))
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
  } else if (value !== undefined && value !== null) {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
}

async function priceItem(env: Env, it: { id: string; size?: string; color?: string }): Promise<number> {
  if (!isPhysicalItem(it.id)) {
    return ladder(env, await soldCount(env, it.id)).price; // mint: the ladder decides
  }
  const map = (await env.PRICING.get(`FULFILL:${it.id}`, 'json')) as FulfillMapping | null;
  if (map) {
    const bySize = it.size && map.prices ? map.prices[Object.keys(map.prices).find((k) => normSize(k) === normSize(it.size!)) ?? ''] : undefined;
    const p = bySize ?? map.price ?? undefined;
    if (p !== undefined && p !== null) return p;
  }
  // Legacy flat-priced -print / -press items from before the syndicator.
  if (/-print$/.test(it.id)) return Number(env.PRINT_PRICE);
  if (/-press$/.test(it.id)) return Number(env.PRESS_PRICE);
  throw new Error(`no price known for ${it.id} — has it been synced?`);
}

export async function stripeCheckout(req: Request, env: Env): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe not configured' }, 501, h);

  const body = (await req.json().catch(() => ({}))) as {
    items?: Array<{ id: string; quantity?: number; size?: string; color?: string }>;
    email?: string;
    ref?: string;
  };
  if (!Array.isArray(body.items) || !body.items.length)
    return json({ error: 'items required' }, 400, h);
  if (body.items.length > 25) return json({ error: 'too many items' }, 400, h);

  let priced: OrderItem[];
  try {
    priced = await Promise.all(body.items.map(async (it) => ({
      id: String(it.id).replace(/[^\w-]/g, ''),
      quantity: Math.min(Math.max(1, Number(it.quantity ?? 1) | 0), 10),
      price: await priceItem(env, it),
      ...(it.size ? { size: String(it.size).slice(0, 20) } : {}),
      ...(it.color ? { color: String(it.color).slice(0, 20) } : {}),
    })));
  } catch (e) {
    return json({ error: String((e as Error).message) }, 400, h);
  }

  const physical = priced.some((it) => isPhysicalItem(it.id));
  const cartKey = crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  const ref = String(body.ref ?? '').replace(/[^\w-]/g, '').slice(0, 24);
  await env.ENTITLEMENTS.put(`STRIPEORD:${cartKey}`, JSON.stringify({ items: priced, ref: ref || null }),
    { expirationTtl: CART_TTL_DAYS * 86400 });

  const params: Record<string, unknown> = {
    mode: 'payment',
    success_url: `${env.SITE_ORIGIN}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_ORIGIN}/`,
    ...(body.email ? { customer_email: body.email } : {}),
    metadata: { cart: cartKey, ...(ref ? { ref } : {}) },
    line_items: priced.map((it) => ({
      quantity: it.quantity,
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(it.price * 100),
        product_data: {
          name: [it.id, it.size, it.color].filter(Boolean).join(' · '),
        },
      },
    })),
    ...(env.STRIPE_AUTOMATIC_TAX === '1' ? { automatic_tax: { enabled: true } } : {}),
    ...(physical ? {
      shipping_address_collection: {
        allowed_countries: (env.STRIPE_SHIP_COUNTRIES ?? 'US').split(',').map((s) => s.trim()).filter(Boolean),
      },
    } : {}),
  };

  const out: string[] = [];
  formEncode(params, '', out);
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: out.join('&'),
  });
  const session = (await res.json()) as any;
  if (!res.ok) {
    console.log(JSON.stringify({ evt: 'stripe_checkout_error', error: session?.error?.message }));
    return json({ error: session?.error?.message ?? 'stripe error' }, 502, h);
  }
  console.log(JSON.stringify({ evt: 'stripe_checkout', cart: cartKey, items: priced.length, physical }));
  return json({ url: session.url, id: session.id }, 200, h);
}

/* ---------------- webhook ---------------- */

async function verifySignature(env: Env, rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  let t = '';
  const v1s: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s?.trim());
    if (k === 't') t = v ?? '';
    if (k === 'v1' && v) v1s.push(v);
  }
  if (!t || !v1s.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false; // 5-minute tolerance
  const expected = await hmac(env.STRIPE_WEBHOOK_SECRET, `${t}.${rawBody}`);
  return v1s.some((v) => v === expected);
}

/**
 * Verify + normalize. Returns the order to process (or null when the event is
 * valid but not one we act on) plus the response to send Stripe either way.
 */
export async function parseStripeWebhook(req: Request, env: Env): Promise<{
  response: Response;
  order: NormalizedOrder | null;
}> {
  const rawBody = await req.text();
  if (!env.STRIPE_WEBHOOK_SECRET ||
      !(await verifySignature(env, rawBody, req.headers.get('stripe-signature')))) {
    return { response: json({ error: 'bad signature' }, 401), order: null };
  }

  const event = JSON.parse(rawBody) as any;
  const actionable =
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded';
  if (!actionable) return { response: json({ ignored: event.type }), order: null };

  const session = event.data.object;
  if (session.payment_status !== 'paid')
    return { response: json({ deferred: session.payment_status }), order: null };

  const cartKey = session.metadata?.cart;
  const cart = cartKey
    ? ((await env.ENTITLEMENTS.get(`STRIPEORD:${cartKey}`, 'json')) as { items: OrderItem[]; ref: string | null } | null)
    : null;
  if (!cart) {
    console.log(JSON.stringify({ evt: 'stripe_webhook_no_cart', session: session.id }));
    return { response: json({ error: 'unknown cart' }, 200), order: null }; // 200: don't make Stripe hammer us
  }
  // One-shot: a replayed event must not double-fulfill.
  await env.ENTITLEMENTS.delete(`STRIPEORD:${cartKey}`);

  const ship = session.shipping_details ?? session.collected_information?.shipping_details ?? null;
  const addr = ship?.address ?? null;
  const email = session.customer_details?.email ?? session.customer_email ?? '';

  return {
    response: json({ ok: true }),
    order: {
      orderId: String(session.id).slice(-24),
      email,
      ref: cart.ref ?? session.metadata?.ref ?? null,
      recipient: addr ? {
        name: ship?.name ?? session.customer_details?.name ?? 'Art Collector',
        address1: addr.line1 ?? '',
        address2: addr.line2 ?? undefined,
        city: addr.city ?? '',
        state_code: addr.state ?? '',
        country_code: addr.country ?? '',
        zip: addr.postal_code ?? '',
        email,
      } : null,
      items: cart.items,
    },
  };
}
