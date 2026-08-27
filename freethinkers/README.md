# Freethinkers.AI + FTWlabs.AI

Two Astro sites, one Cloudflare Worker, one art pipeline. Built to go live in an
afternoon and to take money the same day.

**→ Start here: [`docs/00-GO-LIVE-TODAY.md`](docs/00-GO-LIVE-TODAY.md)** — the
hour-by-hour launch runbook and an honest read on what "revenue tonight" means.

---

## The two brands

| | **Freethinkers.AI** | **FTWlabs.AI** |
|---|---|---|
| What | Finished works, one per day of 2026 | ~3,000 concepts, studies, experiments |
| Price | $300 master, +12% every 12 sold | $19 each · 10 for $99 |
| Role | Prestige. Compounds over months. | **Revenue engine. Converts cold traffic today.** |
| Buyer | Considered purchase, needs trust | Impulse buy, decides in 30 seconds |

Lead with FTWlabs for early revenue; let Freethinkers build. The cross-links
between them are the funnel.

## The three channels (Freethinkers)

1. **Mint** — the full-resolution master, delivered on an expiring signed link,
   fingerprinted to the buyer, with a public certificate at `/a/{piece-id}`.
2. **Print** — museum-grade giclée via Printful, printed on demand.
3. **Press** — a sweatshirt or long-sleeve carrying the art **and its own QR code**.
   Scan it → the certificate page → the store. The collector wearing it is the
   storefront. Free with every master.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Editor | **Cursor** | Local dev; this repo is the starting point |
| Framework | **Astro 7** | Static, fast, deploys to Cloudflare in minutes |
| Hosting | **Cloudflare** Pages + Workers + R2 + KV | Free tier covers it; R2 has zero egress fees |
| Checkout | **Gumroad/Stripe today → Snipcart** | Provider-agnostic; one env var switches rails |
| Print + Press | **Printful** | One vendor for prints *and* apparel, API-driven |
| Mint | Signed master delivery (phase 2: NFT via thirdweb/Manifold) | Don't block launch on chain decisions |

**Dropped Shopify and Ninja Print.** Snipcart + Printful does everything with less
overhead. Prodigi remains a fine backup if Printful's print quality disappoints —
the worker relay makes vendors swappable.

## Layout

```
freethinkers/
├── docs/
│   ├── 00-GO-LIVE-TODAY.md    ← the launch runbook (start here)
│   ├── 01-art-protection.md   ← the 3 layers, honestly explained
│   ├── 02-pricing-model.md    ← the ladder + bundle math
│   └── 04-ftwlabs-concepts.md ← migrating & selling the 3k concepts
├── site/       freethinkers.ai — gallery, 365 grid, price ladder, certificates
├── ftwlabs/    ftwlabs.ai — concept explorer, bundle builder, checkout
├── workers/api/  pricing, image gate, signed delivery, webhooks, email capture
└── scripts/    art pipeline, QR codes, Printful sync, migrations, demo data
```

## Quick start

```bash
# Both sites build clean as-is, on demo data
cd freethinkers/ftwlabs && npm install && npm run dev   # localhost:4321
cd ../site && npm install && npm run dev

# Regenerate demo catalogs
cd ../scripts && node make-demo-data.mjs 144 36

# Real art
npm install
node prepare-art.mjs ~/art/finished ./out --stego
node migrate-concepts.mjs ~/art/concepts --limit 200
node qr-generate.mjs --all
node pricing.mjs 300 12 12
```

Copy `.env.example` → `.env`, and set the same `PUBLIC_*` vars in both Cloudflare
Pages projects.

## Interactivity, on purpose

Every interactive piece exists to sell something:

- **Concept explorer** — instant search + tag filters + lazy infinite scroll makes
  3,000 items browsable instead of overwhelming.
- **Bundle builder** — live "add N more for $99" prompt; the single biggest lever
  on average order value. Selection persists across pages.
- **Price ladder** — live tier and "3 left at this price" scarcity, straight from
  the worker, so displayed and charged prices can never disagree.
- **365 year grid** — the collection visibly filling up; every cell is a clickable
  sale, and the whole grid is the annual 1-of-1.
- **Vault progress** — 12 dots toward Collector's Vault access, which reframes a
  second purchase as progress toward a goal.
- **Protected lightbox** — keyboard-navigable, canvas-rendered, no saveable src.

## Open questions, answered

- **Vault access for 12+ buyers:** don't open the GitHub repo — it's a poor gallery
  and hard to revoke. Use a private site section gated by purchase email. Same
  reward, revocable, on-brand. Entitlement logic is already in the worker.
- **Wix:** keep it running until `freethinkers.ai` resolves to Pages and you've
  loaded it yourself. If the domain is registered at Wix, start the transfer early
  (~5 days) — the DNS cutover is immediate and doesn't block launch.
