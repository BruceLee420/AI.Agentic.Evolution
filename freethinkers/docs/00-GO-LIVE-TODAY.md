# Go Live Today — Both Sites, Real Checkout, Honest Revenue Plan

## Read this first: what "making money tonight" actually means

Three different things get blurred together. Separating them is what makes tonight work:

| Claim | Achievable tonight? |
|---|---|
| Both sites live on real domains | **Yes** — ~2–3 hours of the steps below |
| Sites able to *accept* a payment | **Yes** — Gumroad/Stripe links take money in ~30 min |
| Money actually *landing* | **Depends entirely on traffic**, not on code |
| Money in your *bank account* | **No** — every processor holds first payouts 2–7 days |

Nobody can make strangers show up tonight. What we can do is make sure that **the
moment anyone does show up, there is nothing between them and a purchase** — and
then point your existing audience at it. Sections 1–4 are the build. **Section 5 is
the part that determines whether you make money**, and it's the part only you can do.

**Strategic call: lead with FTWlabs tonight, not Freethinkers.**
A $19 concept is an impulse buy that converts cold traffic on the first visit. A
$300 master is a considered purchase that needs trust you build over weeks. You
have ~3,000 concepts sitting there — that's the inventory that can convert
*tonight*. Freethinkers is the prestige brand that compounds; let it build while
FTWlabs pays the bills.

---

## 1. Payment rail — pick the fast one (30 min)

Snipcart is the right long-term rail and it's already wired into both sites. It is
**not** the right rail for tonight: it needs a paid plan plus domain verification
before it takes live payments. Both sites ship provider-agnostic
(`src/lib/checkout.ts`) so you launch on a fast rail and flip one env var later.

| Rail | Live in | Fee | Best for |
|---|---|---|---|
| **Gumroad** ← recommended tonight | ~15 min, no approval wait | 10% flat | Digital files, auto-delivery, zero setup |
| **Stripe Payment Links** | ~30 min *if* your Stripe is already activated | 2.9% + 30¢ | Lower fees, you handle delivery |
| **Snipcart** | 1–3 days | 2% + Stripe | The full stack: cart, price ladder, Printful automation |

**Do this:** create three Gumroad products —
`FTW Concept — single ($19)`, `FTW Bundle — 10 ($99)`, `Freethinkers Master ($300)` —
and put their URLs in the site env as `PUBLIC_PAY_URL_SINGLE`, `PUBLIC_PAY_URL_BUNDLE`,
`PUBLIC_PAY_URL_MINT`. Upload the actual files to the Gumroad products so delivery
is automatic while the R2 + worker delivery path is still being wired.

> Gumroad's 10% stings, but 10% of a sale tonight beats 2% of a sale next week.
> Switch to Snipcart the day it's approved — one env var, no code change.

## 2. Deploy both sites (45 min)

Both already build clean. Nothing here should surprise you.

```bash
# From the repo root
cd freethinkers/ftwlabs && npm install && npm run build   # verified: builds
cd ../site && npm install && npm run build                # verified: 73 pages
```

**Cloudflare Pages — two projects, same repo:**

| Setting | freethinkers.ai | ftwlabs.ai |
|---|---|---|
| Root directory | `freethinkers/site` | `freethinkers/ftwlabs` |
| Build command | `npm run build` | `npm run build` |
| Output directory | `dist` | `dist` |

Add these environment variables to **both** projects (values from step 1):

```
PUBLIC_CHECKOUT_PROVIDER=gumroad
PUBLIC_API_BASE=https://freethinkers-api.<your-subdomain>.workers.dev
PUBLIC_PAY_URL_SINGLE=https://…gumroad.com/l/ftw-single
PUBLIC_PAY_URL_BUNDLE=https://…gumroad.com/l/ftw-bundle
PUBLIC_PAY_URL_MINT=https://…gumroad.com/l/ft-master
```

Each project gets a `*.pages.dev` URL immediately — **you are live at that point**,
before DNS. Don't wait on domains to start selling.

## 3. Domains (30 min, can run in parallel)

Add both domains to Cloudflare → swap nameservers at your registrar → attach each
domain to its Pages project. Propagation is usually minutes, occasionally hours.

