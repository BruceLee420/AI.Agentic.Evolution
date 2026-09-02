/**
 * Print-area scaling — where a wrong number becomes a misprinted hoodie.
 *
 * The two providers describe placement in different languages:
 *
 *   Printful wants absolute printfile pixels: {area_width, area_height,
 *   width, height, top, left} — the rendered size and offset of the art
 *   inside the printfile.
 *
 *   Printify wants relative units: {x, y, scale, angle} where x/y are the
 *   image centre as a fraction of the print area and scale=1 means the image
 *   is exactly as wide as the print area.
 *
 * Both are derived here from one pair of fit rules so the same piece lands
 * identically on both providers:
 *
 *   contain — the whole artwork is visible (posters, framed prints). May
 *             leave margin; never crops.
 *   cover   — the print area is filled edge to edge (apparel front). May
 *             crop; never leaves margin.
 */

/** Rendered size of art (W×H) fit inside/over an area (aw×ah). */
export function fitRect(W, H, aw, ah, mode) {
  if (![W, H, aw, ah].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error(`fitRect: bad dimensions ${W}x${H} into ${aw}x${ah}`);
  }
  const s = mode === 'cover'
    ? Math.max(aw / W, ah / H)
    : Math.min(aw / W, ah / H);
  const width = W * s;
  const height = H * s;
  return {
    width,
    height,
    left: (aw - width) / 2,
    top: (ah - height) / 2,
    scale: s,
  };
}

/** Printful mockup/file position block, centred. */
export function printfulPosition(W, H, area, mode = 'contain') {
  const f = fitRect(W, H, area.width, area.height, mode);
  return {
    area_width: area.width,
    area_height: area.height,
    width: Math.round(f.width),
    height: Math.round(f.height),
    left: Math.round(f.left),
    top: Math.round(f.top),
  };
}

/**
 * Printify placeholder image block, centred.
 * scale is rendered-width / area-width; x,y are the image centre (0..1).
 */
export function printifyPlacement(W, H, area, mode = 'contain') {
  const f = fitRect(W, H, area.width, area.height, mode);
  return {
    x: 0.5,
    y: 0.5,
    scale: f.width / area.width,
    angle: 0,
  };
}

/**
 * Honest resolution check. Returns dots-per-inch the buyer will actually get
 * at this print size; the sync warns below `warnBelow` instead of silently
 * shipping soft prints.
 */
export function effectiveDpi(pixelsW, pixelsH, inchesW, inchesH) {
  return Math.floor(Math.min(pixelsW / inchesW, pixelsH / inchesH));
}

/** "18x24" → {w:18, h:24}; tolerant of ″, ×, spaces. */
export function parseSizeInches(label) {
  const m = String(label).replace(/[″"”]/g, '').match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) throw new Error(`unparseable size label: "${label}"`);
  return { w: Number(m[1]), h: Number(m[2]) };
}
