/**
 * Filename parser for the FREETHINKERS naming convention.
 *
 * Your files carry their own metadata, e.g.
 *   HAWK.EYE_2026-06-10_FINAL_3001.jpg  →  "HAWK EYE", 2026-06-10
 *
 * Real filenames drift though — a year of typing at speed leaves single-digit
 * days, three-digit days, dots where dashes should be, missing separators,
 * missing years, and a few impossible dates. This parser handles the drift and,
 * crucially, *reports* what it couldn't trust instead of silently guessing.
 * A wrong date silently assigned is worse than a flagged one.
 */

const EXT = /\.(png|jpe?g|tiff?|webp)$/i;
// Trailing "_FINAL_3001", ".FINAL_3000", "FINAL_300", with any separators.
const TAIL = /[._\-\s]*FINAL[._\-\s]*\d*[._\-\s]*$/i;

/** Dots read as word separators, except between digits so "2.0" survives. */
function cleanTitle(s) {
  return s
    .replace(/[._]+$/g, '')
    .replace(/(?<![0-9])\.(?![0-9])/g, ' ')   // letter.letter → space
    .replace(/(?<=[A-Za-z])\.(?=[0-9])/g, ' ') // SLEEVES.2 → SLEEVES 2
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pad = (n) => String(n).padStart(2, '0');

/**
 * @returns {{title, date, year, month, day, confidence, issues[]}}
 *   confidence: 'high'   — full date parsed cleanly
 *               'medium' — date recovered from an odd format, or year inferred
 *               'none'   — no usable date in the name
 */
export function parseFilename(name, { fallbackYear = 2026 } = {}) {
  const issues = [];
  const base = name.replace(EXT, '');
  let work = base.replace(TAIL, '');

  let year = null, month = null, day = null, dateRaw = null, confidence = 'high';

  // A: 2026-06-10 / 2026-05.31 / 2026-06-3 / 2026-05-031
  let m = work.match(/(20\d{2})[-._](\d{1,2})[-._](\d{1,3})/);
  if (m) {
    year = +m[1]; month = +m[2]; day = +m[3]; dateRaw = m[0];
    if (m[3].length === 3) {
      // "031" → 31, "027" → 27. A leading zero on a 3-digit day is a typo.
      day = +m[3].replace(/^0+/, '');
      issues.push(`day "${m[3]}" read as ${day}`);
      confidence = 'medium';
    }
  }

  // B: 2026-0303  (month and day mashed together)
  if (!m) {
    m = work.match(/(20\d{2})[-._](\d{4})(?!\d)/);
    if (m) {
      year = +m[1]; month = +m[2].slice(0, 2); day = +m[2].slice(2); dateRaw = m[0];
      issues.push(`"${m[2]}" split as ${pad(month)}-${pad(day)}`);
      confidence = 'medium';
    }
  }

  // C: 5.6.26 / 4.1.26  (M.D.YY)
  if (!m) {
    m = work.match(/(?:^|[_\-\s])(\d{1,2})[.\-](\d{1,2})[.\-](\d{2})(?!\d)/);
    if (m) {
      month = +m[1]; day = +m[2]; year = 2000 + +m[3]; dateRaw = m[0].replace(/^[_\-\s]/, '');
      issues.push(`short date "${dateRaw}" read as ${year}-${pad(month)}-${pad(day)}`);
      confidence = 'medium';
    }
  }

  // D: -04-029 / -05-01  (no year at all)
  if (!m) {
    m = work.match(/[-._](\d{1,2})[-._](\d{1,3})(?!\d)\s*$/);
    if (m) {
      month = +m[1]; day = +m[2].replace(/^0+(?=\d)/, ''); year = fallbackYear; dateRaw = m[0];
      issues.push(`no year in filename — assumed ${fallbackYear}`);
      confidence = 'medium';
    }
  }

  if (!dateRaw) {
    issues.push('no date found in filename');
    confidence = 'none';
  }

  // Sanity-check the calendar. Impossible dates get flagged, never silently fixed.
  let date = null;
  if (dateRaw) {
    if (month < 1 || month > 12) { issues.push(`month ${month} is out of range`); confidence = 'none'; }
    else if (day < 1 || day > 31) { issues.push(`day ${day} is out of range`); confidence = 'none'; }
    else {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (d.getUTCMonth() + 1 !== month) { issues.push(`${year}-${pad(month)}-${pad(day)} is not a real date`); confidence = 'none'; }
      else date = `${year}-${pad(month)}-${pad(day)}`;
    }
  }

  // Title = everything before the date, or the whole name if there wasn't one.
  let titlePart = dateRaw ? work.slice(0, work.indexOf(dateRaw)) : work;
  titlePart = titlePart.replace(/[._\-\s]+$/, '');
  const title = cleanTitle(titlePart) || cleanTitle(work) || base;

  return { title, date, year, month, day, dateRaw, confidence, issues };
}

/** Day-of-year number for the 365 grid. */
export function dayOfYear(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}
