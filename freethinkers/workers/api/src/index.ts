/**
 * freethinkers-api — one worker serving both freethinkers.ai and ftwlabs.ai.
 *
 *   GET  /img/:id                  Layer-2 image gate: watermarked previews only
 *   GET  /api/products/:id         Pricing: ladder for masters, FULFILL mapping for print/press
 *   GET  /api/certificate/:id      Public ownership status for QR certificate pages
 *   POST /api/subscribe            Email capture (both sites)
 *   POST /api/reserve              Records a bundle selection before payment
 *   POST /api/checkout             Stripe Checkout Session, server-priced
 *   POST /api/webhooks/stripe      checkout.session.completed → processOrder
 *   POST /api/webhooks/snipcart    order.completed → processOrder
 *   GET  /api/download             HMAC-signed, expiring, use-limited master delivery
 *   GET  /api/scan                 QR scan → attribution cookie for the wearer
 *   GET  /api/ref/:code            What a collector has earned from their garment
 *   cron (every 30 min)            Drains the fulfillment retry queue
 *
 * Both payment rails normalize into one NormalizedOrder and flow through
 * processOrder: masters mint (sold count, entitlement, download email, vault
 * count, ref credit), physical items route to Printful/Printify via the
 * FULFILL: mappings — see fulfillment.ts.
 */

import { Env, cors, json, ladder, soldCount, hmac, isPhysicalItem } from './shared';
import { NormalizedOrder, FulfillMapping, fulfillOrRetry, retrySweep } from './fulfillment';
import { stripeCheckout, parseStripeWebhook } from './stripe';

export type { Env };

/* ---------------- signed download tokens ---------------- */

async function makeToken(env: Env, orderId: string, pieceId: string) {
  const exp = Date.now() + Number(env.DOWNLOAD_TTL_HOURS) * 3600_000;
  const payload = `${orderId}.${pieceId}.${exp}`;
  return `${btoa(payload)}.${await hmac(env.SIGNING_KEY, payload)}`;
}

/* ---------------- handlers ---------------- */

async function serveImage(req: Request, env: Env, id: string): Promise<Response> {
  const referer = req.headers.get('referer') ?? '';
  const site = req.headers.get('sec-fetch-site') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  const ok =
    allowed.some((a) => a && referer.startsWith(a)) ||
    referer.startsWith('http://localhost') ||
    site === 'same-site' || site === 'same-origin';

  if (!ok) {
    return new Response(
      `This artwork lives at ${env.SITE_ORIGIN} — the original master can be yours.`,
      { status: 403, headers: { 'x-robots-tag': 'noindex, noimageindex' } }
    );
  }

  const obj = await env.PUBLIC_ART.get(`previews/${id}.png`);
  if (!obj) return new Response('Not found', { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'private, max-age=300',
      'x-robots-tag': 'noindex, noimageindex',
      ...cors(env, req.headers.get('origin')),
    },
  });
}

async function productInfo(req: Request, env: Env, id: string): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));

  // Syndicated print/press items: price straight from the FULFILL mapping,
  // so the PDP and any cart validation read the same numbers the webhook
  // will fulfill against.
  if (isPhysicalItem(id)) {
    const pieceId = id.replace(/-(print|press)(-\w+)?$/, '');
    const url = `${env.SITE_ORIGIN}/art/${pieceId}`;
    const map = (await env.PRICING.get(`FULFILL:${id}`, 'json')) as FulfillMapping | null;
    if (map) return json([{ id, url, price: map.price, prices: map.prices ?? null }], 200, h);
    if (id.endsWith('-print')) return json([{ id, url, price: Number(env.PRINT_PRICE) }], 200, h);
    if (id.endsWith('-press')) return json([{ id, url, price: Number(env.PRESS_PRICE) }], 200, h);
    return json({ error: 'not synced' }, 404, h);
  }

  const sold = await soldCount(env, id);
  const l = ladder(env, sold);
  return json([{ id, url: `${env.SITE_ORIGIN}/art/${id}`, sold, ...l }], 200, h);
}

