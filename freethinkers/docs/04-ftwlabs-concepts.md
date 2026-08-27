# FTWlabs — Selling the 3,000 Concepts

## Positioning

Freethinkers.AI stays curated: finished, protected, laddered. **FTWlabs is the lab** —
raw concepts, experiments, volume pricing. Two brands, one infrastructure: same
Astro scaffold, same worker, different bucket and pricing.

Keeping concepts off the flagship is what protects the $300 ladder from being
undercut by $19 concepts. Cross-link them hard in both directions — concepts are
the top of the funnel.

## Migration

```bash
node scripts/migrate-concepts.mjs ~/art/concepts \
  --bucket ftw-concepts --prefix 2026 --limit 200
```

Per image: normalizes to `FTW-{seq}`, generates the protected 1080p preview with
the FTWLABS mark, uploads master + preview to R2, appends to
`concepts-manifest.json`. **Resumable** — it saves after every item and skips what's
already done, which matters because a 3,000-image run will get interrupted.

Publish a batch: `cp concepts-manifest.json ../ftwlabs/src/data/concepts.json`

**Launch with 100–200, not 3,000.** A curated 150 converts better than 3,000
unsorted, uploads in minutes instead of hours, and you can add the rest all week.
Use `--limit` to take it in bites.

## Making the catalog searchable

The explorer filters on `tags`, so tags are what make 3,000 items navigable.
The migration writes empty tags — fill them in as you go, even roughly
(`abstract`, `portrait`, `glitch`, `monochrome`, `type`). Ten good tags across the
catalog beats a perfect taxonomy you never finish.

## Pricing

Flat: **$19** single · **$99** for any 10 · **$8** each additional.
No ladder — volume and discovery are the point. The bundle prompt in the explorer
is what moves a 1-item cart to 10.

## Provenance loop

When a concept graduates into a finished work, retire it from FTWlabs and note the
lineage on the finished piece ("evolved from FTW-1042"). That story is worth real
money on the Freethinkers side — collectors buy origin.

## Storage reality check

3,000 masters at ~15 MB ≈ 45 GB → R2 at $0.015/GB-mo ≈ **$0.68/month**, zero egress
fees. Storage is not a constraint; don't let it shape any decision here.
