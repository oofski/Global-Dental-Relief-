'use strict';
/*
 * Flash-drive file integrity (spec 10.3).
 * A patient file written to a USB drive is wrapped in an envelope carrying a
 * checksum over the canonical JSON of the payload. On read we recompute and
 * compare so an incomplete / corrupted write can be detected and the station
 * can fall back to manual entry instead of crashing.
 *
 * Uses Node's crypto when available (main process); falls back to a small FNV
 * hash so the same function works everywhere.
 */

let crypto = null;
try { crypto = require('crypto'); } catch (_) { /* renderer w/o node */ }

// Deterministic JSON: sort object keys recursively so the checksum is stable.
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',')}}`;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

function checksum(payload) {
  const c = canonical(payload);
  if (crypto) return crypto.createHash('sha256').update(c).digest('hex');
  return 'fnv1a-' + fnv1a(c);
}

const ENVELOPE_VERSION = 1;

/** Wrap a patient payload for writing to the flash drive. */
function wrap(payload) {
  return {
    _gdr_envelope: ENVELOPE_VERSION,
    checksum: checksum(payload),
    written_at: new Date().toISOString(),
    payload
  };
}

/**
 * Validate and unwrap a flash-drive envelope.
 * Returns { ok, payload, reason }.
 */
function unwrap(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, reason: 'empty' };
  // Tolerate raw (un-enveloped) files for forward/backward compatibility.
  if (!('_gdr_envelope' in obj)) {
    if (obj.id && obj.patient_number != null) return { ok: true, payload: obj, reason: 'raw' };
    return { ok: false, reason: 'unknown_format' };
  }
  if (!obj.payload) return { ok: false, reason: 'no_payload' };
  const expect = checksum(obj.payload);
  if (expect !== obj.checksum) return { ok: false, reason: 'checksum_mismatch', payload: obj.payload };
  return { ok: true, payload: obj.payload };
}

module.exports = { checksum, canonical, wrap, unwrap, ENVELOPE_VERSION };