async function certificate(req: Request, env: Env, id: string): Promise<Response> {
  const rec = (await env.ENTITLEMENTS.get(`OWNER:${id}`, 'json')) as
    | { ownerDisplay?: string; mintedAt?: string } | null;
  return json(
    rec ? { owned: true, ownerDisplay: rec.ownerDisplay ?? null, mintedAt: rec.mintedAt } : { owned: false },
    200, cors(env, req.headers.get('origin'))
  );
}

/** Email capture. Stored in KV; export with `wrangler kv key list`. */
async function subscribe(req: Request, env: Env): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  const { email, list } = (await req.json().catch(() => ({}))) as any;
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: 'valid email required' }, 400, h);

  await env.ENTITLEMENTS.put(
    `SUB:${(list ?? 'general').replace(/[^\w-]/g, '')}:${email.toLowerCase()}`,
    JSON.stringify({ at: new Date().toISOString(), list: list ?? 'general' })
  );
  return json({ ok: true }, 200, h);
}

/**
 * Records a bundle selection before the buyer leaves for the payment page.
 * Two reasons this exists: link rails can't itemise 10 arbitrary picks, and an
 * abandoned checkout is still a lead worth keeping.
 */
async function reserve(req: Request, env: Env): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  const { email, items, total } = (await req.json().catch(() => ({}))) as any;
  if (!email || !Array.isArray(items) || !items.length)
    return json({ error: 'email and items required' }, 400, h);

  const ref = crypto.randomUUID().slice(0, 8).toUpperCase();
  await env.ENTITLEMENTS.put(
    `RESERVE:${ref}`,
    JSON.stringify({ email, items, total, at: new Date().toISOString(), paid: false }),
    { expirationTtl: 60 * 60 * 24 * 30 }
  );
  console.log(JSON.stringify({ evt: 'reserve', ref, email, count: items.length, total }));
  return json({ ok: true, ref }, 200, h);
}

/* ---------------- the scan economy ----------------
 * Each garment's QR carries the piece id and the owner's short code. A scan is
 * logged and the code is handed back so the site can hold it in a cookie; if
 * that visitor later buys, the sale is attributed to the owner who was wearing
 * the piece. Collectors become an attributed, paid sales force rather than
 * decoration — see docs/05-what-makes-it-unique.md.
 *
 * Attribution windows are deliberately generous (30 days): someone photographs
 * a sweatshirt on Tuesday and buys the following weekend.
 */

const ATTRIBUTION_DAYS = 30;

async function recordScan(req: Request, env: Env): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  const url = new URL(req.url);
  const piece = (url.searchParams.get('piece') ?? '').replace(/[^\w-]/g, '');
  const ref = (url.searchParams.get('ref') ?? '').replace(/[^\w-]/g, '').slice(0, 24);
  if (!piece) return json({ error: 'piece required' }, 400, h);

  const day = new Date().toISOString().slice(0, 10);
  // Counters are per piece and per referrer per day, so you can see which
  // garments are actually being scanned and which owners are working.
  const bump = async (key: string) => {
    const n = Number((await env.PRICING.get(key)) ?? 0) + 1;
    await env.PRICING.put(key, String(n));
    return n;
  };
  const total = await bump(`SCAN:${piece}`);
  if (ref) await bump(`SCAN:REF:${ref}:${day}`);

  console.log(JSON.stringify({ evt: 'scan', piece, ref: ref || null, total }));
  return json({ ok: true, piece, ref: ref || null, attributionDays: ATTRIBUTION_DAYS }, 200, {
    ...h,
    // Cookie is what carries attribution to checkout.
    ...(ref
      ? { 'set-cookie': `ft_ref=${ref}; Max-Age=${ATTRIBUTION_DAYS * 86400}; Path=/; SameSite=Lax; Secure` }
      : {}),
  });
}

/** What an owner has earned. Read by the Vault and the owner's own page. */
async function refStats(req: Request, env: Env): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  const ref = (new URL(req.url).pathname.split('/').pop() ?? '').replace(/[^\w-]/g, '');
  if (!ref) return json({ error: 'ref required' }, 400, h);

  const credited = Number((await env.ENTITLEMENTS.get(`REFSALES:${ref}`)) ?? 0);
  const earned = Number((await env.ENTITLEMENTS.get(`REFEARNED:${ref}`)) ?? 0);
  return json({ ref, sales: credited, earned }, 200, h);
}

