'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const config = require('./config');
const model = require('../shared/model');

/*
 * Master database — local JSON embedded store (spec 4 + 8.3 + 10.4).
 *
 * The same store powers every station's local cache; on the Checkout laptop it
 * IS the authoritative "master database" (spec 2.3). Schema is intentionally
 * flat and sync-friendly (unique ids, last_modified, synced flag) so Phase 2
 * can lift it into SQLite / a server with no migration.
 *
 * Atomic writes: we write to a temp file then rename, so a crash mid-write
 * never corrupts the master record.
 */

let store = null;

function blank() {
  return {
    schema_version: model.SCHEMA_VERSION,
    created_at: model.nowISO(),
    last_modified: model.nowISO(),
    counter: 0,           // last assigned patient_number
    patients: {},         // id -> patient
    drives: {}            // driveNumber -> { status, patient_id, assigned_at, cleared_at }
  };
}

function load() {
  if (store) return store;
  const file = paths.masterFile();
  try {
    if (fs.existsSync(file)) {
      store = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!store.patients) store.patients = {};
      if (!store.drives) store.drives = {};
      if (store.counter == null) store.counter = 0;
    } else {
      store = blank();
      persist();
    }
  } catch (e) {
    // Corrupt master: back it up and start clean rather than crash (10.3 spirit).
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.corrupt-' + Date.now());
    } catch (_) {}
    store = blank();
    persist();
  }
  return store;
}

