# Mint · Print · Press — the commerce engine

Turns ingested masters into live print-on-demand listings on **Printful and
Printify**, and routes paid orders back to the right provider with zero touch.

```
products.config.mjs ──► syndicate/sync-products.mjs ──► live provider listings
        │                        │
        │                        └──► fulfillment-mappings.json ──► worker KV (FULFILL:)
        │
        └──► site ProductOptions.astro (PDP tabs + variant pills read the same matrix)

buyer ──► /api/checkout (Stripe, server-priced) ──► /api/webhooks/stripe ─┐
buyer ──► Snipcart cart ──────────────────────────► /api/webhooks/snipcart ─┤
                                                                            ▼
                                              processOrder ──► FULFILL: lookup
                                                 ├─ printful → draft order (sync variant)
                                                 ├─ printify → order (published product)
                                                 └─ failure  → RETRY: queue → 30-min cron
```

One file — `products.config.mjs` — decides what's sold on every piece.
The syndicator lists from it, the worker prices from the mappings it pushes,
and the PDP renders its pills from it. Change a price there, rerun sync, done.

## Design rules (the ones that prevent 3am failures)

- **No hardcoded variant ids.** Blueprints and variants resolve by *name*
  against the live catalogs at sync time. `verify` prints every resolution
  before anything is created.
- **DPI gate.** A size whose effective resolution falls under `minDpi` (150)
  is refused, per piece, per size — a soft print never goes on sale.
- **Resumable state.** `synced-products.json` is written after *every*
  listing. A crash at piece 141 resumes at 141; reruns skip finished work.
- **Rate-limit survival.** Token bucket under each provider's ceiling, plus
  exponential backoff with jitter honoring `Retry-After` on 429/5xx. Other
  4xx fail fast — a bad payload stays bad no matter how politely you resend it.
- **Orders never get lost.** A fulfillment failure parks in a `RETRY:` KV
  queue; a cron drains it with capped attempts and dead-letters to `FAILED:`
  for a human after six.

## Runbook (PowerShell — run each line on its own)

```powershell
cd freethinkers\commerce
npm install
npm test                  # full pipeline against mock providers, no keys needed
```

Then with real keys (Printful: Settings → Stores → API; Printify: My Profile
→ Connections → API tokens):

```powershell
$env:PRINTFUL_KEY = "paste-here"
$env:PRINTIFY_KEY = "paste-here"
npm run printfiles        # builds printfiles\ - masters + QR press composites
# upload printfiles\ to the bucket behind https://printfiles.freethinkers.ai
# (the command prints the exact wrangler lines)
npm run verify            # resolves everything, creates NOTHING - read it all
npm run sync -- --limit 2 # trial: two pieces end to end, check both dashboards
npm run sync              # the rest; safe to re-run any time
npm run mappings          # emits fulfillment-mappings.json + push-mappings.sh
```

Push the mappings to the worker's KV (`push-mappings.sh` on mac/linux, or run
the `wrangler kv key put` lines it contains individually on Windows), set the
worker secrets (`wrangler secret put PRINTFUL_KEY`, `PRINTIFY_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), and deploy. Point a Stripe
webhook (checkout.session.completed) at `/api/webhooks/stripe`.

**Read `verify` before `run`.** The expensive failure here isn't an API
error — it's 180 listings quietly created against the wrong garment.

## Why this lives on the Astro/Cloudflare stack

The original brief said React/Netlify; everything already running here
(sites, worker, KV, R2, webhooks, protection layers) is Astro on Cloudflare,
so the storefront, checkout, and webhook deliverables were built into that
stack rather than standing up a parallel one. Same substance: static-first
storefront with dynamic variant PDPs, serverless checkout (Stripe Checkout
Sessions priced server-side), and webhook order routing — just deployed as a
Cloudflare Worker instead of Netlify Functions.

## Files

| file | job |
|---|---|
| `products.config.mjs` | the single product matrix (prices, sizes, colors, DPI floors) |
| `syndicate/http.mjs` | rate limiter + retry/backoff + context-rich errors |
| `syndicate/scale.mjs` | contain/cover fit math for both providers + DPI gate |
| `syndicate/printful.mjs` | Printful adapter (live variant resolution, mockups, draft orders) |
| `syndicate/printify.mjs` | Printify adapter (blueprint search, upload, publish, orders) |
| `syndicate/sync-products.mjs` | `printfiles` / `verify` / `run` / `mappings` CLI |
| `syndicate/state.mjs` | resumable state + FULFILL: mapping flattener |
| `syndicate/mock-provider-server.mjs` | both APIs faked, with injected 429/500 faults |
| `syndicate/test-e2e.mjs` | `npm test` — the whole pipeline, green means proven |

Generated locally, never committed: `synced-products.json`,
`fulfillment-mappings.json`, `push-mappings.sh`, `printfiles/`.