/* ---------------- Collector's Vault ---------------- */

const VAULT_TTL_HOURS = 72;

async function makeVaultToken(env: Env, email: string) {
  const exp = Date.now() + VAULT_TTL_HOURS * 3600_000;
  const payload = `${email.toLowerCase()}.${exp}`;
  return `${btoa(payload)}.${await hmac(env.SIGNING_KEY, `vault:${payload}`)}`;
}

async function readVaultToken(env: Env, token: string): Promise<string | null> {
  const [b64, sig] = (token ?? '').split('.');
  if (!b64 || !sig) return null;
  let payload: string;
  try { payload = atob(b64); } catch { return null; }
  if ((await hmac(env.SIGNING_KEY, `vault:${payload}`)) !== sig) return null;
  const [email, exp] = payload.split('.');
  if (Date.now() > Number(exp)) return null;
  return email;
}

/**
 * Emails an access link if the address holds 12+ pieces.
 *
 * Always returns the same neutral response either way — otherwise this endpoint
 * becomes a way to enumerate who your collectors are.
 */
async function vaultRequest(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  const { email } = (await req.json().catch(() => ({}))) as any;
  const neutral = json({ ok: true }, 200, h);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return neutral;

  const count = Number((await env.ENTITLEMENTS.get(`COUNT:${email.toLowerCase()}`)) ?? 0);
  if (count < 12) return neutral;

  const token = await makeVaultToken(env, email);
  const link = `${env.SITE_ORIGIN}/vault?token=${encodeURIComponent(token)}`;
  ctx.waitUntil(
    fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email }] }],
        from: { email: 'vault@freethinkers.ai', name: 'Freethinkers.AI' },
        subject: 'Your Vault access link',
        content: [{
          type: 'text/plain',
          value:
            `You hold ${count} pieces — the Vault is open to you.\n\n${link}\n\n` +
            `This link is personal and expires in ${VAULT_TTL_HOURS} hours. ` +
            `Request another any time at ${env.SITE_ORIGIN}/vault\n\n— FREETHINKERS.AI`,
        }],
      }),
    }).catch((e) => console.log('vault email failed', String(e)))
  );
  console.log(JSON.stringify({ evt: 'vault_request', count }));
  return neutral;
}

/** Vault contents for a valid token. Lists are editable via KV, no redeploy. */
async function vaultContent(req: Request, env: Env): Promise<Response> {
  const h = cors(env, req.headers.get('origin'));
  const email = await readVaultToken(env, new URL(req.url).searchParams.get('token') ?? '');
  if (!email) return json({ error: 'invalid or expired' }, 403, h);

  const count = Number((await env.ENTITLEMENTS.get(`COUNT:${email}`)) ?? 0);
  if (count < 12) return json({ error: 'not entitled' }, 403, h);

  const list = async (key: string) =>
    ((await env.PRICING.get(key, 'json')) as any[] | null) ?? [];

  return json({
    count,
    archive: await list('VAULT:ARCHIVE'),
    process: await list('VAULT:PROCESS'),
    next: await list('VAULT:NEXT'),
  }, 200, h);
}

/* ---------------- order processing (both payment rails land here) ---------------- */

/**
 * The one place a paid order is acted on, whichever rail collected the money.
 * Physical items route to their POD provider; masters mint: sold count up the
 * ladder, ownership + download entitlement, vault count, garment-scan ref
 * credit, free apparel from the configured tier.
 */