function persist() {
  const s = load.length ? store : store; // ensure loaded
  const dir = paths.master();
  paths.ensure(dir);
  s.last_modified = model.nowISO();
  const file = paths.masterFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// ---- Patient numbering --------------------------------------------------
function maxExistingNumber() {
  const s = load();
  let mx = 0;
  for (const id of Object.keys(s.patients)) {
    const n = Number(s.patients[id].patient_number) || 0;
    if (n > mx) mx = n;
  }
  return mx;
}

function peekNextNumber() {
  const s = load();
  const cfg = config.load();
  const floor = (cfg.patient_number_start || 1) - 1;
  return Math.max(s.counter, maxExistingNumber(), floor) + 1;
}

function assignNumber() {
  const s = load();
  const n = peekNextNumber();
  s.counter = n;
  persist();
  return n;
}

// ---- CRUD ---------------------------------------------------------------
function createPatient(fields) {
  const p = model.newPatient(fields);
  p.patient_number = assignNumber();
  const s = load();
  s.patients[p.id] = p;
  if (fields && fields.drive_number != null) logDrive(fields.drive_number, 'assigned', p.id);
  persist();
  return p;
}

function savePatient(patient) {
  if (!patient || !patient.id) throw new Error('savePatient: missing id');
  const s = load();
  model.touch(patient);
  s.patients[patient.id] = patient;
  persist();
  return patient;
}

/**
 * Upload / upsert a completed patient file from a flash drive into the master
 * DB (checkout, spec 5.5 Screen C). Matches by id, falling back to
 * patient_number. Stamps checkout_timestamp on the most recent visit if not set.
 */
function uploadPatient(incoming) {
  if (!incoming) throw new Error('uploadPatient: empty');
  const s = load();
  let existing = s.patients[incoming.id];
  if (!existing && incoming.patient_number != null) {
    existing = Object.values(s.patients).find((p) => p.patient_number === incoming.patient_number) || null;
  }
  const merged = mergePatient(existing, incoming);

  // Stamp checkout on the latest visit if checkout didn't already.
  const v = model.lastVisit(merged);
  if (v && !v.checkout_timestamp) v.checkout_timestamp = model.nowISO();
  merged.synced = false;
  model.touch(merged);

  s.patients[merged.id] = merged;
  if (merged.drive_number != null) logDrive(merged.drive_number, 'in_use', merged.id);
  persist();
  return merged;
}

// Merge incoming patient over existing, unioning visits by visit_id and never
// overwriting static identity fields (age_at_first_visit, created_date).
function mergePatient(existing, incoming) {
  if (!existing) return JSON.parse(JSON.stringify(incoming));
  const merged = JSON.parse(JSON.stringify(existing));
  // Updatable identity/contact
  ['school_group', 'first_name', 'last_name', 'sex', 'drive_number', 'prior_paper_history']
    .forEach((k) => { if (incoming[k] != null && incoming[k] !== '') merged[k] = incoming[k]; });
  // STATIC fields preserved (4.1): age_at_first_visit, created_date, patient_number, id
  // Medical history: take the most recently modified
  if (incoming.medical_history) {
    const a = existing.medical_history && existing.medical_history.last_modified;
    const b = incoming.medical_history.last_modified;
    if (!a || (b && b >= a)) merged.medical_history = incoming.medical_history;
  }
  if (incoming.consent && incoming.consent.signed) merged.consent = incoming.consent;
  // Visits union by visit_id
  const byId = {};
  (merged.visits || []).forEach((v) => { byId[v.visit_id] = v; });
  (incoming.visits || []).forEach((v) => { byId[v.visit_id] = v; });
  merged.visits = Object.values(byId).sort((x, y) => (x.visit_date || '').localeCompare(y.visit_date || ''));
  return merged;
}

function getPatient(id) {
  return load().patients[id] || null;
}

function getPatientByNumber(num) {
  const n = Number(num);
  return Object.values(load().patients).find((p) => Number(p.patient_number) === n) || null;
}

/**
 * Returning-patient search (spec 7.1) — by patient number or name fragment.
 * Returns summary cards.
 */
function searchPatients(query) {
  const s = load();
  const q = String(query || '').trim().toLowerCase();
  let list = Object.values(s.patients);
  if (q) {
    list = list.filter((p) => {
      if (String(p.patient_number) === q) return true;
      const name = model.fullName(p).toLowerCase();
      return name.includes(q) || (p.school_group || '').toLowerCase().includes(q);
    });
  }
  list.sort((a, b) => (b.last_modified || '').localeCompare(a.last_modified || ''));
  return list.slice(0, 50).map(summary);
}

function summary(p) {
  const v = model.lastVisit(p);
  return {
    id: p.id,
    patient_number: p.patient_number,
    first_name: p.first_name,
    last_name: p.last_name,
    name: model.fullName(p),
    age_at_first_visit: p.age_at_first_visit,
    school_group: p.school_group,
    sex: p.sex,
    last_visit_date: v ? v.visit_date : null,
    last_outcome: v ? v.visit_outcome : null,
    has_pending: !!(v && v.visit_outcome === 'NV'),
    pending_items: v && v.visit_outcome === 'NV'
      ? (v.treatment_items || []).filter((t) => !t.complete).map((t) => t)
      : []
  };
}

function allPatients() {
  return Object.values(load().patients);
}

// ---- NV recall dashboard (7.3 / 5.5 Screen B) ---------------------------
function listNV() {
  const s = load();
  const out = [];
  for (const p of Object.values(s.patients)) {
    const v = model.lastVisit(p);
    if (v && v.visit_outcome === 'NV') {
      const stamp = v.checkout_timestamp || v.last_modified;
      out.push({
        id: p.id,
        patient_number: p.patient_number,
        name: model.fullName(p),
        school_group: p.school_group,
        marked_at: stamp,
        outstanding: (v.treatment_items || []).filter((t) => !t.complete).map((t) => ({ ...t })),
        treatment_notes: v.treatment_notes || ''
      });
    }
  }
  // longest waiting first
  out.sort((a, b) => (a.marked_at || '').localeCompare(b.marked_at || ''));
  return out;
}

// ---- Drive log (2.2) ----------------------------------------------------
function logDrive(num, status, patientId) {
  const s = load();
  const key = String(num);
  s.drives[key] = Object.assign({}, s.drives[key], {
    number: num,
    status, // 'assigned' | 'in_use' | 'available'
    patient_id: status === 'available' ? null : (patientId || (s.drives[key] && s.drives[key].patient_id) || null),
    assigned_at: status === 'assigned' ? model.nowISO() : (s.drives[key] && s.drives[key].assigned_at) || null,
    cleared_at: status === 'available' ? model.nowISO() : (s.drives[key] && s.drives[key].cleared_at) || null
  });
  persist();
  return s.drives[key];
}

function listDrives() {
  return Object.values(load().drives).sort((a, b) => Number(a.number) - Number(b.number));
}

// ---- Import / Export (8.3) ---------------------------------------------
function importMaster(jsonText) {
  let incoming;
  try { incoming = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText; }
  catch (e) { return { ok: false, error: 'invalid_json' }; }
  const s = load();
  let patients = [];
  if (incoming.patients && !Array.isArray(incoming.patients)) patients = Object.values(incoming.patients);
  else if (Array.isArray(incoming.patients)) patients = incoming.patients;
  else if (Array.isArray(incoming)) patients = incoming;
  let added = 0, updated = 0;
  for (const p of patients) {
    if (!p || !p.id) continue;
    if (s.patients[p.id]) { s.patients[p.id] = mergePatient(s.patients[p.id], p); updated++; }
    else { s.patients[p.id] = p; added++; }
  }
  s.counter = Math.max(s.counter, maxExistingNumber());
  persist();
  return { ok: true, added, updated, total: Object.keys(s.patients).length };
}

function exportMaster() {
  const s = load();
  return {
    schema_version: s.schema_version,
    exported_at: model.nowISO(),
    deployment: config.load().deployment_label || '',
    counter: s.counter,
    patients: Object.values(s.patients)
  };
}

/**
 * Clear all patient records on this machine (start a new ledger / clinic day).
 * Destructive — callers MUST back up first (the IPC layer auto-exports a backup).
 * opts.resetCounter resets patient numbering to config.patient_number_start.
 */
function clearAllPatients(opts) {
  const s = load();
  const removed = Object.keys(s.patients).length;
  s.patients = {};
  s.drives = {};
  if (opts && opts.resetCounter) {
    const start = (config.load().patient_number_start || 1) - 1;
    s.counter = Math.max(0, start);
  }
  persist();
  return { removed, counter: s.counter };
}

// For tests / reset
function _reset() {
  store = blank();
  try { persist(); } catch (_) {}
}

module.exports = {
  load,
  persist,
  peekNextNumber,
  assignNumber,
  createPatient,
  savePatient,
  uploadPatient,
  getPatient,
  getPatientByNumber,
  searchPatients,
  summary,
  allPatients,
  clearAllPatients,
  listNV,
  logDrive,
  listDrives,
  importMaster,
  exportMaster,
  mergePatient,
  _reset
};
