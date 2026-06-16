'use strict';
/*
 * Dental charting code engine for GDR.
 * Pure functions only (no Node/fs) so it can be required by the main process
 * AND exposed to the renderer via the preload contextBridge. Single source of
 * truth for tooth definitions, surface/treatment codes, code-string formatting,
 * and treatment classification used by the reporting module.
 *
 * Reference: Product Overview & Engineering Spec V1.0, sections 6 and 8.
 */

// ---- Tooth definitions --------------------------------------------------

// Universal (adult) numbering 1-32. Upper arch 1-16 (patient right -> left),
// lower arch 17-32 (patient left -> right). We render upper as 1..16 and lower
// as 32..17 so the chart reads anatomically (right molars on the outside).
const ADULT_UPPER = Array.from({ length: 16 }, (_, i) => String(i + 1));        // 1..16
const ADULT_LOWER = Array.from({ length: 16 }, (_, i) => String(32 - i));       // 32..17

// Primary (baby) lettering a-t (lowercase per spec). Upper a..j, lower t..k.
const LETTERS = 'abcdefghijklmnopqrst'.split('');
const PRIMARY_UPPER = LETTERS.slice(0, 10);                                     // a..j
const PRIMARY_LOWER = LETTERS.slice(10).slice().reverse();                      // t..k

// Surface codes (6.2). Ordered so combined codes render consistently.
const SURFACES = [
  { code: 'M', es: 'Mesial' },
  { code: 'O', es: 'Oclusal' },
  { code: 'D', es: 'Distal' },
  { code: 'B', es: 'Bucal' },
  { code: 'L', es: 'Lingual' },
  { code: 'F', es: 'Facial' }
];
const SURFACE_ORDER = ['D', 'O', 'M', 'B', 'L', 'F']; // common dental ordering (e.g. DOB)

// Treatment types (6.3 / 5.2 Screen C).
const TREATMENTS = [
  { key: 'restoration', es: 'Restauración (empaste)', needsSurfaces: true },
  { key: 'composite',   es: 'Composite (estético)',   needsSurfaces: true },
  { key: 'extraction',  es: 'Extracción',             needsSurfaces: false },
  { key: 'sealant',     es: 'Sellante',               needsSurfaces: false },
  { key: 'sdf',         es: 'SDF (flúor diamino plata)', needsSurfaces: false }
];

function isPrimaryTooth(tooth) {
  return typeof tooth === 'string' && /^[a-t]$/i.test(tooth.trim());
}

function sortSurfaces(surfaces) {
  const s = Array.from(new Set((surfaces || []).map((x) => String(x).toUpperCase())));
  return s.sort((a, b) => SURFACE_ORDER.indexOf(a) - SURFACE_ORDER.indexOf(b));
}

/**
 * Build the canonical code string for a structured treatment item.
 * Examples: 19-OB, 18-ext, a-ext, 20-extS, 31-seal, 30-SDF, 15-OB comp.
 */
function formatItem(item) {
  if (!item || !item.tooth || !item.treatment_type) return '';
  const tooth = String(item.tooth).trim();
  const t = item.treatment_type;
  const surf = sortSurfaces(item.surfaces).join('');
  switch (t) {
    case 'extraction':
      return item.surgical ? `${tooth}-extS` : `${tooth}-ext`;
    case 'sealant':
      return `${tooth}-seal`;
    case 'sdf':
      return `${tooth}-SDF`;
    case 'composite':
      return surf ? `${tooth}-${surf} comp` : `${tooth} comp`;
    case 'restoration':
    default:
      return surf ? `${tooth}-${surf}` : `${tooth}`;
  }
}

/**
 * Classify a single structured treatment item into a reporting bucket.
 * Returns one of the report keys (see reports.js) or null.
 */
function classifyItem(item) {
  if (!item || !item.treatment_type) return null;
  switch (item.treatment_type) {
    case 'extraction':
      if (item.surgical) return 'ext_surgical';
      return isPrimaryTooth(item.tooth) ? 'ext_primary' : 'ext_permanent';
    case 'sealant':
      return 'sealant';
    case 'sdf':
      return 'sdf';
    case 'composite':
      return 'composite';
    case 'restoration': {
      const n = sortSurfaces(item.surfaces).length;
      if (n >= 3) return 'fill_multi';
      if (n === 2) return 'fill_double';
      return 'fill_single';
    }
    default:
      return null;
  }
}

/**
 * Fallback parser: classify a free-text code token (treatment_notes) per 6.3 / 8.1.
 * Handles tokens like "19-OB", "18-ext", "a-ext", "20-extS", "31-seal",
 * "30-SDF", "15-OB comp". Returns a report key or null.
 */
function classifyToken(rawToken) {
  if (!rawToken) return null;
  let token = String(rawToken).trim();
  if (!token) return null;
  const lower = token.toLowerCase();
  if (lower === 'nt') return null;

  // composite (e.g. "15-OB comp")
  if (/\bcomp\b/i.test(token)) return 'composite';

  // surgical extraction
  if (/-exts$/i.test(token)) return 'ext_surgical';

  // extraction
  const extMatch = token.match(/^([0-9]{1,2}|[a-t])\s*-?\s*ext$/i);
  if (extMatch) {
    const id = extMatch[1];
    return /^[a-t]$/i.test(id) ? 'ext_primary' : 'ext_permanent';
  }

  if (/-seal$/i.test(token)) return 'sealant';
  if (/-sdf$/i.test(token)) return 'sdf';

  // restoration with surfaces e.g. 19-OB, 8-F, 20-O (strip leading/trailing slash = "done")
  const restMatch = token.replace(/\//g, '').match(/^([0-9]{1,2}|[a-t])-([OMDBLF]+)$/i);
  if (restMatch) {
    const n = sortSurfaces(restMatch[2].split('')).length;
    if (n >= 3) return 'fill_multi';
    if (n === 2) return 'fill_double';
    return 'fill_single';
  }
  return null;
}

/** Split a treatment_notes blob into individual code tokens. */
function tokenizeNotes(notes) {
  if (!notes) return [];
  return String(notes)
    .split(/[\s,;\n\r]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

module.exports = {
  ADULT_UPPER,
  ADULT_LOWER,
  PRIMARY_UPPER,
  PRIMARY_LOWER,
  SURFACES,
  SURFACE_ORDER,
  TREATMENTS,
  isPrimaryTooth,
  sortSurfaces,
  formatItem,
  classifyItem,
  classifyToken,
  tokenizeNotes
};