async function processOrder(env: Env, ctx: ExecutionContext, order: NormalizedOrder, origin: string): Promise<void> {
  for (const item of order.items) {
    if (isPhysicalItem(item.id)) {
      ctx.waitUntil(fulfillOrRetry(env, order, item));
      continue;
    }

    const pieceId = item.id;
    const before = await soldCount(env, pieceId);
    const sold = before + item.quantity;
    await env.PRICING.put(`SOLD:${pieceId}`, String(sold));
    await env.ENTITLEMENTS.put(
      `OWNER:${pieceId}`,
      JSON.stringify({ email: order.email, orderId: order.orderId, mintedAt: new Date().toISOString().slice(0, 10) })
    );
    await env.ENTITLEMENTS.put(
      `DL:${order.orderId}:${pieceId}`,
      JSON.stringify({ uses: 0, max: Number(env.DOWNLOAD_MAX_USES) }),
      { expirationTtl: Number(env.DOWNLOAD_TTL_HOURS) * 3600 }
    );

    const lifetime = Number((await env.ENTITLEMENTS.get(`COUNT:${order.email}`)) ?? 0) + item.quantity;
    await env.ENTITLEMENTS.put(`COUNT:${order.email}`, String(lifetime));
    if (lifetime >= 12) await env.ENTITLEMENTS.put(`VAULT:${order.email}`, '1');

    // Credit the collector whose garment led here, if any.
    if (order.ref) {
      const ref = order.ref;
      const commission = Math.round(item.price * Number(env.REF_COMMISSION_PCT ?? 10)) / 100;
      await env.ENTITLEMENTS.put(`REFSALES:${ref}`,
        String(Number((await env.ENTITLEMENTS.get(`REFSALES:${ref}`)) ?? 0) + 1));
      await env.ENTITLEMENTS.put(`REFEARNED:${ref}`,
        String(Number((await env.ENTITLEMENTS.get(`REFEARNED:${ref}`)) ?? 0) + commission));
      console.log(JSON.stringify({ evt: 'ref_credit', ref, pieceId, commission }));
    }

    // Free apparel with the buyer's QR from the configured tier up — the
    // garment is the marketing engine, so it ships with the piece.
    if (order.recipient && ladder(env, before).tier >= Number(env.FREE_APPAREL_FROM_TIER)) {
      const apparelId = `${pieceId}-${env.FREE_APPAREL_ITEM ?? 'press-hoodie'}`;
      ctx.waitUntil(fulfillOrRetry(env, order, { id: apparelId, quantity: 1, price: 0 }));
    }

    const dl = await makeToken(env, order.orderId, pieceId);
    ctx.waitUntil(sendDownloadEmail(env, order.email, pieceId, dl, origin));
    console.log(JSON.stringify({ evt: 'mint', pieceId, orderId: order.orderId, sold, lifetime }));
  }
}

async function snipcartWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const token = req.headers.get('x-snipcart-requesttoken');
  if (!token) return json({ error: 'missing token' }, 401);
  const check = await fetch(`https://app.snipcart.com/api/requestvalidation/${token}`, {
    headers: { Authorization: `Basic ${btoa(env.SNIPCART_SECRET + ':')}` },
  });
  if (!check.ok) return json({ error: 'invalid token' }, 401);

  const event = (await req.json()) as any;
  if (event.eventName !== 'order.completed') return json({ ignored: event.eventName });

  const o = event.content;
  const custom = (name: string) =>
    String(o.customFields?.find?.((f: any) => f.name === name)?.value ?? '');
  const itemCustom = (item: any, name: string) =>
    String(item.customFields?.find?.((f: any) => f.name === name)?.value ?? '') || undefined;

  const order: NormalizedOrder = {
    orderId: o.token,
    email: o.email,
    ref: custom('ref').replace(/[^\w-]/g, '') || null,
    recipient: {
      name: o.shippingAddressName ?? o.billingAddressName,
      address1: o.shippingAddressAddress1 ?? o.billingAddressAddress1,
      city: o.shippingAddressCity ?? o.billingAddressCity,
      state_code: o.shippingAddressProvince ?? o.billingAddressProvince,
      country_code: o.shippingAddressCountry ?? o.billingAddressCountry,
      zip: o.shippingAddressPostalCode ?? o.billingAddressPostalCode,
      email: o.email,
    },
    items: (o.items as any[]).map((i) => ({
      id: i.id,
      quantity: i.quantity ?? 1,
      price: Number(i.totalPrice ?? i.price ?? 0),
      size: itemCustom(i, 'size'),
      color: itemCustom(i, 'color'),
    })),
  };

  await processOrder(env, ctx, order, new URL(req.url).origin);
  return json({ ok: true });
}