**Do not cancel Wix until `freethinkers.ai` resolves to Pages and you've loaded it
in a browser.** If the domain is registered *at* Wix, start the transfer now
(~5 days) — the DNS cutover works immediately regardless, so it doesn't block tonight.

## 4. Get art in front of buyers (60–90 min — the real bottleneck)

The sites currently render **demo placeholders**. This is the step that turns them
into a store, and it's where your time actually goes tonight.

```bash
cd freethinkers/scripts && npm install

# Finished works → protected 1080p previews + masters with metadata
node prepare-art.mjs ~/path/to/finished ./out --stego

# Concepts → FTWlabs (resumable; safe to interrupt and rerun)
node migrate-concepts.mjs ~/path/to/concepts --bucket ftw-concepts
```

Then replace the demo catalogs with real data:
- `freethinkers/site/src/data/pieces.json` — finished works
- `freethinkers/ftwlabs/src/data/concepts.json` — concepts (the migration writes
  `concepts-manifest.json`; it's the same shape)

**Tonight's scope discipline:** you do not need all 3,000 concepts live tonight.
**Start with 100–200 good ones.** A tight, curated 150 converts better than 3,000
unsorted, uploads in a fraction of the time, and you can add the rest all week.
Same for Freethinkers — 10–20 flagship pieces is a launch.

> Both sites work without R2 or the worker: previews fall back to generated
> gradients and prices to base values. Ugly-but-live beats perfect-but-dark, and
> you can upload real art incrementally while the site is already selling.

## 5. The part that actually makes money tonight

Everything above just removes obstacles. **Traffic is the product tonight**, and
you're the only one who can supply it. A store nobody visits earns exactly $0, no
matter how good the code is.

Realistic conversion math: cold traffic converts at roughly **1–3%** on a $19
impulse item. So ~200 real visitors ≈ 2–6 sales ≈ **$40–120**. That is a genuine
first night. Anyone promising more is guessing.

**Do all of these tonight, in this order:**

1. **Post the work, not the store.** Lead with the art itself on whatever platform
   you already have people — a carousel of 10 concepts, the story of one piece. Put
   the link in the first comment or your bio, not in the post body. Platforms
   suppress outbound links; they don't suppress art.
2. **Price the launch to move.** A `FIRSTNIGHT` code at 30–40% off for 48 hours
   gives people a reason to buy now instead of bookmarking. Early-adopter pricing
   is already your whole brand story — this is on-message, not a discount panic.
3. **Post where art buyers gather, honestly.** r/Art, r/generative, r/DigitalArt,
   relevant Discords. Read each one's self-promo rules first — a ban costs more than
   a night of sales. Show the work, mention the shop once, don't spam.
4. **Message the people who already told you they liked your work.** Ten personal
   messages beat a thousand impressions. This is the single highest-converting
   thing you will do tonight.
5. **Turn on email capture from minute one.** Both sites have it wired to
   `/api/subscribe`. Most of tonight's visitors won't buy — the list is how they
   become February's customers.

## 6. Tomorrow (not tonight — resist the urge)

- Deploy the worker (`cd workers/api && npx wrangler deploy`) → real price ladder,
  protected image serving, signed master delivery.
- Apply for Snipcart; flip `PUBLIC_CHECKOUT_PROVIDER=snipcart` when approved.
- Printful account + **order garment samples for yourself** before promoting the
  free-sweater perk. Never sell a garment you haven't held.
- Upload the rest of the concepts in batches.
- Enable Cloudflare Bot Fight Mode + Block AI Scrapers.
- Register the launch batch with the US Copyright Office (~$65 group registration)
  — this is what makes takedowns enforceable.

---

## Tonight's checklist

```
[ ] Gumroad: 3 products created, URLs copied
[ ] Cloudflare Pages: 2 projects deployed, env vars set        → LIVE on *.pages.dev
[ ] Domains added, nameservers swapped                         (can lag; not blocking)
[ ] 100–200 concepts through the pipeline → concepts.json
[ ] 10–20 finished pieces → pieces.json
[ ] One end-to-end test purchase — buy your own product, confirm the file arrives
[ ] FIRSTNIGHT discount code live
[ ] Posted to your audience + 10 personal messages
[ ] Wix still running until freethinkers.ai verified on Pages
```

The one step people skip and regret: **buy your own product before you promote it.**
A broken checkout discovered by your first real customer costs more than the ten
minutes it takes to test.
