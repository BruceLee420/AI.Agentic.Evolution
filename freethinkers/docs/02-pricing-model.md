# Pricing Model

## Freethinkers.AI — the early-adopter ladder

Base **$300**. After every **12 sold**, price rises **12%**, compounding.
Early buyers keep the lowest price forever; the ladder only goes up.

```
price(sold) = 300 × 1.12 ^ floor(sold / 12)
```

| Tier | Units | Price | Tier revenue | Cumulative |
|---|---|---|---|---|
| 1 | 1–12 | $300.00 | $3,600 | $3,600 |
| 2 | 13–24 | $336.00 | $4,032 | $7,632 |
| 3 | 25–36 | $376.32 | $4,516 | $12,148 |
| 4 | 37–48 | $421.48 | $5,058 | $17,206 |
| 5 | 49–60 | $472.06 | $5,665 | $22,870 |
| 6 | 61–72 | $528.70 | $6,344 | $29,215 |
| 7 | 73–84 | $592.15 | $7,106 | $36,321 |
| 8 | 85–96 | $663.21 | $7,958 | $44,279 |
| 9 | 97–108 | $742.79 | $8,914 | $53,193 |
| 10 | 109–120 | $831.93 | $9,983 | $63,176 |

Regenerate: `node scripts/pricing.mjs 300 12 12 --tiers 20`

### Why nobody can cheat it

Client-side prices are decoration; the real price lives in the worker.
Sold counts live in KV (`SOLD:{pieceId}`), and every Snipcart button's
`data-item-url` points at `/api/products/{id}` — **Snipcart re-fetches that
endpoint at checkout and rejects any cart whose price doesn't match.** Tampering
with the DOM does nothing. The webhook increments the count, so the ladder steps
up on its own; you never reprice by hand.

### Scarcity UX

`/api/products/{id}` returns `remainingAtTier`, surfaced by `PriceLadder.astro`:
**"3 left at $300 — next tier $336."** That single line sells harder than any banner.

## FTWlabs — volume pricing

| What | Price |
|---|---|
| Single concept master | **$19** |
| Any 10 | **$99** (48% off) |
| Each additional past 10 | **$8** |

Deliberately *not* on a ladder. Concepts are discovery and volume; the ladder is
what makes Freethinkers feel scarce. Keeping the two models separate is what stops
$19 concepts from cannibalising $300 masters.

The bundle is the AOV engine: `ConceptExplorer.astro` shows a live "add N more for
the $99 bundle" prompt, which reliably moves a 1-item cart to 10.

## Free sweater economics

Printful sweatshirt ≈ $24–34 + $8–12 shipping ≈ **$32–46 landed**.
On a $300 tier-1 sale after fees: margin ≈ **$238–248**. The garment is your
walking-billboard budget and it clears easily.

If tier-1 margin matters, set `FREE_APPAREL_FROM_TIER=2`, or use a long-sleeve tee
(≈$18 landed) at tier 1.

## FREETHINKERS 365

Each finished daily piece is a tile; `scripts/compose-365.mjs` builds the composite.
It sells **once, on January 1**, as a single 1-of-1 — auction or fixed premium,
**not** on the $300 ladder. Same day, the next year's canvas begins. That turns
New Year's Day into a recurring annual event you own.