async function stripeWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { response, order } = await parseStripeWebhook(req, env);
  if (order) await processOrder(env, ctx, order, new URL(req.url).origin);
  return response;
}

async function sendDownloadEmail(env: Env, to: string, pieceId: string, token: string, origin: string) {
  const link = `${origin}/api/download?token=${token}`;
  await fetch('https://api.mailchannels.net/tx/v1/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: 'vault@freethinkers.ai', name: 'Freethinkers.AI' },
      subject: `Your master: ${pieceId}`,
      content: [{
        type: 'text/plain',
        value:
          `You now own ${pieceId}.\n\nDownload your full-resolution master ` +
          `(expires in ${env.DOWNLOAD_TTL_HOURS}h, ${env.DOWNLOAD_MAX_USES} downloads):\n${link}\n\n` +
          `Your certificate: ${env.SITE_ORIGIN}/a/${pieceId}\n\n` +
          `This file is fingerprinted to your order. — FREETHINKERS.AI`,
      }],
    }),
  }).catch((e) => console.log('email failed', String(e)));
}

async function download(req: Request, env: Env): Promise<Response> {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return new Response('Bad token', { status: 400 });

  let payload: string;
  try { payload = atob(b64); } catch { return new Response('Bad token', { status: 400 }); }
  if ((await hmac(env.SIGNING_KEY, payload)) !== sig)
    return new Response('Invalid signature', { status: 403 });

  const [orderId, pieceId, exp] = payload.split('.');
  if (Date.now() > Number(exp))
    return new Response('Link expired — contact vault@freethinkers.ai', { status: 410 });

  const key = `DL:${orderId}:${pieceId}`;
  const state = (await env.ENTITLEMENTS.get(key, 'json')) as { uses: number; max: number } | null;
  if (!state) return new Response('Entitlement not found', { status: 404 });
  if (state.uses >= state.max) return new Response('Download limit reached', { status: 429 });
  await env.ENTITLEMENTS.put(key, JSON.stringify({ ...state, uses: state.uses + 1 }));

  const obj = await env.MASTERS.get(`masters/${pieceId}.png`);
  if (!obj) return new Response('Master not found', { status: 404 });

  console.log(JSON.stringify({ evt: 'download', pieceId, orderId, use: state.uses + 1 }));
  return new Response(obj.body, {
    headers: {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="${pieceId}-master.png"`,
      'cache-control': 'no-store',
      'x-ft-order': orderId,
    },
  });
}

/* ---------------- router ---------------- */

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS')
      return new Response(null, { headers: cors(env, req.headers.get('origin')) });

    let m: RegExpMatchArray | null;
    if ((m = pathname.match(/^\/img\/([\w-]+)$/))) return serveImage(req, env, m[1]);
    if ((m = pathname.match(/^\/api\/products\/([\w-]+)$/))) return productInfo(req, env, m[1]);
    if ((m = pathname.match(/^\/api\/certificate\/([\w-]+)$/))) return certificate(req, env, m[1]);
    if (pathname === '/api/subscribe' && req.method === 'POST') return subscribe(req, env);
    if (pathname === '/api/reserve' && req.method === 'POST') return reserve(req, env);
    if (pathname === '/api/checkout' && req.method === 'POST') return stripeCheckout(req, env);
    if (pathname === '/api/vault/request' && req.method === 'POST') return vaultRequest(req, env, ctx);
    if (pathname === '/api/vault/content') return vaultContent(req, env);
    if (pathname === '/api/scan') return recordScan(req, env);
    if (pathname.startsWith('/api/ref/')) return refStats(req, env);
    if (pathname === '/api/webhooks/snipcart' && req.method === 'POST') return snipcartWebhook(req, env, ctx);
    if (pathname === '/api/webhooks/stripe' && req.method === 'POST') return stripeWebhook(req, env, ctx);
    if (pathname === '/api/download') return download(req, env);

    return json({ service: 'freethinkers-api', ok: true }, 200, cors(env, req.headers.get('origin')));
  },

  /** Cron: retry parked fulfillments so a provider outage never loses an order. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(retrySweep(env));
  },
};
