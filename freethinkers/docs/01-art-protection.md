# Art Protection — The Three Layers

## The honest premise (read this first)

**Nothing on the web can stop an OS-level screenshot.** Any pixel a browser renders,
the operating system can capture — no CSS trick, JS handler, or DRM overlay changes
that. Anyone selling you otherwise is selling deterrence as prevention.

So this architecture doesn't try to make screenshots impossible. It makes them
**worthless, deterred, and traceable**:

1. **Worthless** — the public site only ever renders 1080p watermarked previews.
   A perfect screenshot captures exactly what you already give away as marketing.
2. **Deterred** — every casual save path is closed.
3. **Traceable** — every file carries visible + invisible + metadata watermarks, and
   purchased masters are fingerprinted to their buyer.

---

## Layer 1 — Separation: masters never reach the browser

- **`ft-masters` (private R2):** originals. No public access. Only the delivery
  worker can read it, through an R2 binding.
- **`ft-public`:** 1080p previews from `scripts/prepare-art.mjs`, each carrying a
  visible corner mark, a low-opacity diagonal watermark, an invisible LSB
  watermark, and EXIF copyright metadata.
- **Delivery only after purchase:** Snipcart `order.completed` → worker validates
  the webhook against Snipcart's API → writes a KV entitlement → buyer receives
  `/api/download?token=…`, an **HMAC-signed URL expiring in 72h, limited to 3
  downloads**.

## Layer 2 — Deterrence: closing the casual paths

Implemented in `ProtectedArt.astro`, `Gallery.astro`, `ConceptExplorer.astro`, and
`public/_headers`:

| Vector | Countermeasure |
|---|---|
| Right-click → Save | `contextmenu` blocked on art surfaces |
| Drag to desktop | `dragstart` blocked |
| Long-press save (mobile) | `-webkit-touch-callout: none` |
| Select / copy | `user-select: none` |
| Direct image URL | Worker checks `Referer` / `sec-fetch-site`; hotlinks get a branded pitch instead of art |
| `<img src>` scraping | Art drawn into `<canvas>`; blob URL revoked right after decode |
| Crawlers / AI scrapers | `X-Robots-Tag: noimageindex`, `robots.txt`, Cloudflare AI-scraper block + Bot Fight Mode |
| Print / print-to-PDF | `@media print` swaps art for a watermark card |
| DevTools network tab | Not preventable — but it only ever holds the 1080p watermarked preview |

This stops the 95% casual case and signals the work is protected. The determined 5%
is Layers 1 and 3's job, not the browser's.

## Layer 3 — Tracking & forensics

1. **Invisible watermark** (`prepare-art.mjs --stego`): piece ID in blue-channel
   LSBs, tiled so edge-cropping doesn't kill it. Survives PNG re-save; **not** heavy
   JPEG recompression — one signal among several. Per-buyer masters embed
   `sha256(orderId + email)`, so a leaked master identifies its buyer.
   Verify with `prepare-art.mjs --decode <file>`.
2. **Metadata:** copyright + piece ID + order ID in EXIF. Strippable, but most
   infringers don't — it wins the easy DMCA cases.
3. **Request logging:** the worker logs image and download requests, so scraping
   patterns are visible.
4. **Enforcement routine:** monthly reverse-image search on top pieces (Google Lens
   / TinEye); Pixsy or ImageRights if volume justifies it. **Register each batch with
   the US Copyright Office (~$65 group registration)** — that's what unlocks
   statutory damages and makes takedowns bite.

## What a thief actually gets

| Attack | Result |
|---|---|
| Screenshot the site | 1080p preview, visibly + invisibly watermarked |
| Rip from network tab | The same file |
| Bulk scrape | Bots blocked; a manual scrape yields watermarked previews, logged |
| Buyer re-shares master | File carries their order fingerprint — you know who |
