/**
 * Mint · Print · Press — the product matrix.
 *
 * This file is the single place where "what do we sell on each piece" lives.
 * The syndicator reads it to create provider listings; the worker prices
 * against the mapping the syndicator pushes; the PDP renders its variant
 * selectors from the same shape. Change a price here, rerun sync, done.
 *
 * Provider ids are deliberately absent: blueprints and variants resolve by
 * name at sync time (see printful.mjs / printify.mjs), and `node
 * sync-products.mjs verify` shows you every resolution before anything is
 * created.
 */

export default {
  // Public base URL where print files are uploaded (R2 bucket behind a domain).
  // sync-products.mjs prints the exact upload commands for ./printfiles.
  fileBase: process.env.PRINTFILE_BASE ?? 'https://printfiles.freethinkers.ai',

  categories: {
    /** MINT — the digital master. Sold by the worker's ladder + signed
     *  delivery; listed here only so the PDP can render the category. */
    mint: {
      label: 'Mint',
      blurb: 'The full-resolution master, fingerprinted to you.',
    },

    /** PRINT — paper on walls. Contain-fit: the whole artwork, never cropped. */
    print: {
      label: 'Print',
      blurb: 'Museum-grade paper, printed on demand.',
      products: [
        {
          key: 'poster',
          label: 'Matte Print',
          provider: 'printful',
          catalogId: 1, // Enhanced Matte Paper Poster — verified by `verify`
          fit: 'contain',
          options: { size: ['12x16', '18x24', '24x36'] },
          price: { '12x16': 60, '18x24': 80, '24x36': 110 },
          minDpi: 150,
        },
        {
          key: 'framed',
          label: 'Framed Print',
          provider: 'printful',
          catalogId: 2, // Enhanced Matte Paper Framed Poster — verified by `verify`
          fit: 'contain',
          options: { size: ['12x16', '18x24'], frame: ['Black'] },
          price: { '12x16': 120, '18x24': 160 },
          minDpi: 150,
        },
      ],
    },

    /** PRESS — worn. Cover-fit on the front placement; ships with the piece's
     *  QR so the garment is a walking certificate. */
    press: {
      label: 'Press',
      blurb: 'Wear it with the QR that proves it.',
      products: [
        {
          key: 'tee',
          label: 'Tee',
          provider: 'printify',
          blueprintSearch: 'Bella Canvas 3001',
          fit: 'contain',
          useQrComposite: true,
          options: { size: ['S', 'M', 'L', 'XL', '2XL'], color: ['Black', 'White'] },
          price: 45,
        },
        {
          key: 'hoodie',
          label: 'Hoodie',
          provider: 'printful',
          catalogId: 146, // Gildan 18500 hoodie — verified by `verify`
          fit: 'contain',
          useQrComposite: true,
          options: { size: ['S', 'M', 'L', 'XL', '2XL'], color: ['Black'] },
          price: 70,
          placement: 'front',
        },
      ],
    },
  },
};

/** Stable per-variant item id shared by PDP, worker pricing, and fulfillment.
 *  e.g. FT-2026-034-press-tee (options ride separately as size/color). */
export const itemId = (pieceId, category, productKey) =>
  `${pieceId}-${category}-${productKey}`;
