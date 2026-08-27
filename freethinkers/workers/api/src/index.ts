/**
 * freethinkers-api — one worker serving both freethinkers.ai and ftwlabs.ai.
 *
 *   GET  /img/:id                  Layer-2 image gate: watermarked previews only
 *   GET  /api/products/:id         Price ladder (the value Snipcart validates against)
 *   GET  /api/certificate/:id      Public ownership status for QR certificate pages
 *   POST /api/subscribe            Email capture (both sites)
 *   POST /api/reserve              Records a bundle selection before payment
 *   POST /api/webhooks/snipcart    order.completed → sold count, entitlement,
 *                                   download email, Printful order
 *   GET  /api/download             HMAC-signed, expiring, use-limited master delivery
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
  DOWNLOAD_TTL_HOURS: string;
  DOWNLOAD_MAX_USES: string;
  SIGNING_KEY: string;
  SNIPCART_SECRET: string;
  PRINTFUL_KEY: string;
}

const cors = (env: Env, origin: string | null) => {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.some((a) => origin === a);
  return {
    'access-control-allow-origin': ok ? origin! : allowed[0] ?? '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  };
};

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/* ---------------- pricing ladder ---------------- */

function ladder(env: Env, sold: number) {
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

const soldCount = async (env: Env, id: string) =>
  Number((await env.PRICING.get(`SOLD:${id}`)) ?? 0);

/* ---------------- signed download tokens ---------------- */

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
  const m = id.match(/^(.*?)(-print|-press)?$/)!;
  const [pieceId, variant] = [m[1], m[2] ?? ''];

  if (variant === '-print')
    return json([{ id, url: `${env.SITE_ORIGIN}/art/${pieceId}`, price: Number(env.PRINT_PRICE) }], 200, h);
  if (variant === '-press')
    return json([{ id, url: `${env.SITE_ORIGIN}/art/${pieceId}`, price: Number(env.PRESS_PRICE) }], 200, h);

  const sold = await soldCount(env, pieceId);
  const l = ladder(env, sold);
  return json([{ id, url: `${env.SITE_ORIGIN}/art/${pieceId}`, sold, ...l }], 200, h);
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

async function snipcartWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const token = req.headers.get('x-snipcart-requesttoken');
  if (!token) return json({ error: 'missing token' }, 401);
  const check = await fetch(`https://app.snipcart.com/api/requestvalidation/${token}`, {
    headers: { Authorization: `Basic ${btoa(env.SNIPCART_SECRET + ':')}` },
  });
  if (!check.ok) return json({ error: 'invalid token' }, 401);

  const event = (await req.json()) as any;
  if (event.eventName !== 'order.completed') return json({ ignored: event.eventName });

  const order = event.content;
  const { email, token: orderId } = order;

  for (const item of order.items as any[]) {
    if (/-print$|-press$/.test(item.id)) {
      ctx.waitUntil(createPrintfulOrder(env, order, item));
      continue;
    }

    const pieceId = item.id;
    const before = await soldCount(env, pieceId);
    const sold = before + item.quantity;
    await env.PRICING.put(`SOLD:${pieceId}`, String(sold));
    await env.ENTITLEMENTS.put(
      `OWNER:${pieceId}`,
      JSON.stringify({ email, orderId, mintedAt: new Date().toISOString().slice(0, 10) })
    );
    await env.ENTITLEMENTS.put(
      `DL:${orderId}:${pieceId}`,
      JSON.stringify({ uses: 0, max: Number(env.DOWNLOAD_MAX_USES) }),
      { expirationTtl: Number(env.DOWNLOAD_TTL_HOURS) * 3600 }
    );

    const lifetime = Number((await env.ENTITLEMENTS.get(`COUNT:${email}`)) ?? 0) + item.quantity;
    await env.ENTITLEMENTS.put(`COUNT:${email}`, String(lifetime));
    if (lifetime >= 12) await env.ENTITLEMENTS.put(`VAULT:${email}`, '1');

    if (ladder(env, before).tier >= Number(env.FREE_APPAREL_FROM_TIER))
      ctx.waitUntil(createPrintfulOrder(env, order, { id: `${pieceId}-press`, free: true }));

    const dl = await makeToken(env, orderId, pieceId);
    ctx.waitUntil(sendDownloadEmail(env, email, pieceId, dl, new URL(req.url).origin));
    console.log(JSON.stringify({ evt: 'mint', pieceId, orderId, sold, lifetime }));
  }

  return json({ ok: true });
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

async function createPrintfulOrder(env: Env, order: any, item: any) {
  const map = (await env.PRICING.get(`PF:${item.id}`, 'json')) as
    | { variant_id: number; print_file_url: string } | null;
  if (!map) { console.log('no printful mapping for', item.id); return; }

  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.PRINTFUL_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      recipient: {
        name: order.shippingAddressName ?? order.billingAddressName,
        address1: order.shippingAddressAddress1 ?? order.billingAddressAddress1,
        city: order.shippingAddressCity ?? order.billingAddressCity,
        state_code: order.shippingAddressProvince ?? order.billingAddressProvince,
        country_code: order.shippingAddressCountry ?? order.billingAddressCountry,
        zip: order.shippingAddressPostalCode ?? order.billingAddressPostalCode,
        email: order.email,
      },
      items: [{ variant_id: map.variant_id, quantity: item.quantity ?? 1, files: [{ url: map.print_file_url }] }],
      confirm: false, // you approve in the Printful dash until you trust it
    }),
  });
  console.log('printful order', item.id, res.status, item.free ? '(free apparel)' : '');
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
    if (pathname === '/api/webhooks/snipcart' && req.method === 'POST') return snipcartWebhook(req, env, ctx);
    if (pathname === '/api/download') return download(req, env);

    return json({ service: 'freethinkers-api', ok: true }, 200, cors(env, req.headers.get('origin')));
  },
};
