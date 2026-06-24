'use strict';
/*
 * GDR station -> station -> checkout -> reports DATA-FLOW PROOF HARNESS
 * ---------------------------------------------------------------------------
 * Goal: PROVE (or disprove) that everything checked/recorded at each clinic
 * station correctly moves between stations and into reports/checkout.
 *
 * This harness drives the REAL modules (no mocks):
 *   - src/main/db.js      (master DB, mergeFromDrive / uploadPatient)
 *   - src/main/drive.js   (flash-drive transport, checksum-wrapped)
 *   - src/main/reports.js (computeStats over the master DB)
 *   - src/shared/model.js (record factories)
 *   - src/shared/codes.js (treatment classification)
 *
 * It models exactly what the renderer/IPC layer does at each station:
 *     1. read the patient off the drive          (drive.readPatient(dir).patient)
 *     2. mutate model.lastVisit(patient)
 *     3. bump visit.last_modified = model.nowISO()
 *     4. write the patient back to the drive      (drive.writePatient(dir, p))
 *     5. merge into the master DB                 (db.mergeFromDrive(p))
 *   Checkout instead sets visit_outcome then db.uploadPatient(p).
 *
 * The script is self-checking: it asserts and prints clear PASS/FAIL lines and
 * exits non-zero if ANY assertion fails. It does NOT modify any app source.
 *
 * Run:  node scripts/flow-test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../src/main/db');
const drive = require('../src/main/drive');
const reports = require('../src/main/reports');
const model = require('../src/shared/model');
const codes = require('../src/shared/codes');

// ---------------------------------------------------------------------------
// Tiny test runner
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];

function pass(msg) {
  passCount++;
  console.log('  PASS  ' + msg);
}

function fail(msg, expected, actual) {
  failCount++;
  const detail =
    expected !== undefined || actual !== undefined
      ? `\n           expected: ${stringify(expected)}\n           actual:   ${stringify(actual)}`
      : '';
  console.log('  FAIL  ' + msg + detail);
  failures.push(msg + (detail ? detail.replace(/\n\s+/g, ' ') : ''));
}

function stringify(v) {
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  return String(v);
}

// assertEqual with deep-ish equality for primitives + JSON for objects.
function eq(actual, expected, msg) {
  const a = typeof actual === 'object' ? JSON.stringify(actual) : actual;
  const e = typeof expected === 'object' ? JSON.stringify(expected) : expected;
  if (a === e) pass(msg);
  else fail(msg, expected, actual);
}

function truthy(actual, msg) {
  if (actual) pass(msg);
  else fail(msg, 'truthy', actual);
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

// ---------------------------------------------------------------------------
// Helpers that mirror the real renderer/IPC station behaviour
// ---------------------------------------------------------------------------

// A "drive" is just a folder. Each test gets its own under a temp root.
const ROOT = path.join(os.tmpdir(), 'gdr-flow-test-' + Date.now());
fs.mkdirSync(ROOT, { recursive: true });
let driveSeq = 0;
function newDriveDir() {
  const d = path.join(ROOT, 'drive-' + (++driveSeq));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Read the patient off a drive, fail loudly if the read did not round-trip.
function readDrive(dir, ctx) {
  const r = drive.readPatient(dir);
  if (!r.ok) {
    fail(`[${ctx}] drive.readPatient failed: ${r.reason}`);
    throw new Error(`drive read failed at ${ctx}: ${r.reason}`);
  }
  return r.patient;
}

// Write the patient to a drive, fail loudly if the checksum-verified write failed.
function writeDrive(dir, patient, ctx) {
  const w = drive.writePatient(dir, patient);
  if (!w.ok) {
    fail(`[${ctx}] drive.writePatient failed: ${w.reason}`);
    throw new Error(`drive write failed at ${ctx}: ${w.reason}`);
  }
  return w;
}

// Force a strictly-increasing last_modified. model.nowISO() has millisecond
// resolution; back-to-back station saves in a fast test can land in the same
// millisecond, which would make the merge's ">=" tie-breaks non-deterministic
// and hide real ordering bugs. We therefore sleep ~3ms between station saves so
// each save is genuinely "newer" than the last, exactly as it would be in the
// field where stations are seconds/minutes apart.
function tick() {
  const until = Date.now() + 3;
  while (Date.now() < until) { /* spin briefly */ }
}

// Assert a set of {field: value} pairs are present on the visit in BOTH the
// drive copy and the master-DB copy. `where` describes the station for output.
function assertVisitFieldsBothStores(dir, patientId, expectedFields, where) {
  const drivePatient = readDrive(dir, where + ' (drive verify)');
  const dbPatient = db.getPatient(patientId);
  truthy(dbPatient, `[${where}] patient exists in master DB`);
  const dv = model.lastVisit(drivePatient);
  const mv = dbPatient ? model.lastVisit(dbPatient) : null;
  truthy(dv, `[${where}] visit exists on drive`);
  truthy(mv, `[${where}] visit exists in master DB`);
  if (!dv || !mv) return;

  for (const key of Object.keys(expectedFields)) {
    const want = expectedFields[key];
    eq(dv[key], want, `[${where}] DRIVE visit.${key}`);
    eq(mv[key], want, `[${where}] DB    visit.${key}`);
  }
}

// Convenience: read report counts as a flat {key: count} map.
function reportCounts() {
  const stats = reports.computeStats({});
  const out = {};
  stats.rows.forEach((r) => { out[r.key] = r.count; });
  return out;
}

// Build the three dentist treatment items used throughout (19-OB complete,
// 18-ext complete, 3-O incomplete). Stable ids so merges are deterministic.
function dentistItems() {
  return [
    { id: 'item-19-OB', tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true },
    { id: 'item-18-ext', tooth: '18', treatment_type: 'extraction', surfaces: [], surgical: false, treating_today: true, complete: true },
    { id: 'item-3-O', tooth: '3', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false }
  ];
}

// ===========================================================================
// TEST 1 — HAPPY PATH (in clinical order), verifying after EVERY station
//          that every field set so far is present in BOTH drive and master.
// ===========================================================================
function test1_happyPath() {
  section('TEST 1 — HAPPY PATH (per-station drive+DB verification)');
  db._reset();
  const dir = newDriveDir();

  // ---- Station: CHECK-IN -------------------------------------------------
  // createPatient + visit shell + oh1 + drive.write, then merge.
  const created = db.createPatient({
    school_group: 'Escuela A', first_name: 'Juan', last_name: 'García',
    age_at_first_visit: 9, sex: 'M', drive_number: 7
  });
  const id = created.id;
  const visit = model.newVisit(created);
  visit.oh1_done = true;
  visit.station_status.checkin = true;
  visit.last_modified = model.nowISO();
  created.visits.push(visit);
  writeDrive(dir, created, 'checkin');
  db.mergeFromDrive(created);

  assertVisitFieldsBothStores(dir, id, {
    oh1_done: true
  }, 'after CHECK-IN');
  // station_status.checkin checked separately (nested object)
  eq(model.lastVisit(db.getPatient(id)).station_status.checkin, true, '[after CHECK-IN] DB station_status.checkin');

  // ---- Station: DENTIST --------------------------------------------------
  // exam E, clinician DDS/AB, items, cleaning_type P, oh2, tooth_conditions.
  tick();
  let pat = readDrive(dir, 'dentist load');
  let v = model.lastVisit(pat);
  v.exam_type = 'E';
  v.clinician_type = 'DDS';
  v.clinician_initials = 'AB';
  v.treatment_items = dentistItems();
  v.cleaning_type = 'P';
  v.oh2_done = true;
  v.tooth_conditions = { '19': 'healthy', '3': 'urgent' };
  v.station_status.dentist = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'dentist');
  db.mergeFromDrive(pat);

  assertVisitFieldsBothStores(dir, id, {
    oh1_done: true, exam_type: 'E', clinician_type: 'DDS', clinician_initials: 'AB',
    cleaning_type: 'P', oh2_done: true
  }, 'after DENTIST');
  // tooth_conditions + items present in both
  eq(db.getPatient(id) && model.lastVisit(db.getPatient(id)).tooth_conditions, { '19': 'healthy', '3': 'urgent' }, '[after DENTIST] DB tooth_conditions');
  eq(model.lastVisit(readDrive(dir, 'dentist verify')).tooth_conditions, { '19': 'healthy', '3': 'urgent' }, '[after DENTIST] DRIVE tooth_conditions');
  {
    const mvItems = model.lastVisit(db.getPatient(id)).treatment_items;
    eq(mvItems.length, 3, '[after DENTIST] DB has 3 treatment_items');
    const byId = {};
    mvItems.forEach((t) => { byId[t.id] = t; });
    eq(byId['item-19-OB'] && byId['item-19-OB'].complete, true, '[after DENTIST] DB 19-OB complete');
    eq(byId['item-18-ext'] && byId['item-18-ext'].complete, true, '[after DENTIST] DB 18-ext complete');
    eq(byId['item-3-O'] && byId['item-3-O'].complete, false, '[after DENTIST] DB 3-O incomplete');
  }

  // ---- Station: CLEANING -------------------------------------------------
  // cleaning_done + cleaning_done_at, then merge.
  tick();
  pat = readDrive(dir, 'cleaning load');
  v = model.lastVisit(pat);
  v.cleaning_done = true;
  v.cleaning_done_at = model.nowISO();
  v.station_status.cleaning = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'cleaning');
  db.mergeFromDrive(pat);

  assertVisitFieldsBothStores(dir, id, {
    oh1_done: true, exam_type: 'E', clinician_type: 'DDS', clinician_initials: 'AB',
    cleaning_type: 'P', oh2_done: true, cleaning_done: true
  }, 'after CLEANING');
  truthy(model.lastVisit(db.getPatient(id)).cleaning_done_at, '[after CLEANING] DB cleaning_done_at set');

  // ---- Station: FLUORIDE -------------------------------------------------
  // oh3 + fluoride_done, then merge.
  tick();
  pat = readDrive(dir, 'fluoride load');
  v = model.lastVisit(pat);
  v.oh3_done = true;
  v.fluoride_done = true;
  v.fluoride_done_at = model.nowISO();
  v.station_status.fluoride = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'fluoride');
  db.mergeFromDrive(pat);

  assertVisitFieldsBothStores(dir, id, {
    oh1_done: true, exam_type: 'E', clinician_type: 'DDS', clinician_initials: 'AB',
    cleaning_type: 'P', oh2_done: true, cleaning_done: true,
    oh3_done: true, fluoride_done: true
  }, 'after FLUORIDE');

  // ---- Station: CHECKOUT -------------------------------------------------
  // visit_outcome F, upload (stamps checkout_timestamp).
  tick();
  pat = readDrive(dir, 'checkout load');
  v = model.lastVisit(pat);
  v.visit_outcome = 'F';
  v.station_status.checkout = true;
  v.last_modified = model.nowISO();
  // checkout writes the outcome back to the drive then uploads (5.5)
  writeDrive(dir, pat, 'checkout');
  db.uploadPatient(pat);

  // After checkout: outcome + checkout stamp present in both stores.
  assertVisitFieldsBothStores(dir, id, {
    oh1_done: true, exam_type: 'E', clinician_type: 'DDS', clinician_initials: 'AB',
    cleaning_type: 'P', oh2_done: true, cleaning_done: true,
    oh3_done: true, fluoride_done: true, visit_outcome: 'F'
  }, 'after CHECKOUT');
  truthy(model.lastVisit(db.getPatient(id)).checkout_timestamp, '[after CHECKOUT] DB checkout_timestamp stamped');

  // ---- Reports assertions ------------------------------------------------
  const c = reportCounts();
  const expected = {
    fill_double: 1, ext_permanent: 1, cleaning_prophy: 1, cleaning_recommended: 1,
    fluoride: 1, fluoride_recommended: 1, oh_lessons: 3, total_patients: 1, nv_patients: 0
  };
  for (const k of Object.keys(expected)) {
    eq(c[k], expected[k], `[reports] ${k}`);
  }
  // sanity: the incomplete 3-O must NOT be counted as a filling
  eq(c.fill_single, 0, '[reports] fill_single (incomplete 3-O must NOT count)');
}

// ===========================================================================
// TEST 2 — OUT OF ORDER: fluoride saves BEFORE cleaning. No field lost.
// ===========================================================================
function test2_outOfOrder() {
  section('TEST 2 — OUT-OF-ORDER (fluoride before cleaning)');
  db._reset();
  const dir = newDriveDir();

  // check-in
  const created = db.createPatient({ first_name: 'Out', last_name: 'Order', age_at_first_visit: 10, sex: 'F', drive_number: 11 });
  const id = created.id;
  const visit = model.newVisit(created);
  visit.oh1_done = true;
  visit.station_status.checkin = true;
  visit.last_modified = model.nowISO();
  created.visits.push(visit);
  writeDrive(dir, created, 'checkin');
  db.mergeFromDrive(created);

  // dentist
  tick();
  let pat = readDrive(dir, 'dentist load');
  let v = model.lastVisit(pat);
  v.exam_type = 'E'; v.clinician_type = 'DDS'; v.clinician_initials = 'CD';
  v.treatment_items = dentistItems();
  v.cleaning_type = 'P'; v.oh2_done = true;
  v.station_status.dentist = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'dentist');
  db.mergeFromDrive(pat);

  // FLUORIDE FIRST (out of order)
  tick();
  pat = readDrive(dir, 'fluoride load');
  v = model.lastVisit(pat);
  v.oh3_done = true; v.fluoride_done = true; v.fluoride_done_at = model.nowISO();
  v.station_status.fluoride = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'fluoride');
  db.mergeFromDrive(pat);

  // CLEANING SECOND
  tick();
  pat = readDrive(dir, 'cleaning load');
  v = model.lastVisit(pat);
  v.cleaning_done = true; v.cleaning_done_at = model.nowISO();
  v.station_status.cleaning = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'cleaning');
  db.mergeFromDrive(pat);

  // After both merge, NOTHING lost from either station.
  const mv = model.lastVisit(db.getPatient(id));
  eq(mv.fluoride_done, true, '[out-of-order] fluoride_done survives later cleaning save');
  eq(mv.oh3_done, true, '[out-of-order] oh3_done survives later cleaning save');
  eq(mv.cleaning_done, true, '[out-of-order] cleaning_done present');
  eq(mv.oh2_done, true, '[out-of-order] oh2_done (dentist) still present');
  eq(mv.oh1_done, true, '[out-of-order] oh1_done (checkin) still present');
  eq(mv.exam_type, 'E', '[out-of-order] exam_type still present');
  eq(mv.clinician_initials, 'CD', '[out-of-order] clinician_initials still present');
  eq(mv.cleaning_type, 'P', '[out-of-order] cleaning_type still present');
  eq(mv.treatment_items.length, 3, '[out-of-order] all 3 treatment items present');
}

// ===========================================================================
// TEST 3 — STALE SUPERSET: a station loads an OLDER drive copy (missing a
//          field another station already merged to master), then merges.
//          The master must NOT lose the already-merged field, and reports
//          must NOT double count when the same visit is merged repeatedly.
// ===========================================================================
function test3_staleSuperset() {
  section('TEST 3 — STALE SUPERSET (field-merge protection + no double count)');
  db._reset();
  const dir = newDriveDir();

  // check-in
  const created = db.createPatient({ first_name: 'Stale', last_name: 'Copy', age_at_first_visit: 12, sex: 'M', drive_number: 21 });
  const id = created.id;
  const visit = model.newVisit(created);
  visit.oh1_done = true;
  visit.station_status.checkin = true;
  visit.last_modified = model.nowISO();
  created.visits.push(visit);
  writeDrive(dir, created, 'checkin');
  db.mergeFromDrive(created);

  // dentist saves a FULL plan (items + cleaning_type P + clinician) to master.
  tick();
  let pat = readDrive(dir, 'dentist load');
  let v = model.lastVisit(pat);
  v.exam_type = 'E'; v.clinician_type = 'DDS'; v.clinician_initials = 'EF';
  v.treatment_items = dentistItems();
  v.cleaning_type = 'P'; v.oh2_done = true;
  v.tooth_conditions = { '19': 'healthy', '3': 'urgent' };
  v.station_status.dentist = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'dentist');
  // Keep a deep snapshot of this full dentist copy = the "fresh" master state.
  const dentistFullCopy = JSON.parse(JSON.stringify(pat));
  db.mergeFromDrive(pat);

  // Sanity: master now has the dentist's work.
  eq(model.lastVisit(db.getPatient(id)).clinician_initials, 'EF', '[stale] master has clinician before stale merge');
  eq(model.lastVisit(db.getPatient(id)).treatment_items.length, 3, '[stale] master has 3 items before stale merge');

  // Now simulate the CLEANING station that had loaded an OLDER drive copy
  // (taken BEFORE the dentist wrote the plan), so it is MISSING the dentist's
  // treatment_items / clinician / cleaning_type. The station adds cleaning_done
  // and merges. Critically, its last_modified is NEWER (it saved later in wall
  // time) so it would win scalar tie-breaks.
  const olderCopy = JSON.parse(JSON.stringify(created)); // pre-dentist snapshot
  // ensure visit_id matches (same visit) — created already has the same visit_id
  const ov = model.lastVisit(olderCopy);
  eq(ov.visit_id, model.lastVisit(dentistFullCopy).visit_id, '[stale] older copy is the SAME visit_id');
  // The older copy has NO treatment items, default cleaning_type 'None',
  // empty clinician, etc. The station only set cleaning fields:
  tick();
  ov.cleaning_done = true;
  ov.cleaning_done_at = model.nowISO();
  ov.station_status.cleaning = true;
  ov.last_modified = model.nowISO(); // NEWER than dentist's save
  // (the station would also write this stale copy back to the drive; we mirror
  //  that, then merge — but the assertions below are about the MASTER DB.)
  writeDrive(dir, olderCopy, 'stale cleaning');
  db.mergeFromDrive(olderCopy);

  // FIELD-MERGE PROTECTION: master must STILL have the dentist's fields even
  // though the (newer) stale copy lacked them.
  const mv = model.lastVisit(db.getPatient(id));
  eq(mv.clinician_initials, 'EF', '[stale] FIELD-MERGE: clinician_initials NOT dropped by stale newer copy');
  eq(mv.exam_type, 'E', '[stale] FIELD-MERGE: exam_type NOT dropped');
  eq(mv.clinician_type, 'DDS', '[stale] FIELD-MERGE: clinician_type NOT dropped');
  eq(mv.cleaning_type, 'P', '[stale] FIELD-MERGE: cleaning_type NOT downgraded to None');
  eq(mv.treatment_items.length, 3, '[stale] FIELD-MERGE: treatment_items NOT dropped');
  eq(mv.tooth_conditions && mv.tooth_conditions['19'], 'healthy', '[stale] FIELD-MERGE: tooth_conditions NOT dropped');
  eq(mv.oh2_done, true, '[stale] FIELD-MERGE: oh2_done (dentist) NOT dropped');
  // and the cleaning station's own contribution is present:
  eq(mv.cleaning_done, true, '[stale] cleaning_done from stale copy applied');

  // NO DOUBLE COUNTING: complete fluoride + outcome, then merge the SAME visit
  // several more times. Counts must be identical each time (idempotent merge).
  tick();
  pat = readDrive(dir, 'fluoride load');
  v = model.lastVisit(pat);
  v.oh3_done = true; v.fluoride_done = true; v.fluoride_done_at = model.nowISO();
  v.visit_outcome = 'F';
  v.station_status.fluoride = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'fluoride');
  db.uploadPatient(pat); // checkout stamps + counts toward total_patients

  const first = reportCounts();
  // Re-merge the same drive copy three more times (simulating repeated saves /
  // a station re-uploading). This must be idempotent.
  for (let i = 0; i < 3; i++) {
    const again = readDrive(dir, 'repeat merge ' + i);
    db.mergeFromDrive(again);
  }
  const afterRepeats = reportCounts();

  for (const k of Object.keys(first)) {
    eq(afterRepeats[k], first[k], `[stale] no double-count on repeated merge: ${k}`);
  }
  // explicit single-patient expectations
  eq(afterRepeats.fill_double, 1, '[stale] fill_double exactly 1 after repeats');
  eq(afterRepeats.ext_permanent, 1, '[stale] ext_permanent exactly 1 after repeats');
  eq(afterRepeats.cleaning_prophy, 1, '[stale] cleaning_prophy exactly 1 after repeats');
  eq(afterRepeats.total_patients, 1, '[stale] total_patients exactly 1 after repeats');
  // exactly one patient, one visit
  eq(db.allPatients().length, 1, '[stale] still exactly 1 patient');
  eq(db.getPatient(id).visits.length, 1, '[stale] still exactly 1 visit');
}

// ===========================================================================
// TEST 4 — NV PENDING CARRY: a visit left NV with an incomplete item; next
//          session the dentist mints a NEW visit (new visit_id). The prior NV
//          visit must be preserved as its own visit (2 visits), the incomplete
//          item still on the prior visit, and reports count BOTH visits.
// ===========================================================================
function test4_nvCarry() {
  section('TEST 4 — NV PENDING CARRY (new visit, prior NV preserved)');
  db._reset();
  const dir = newDriveDir();

  // ---- SESSION 1: ends NV with an incomplete item -----------------------
  const created = db.createPatient({ first_name: 'En', last_name: 'Espera', age_at_first_visit: 8, sex: 'F', drive_number: 31 });
  const id = created.id;
  const visit1 = model.newVisit(created);
  visit1.visit_date = '2026-06-01';
  visit1.oh1_done = true;
  visit1.exam_type = 'E'; visit1.clinician_type = 'DDS'; visit1.clinician_initials = 'V1';
  // one completed extraction + one INCOMPLETE filling that carries to NV
  visit1.treatment_items = [
    { id: 's1-18-ext', tooth: '18', treatment_type: 'extraction', surfaces: [], surgical: false, treating_today: true, complete: true },
    { id: 's1-14-MO', tooth: '14', treatment_type: 'restoration', surfaces: ['M', 'O'], surgical: false, treating_today: true, complete: false }
  ];
  visit1.visit_outcome = 'NV';
  visit1.station_status.checkin = true;
  visit1.station_status.dentist = true;
  visit1.station_status.checkout = true;
  visit1.last_modified = model.nowISO();
  created.visits.push(visit1);
  const visit1Id = visit1.visit_id;
  writeDrive(dir, created, 'session1 checkout');
  db.uploadPatient(created); // checkout session 1

  // NV dashboard should list the patient with the outstanding 14-MO.
  const nv = db.listNV();
  eq(nv.length, 1, '[nv] session-1 patient appears on NV dashboard');
  if (nv.length) {
    const out = nv[0].outstanding.map((t) => t.id);
    truthy(out.indexOf('s1-14-MO') !== -1, '[nv] outstanding item 14-MO listed on NV dashboard');
  }

  // ---- SESSION 2: dentist mints a NEW visit (new visit_id) ---------------
  // The drive still carries the patient (with visit1). Renderer reads it, then
  // appends a brand-new visit for the new session.
  tick();
  const pat = readDrive(dir, 'session2 load');
  eq(pat.visits.length, 1, '[nv] drive carries the prior visit into session 2');
  const visit2 = model.newVisit(pat);
  visit2.visit_date = '2026-06-23';
  truthy(visit2.visit_id !== visit1Id, '[nv] session-2 visit has a NEW visit_id');
  visit2.oh1_done = true; visit2.oh2_done = true;
  visit2.exam_type = 'R'; visit2.clinician_type = 'DDS'; visit2.clinician_initials = 'V2';
  // completes a fresh filling this session
  visit2.treatment_items = [
    { id: 's2-19-OB', tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true }
  ];
  visit2.cleaning_type = 'P'; visit2.cleaning_done = true; visit2.cleaning_done_at = model.nowISO();
  visit2.fluoride_done = true; visit2.oh3_done = true;
  visit2.visit_outcome = 'F';
  visit2.station_status.checkin = true;
  visit2.station_status.dentist = true;
  visit2.station_status.checkout = true;
  visit2.last_modified = model.nowISO();
  pat.visits.push(visit2);
  writeDrive(dir, pat, 'session2 checkout');
  db.uploadPatient(pat);

  // ---- Assertions: BOTH visits preserved, prior NV intact ----------------
  const stored = db.getPatient(id);
  eq(stored.visits.length, 2, '[nv] master has exactly 2 visits (prior NV + new)');
  const byVid = {};
  stored.visits.forEach((vv) => { byVid[vv.visit_id] = vv; });
  truthy(byVid[visit1Id], '[nv] prior NV visit preserved by visit_id');
  truthy(byVid[visit2.visit_id], '[nv] new visit present by visit_id');
  if (byVid[visit1Id]) {
    eq(byVid[visit1Id].visit_outcome, 'NV', '[nv] prior visit still marked NV');
    const incomplete = (byVid[visit1Id].treatment_items || []).filter((t) => !t.complete).map((t) => t.id);
    truthy(incomplete.indexOf('s1-14-MO') !== -1, '[nv] incomplete 14-MO still on prior NV visit');
  }

  // ---- Reports count BOTH visits without merging them --------------------
  const c = reportCounts();
  // session1: 1 ext_permanent (18-ext complete); 14-MO incomplete => NOT counted
  // session2: 1 fill_double (19-OB)
  eq(c.ext_permanent, 1, '[nv] reports: ext_permanent from session 1');
  eq(c.fill_double, 1, '[nv] reports: fill_double from session 2');
  eq(c.fill_single, 0, '[nv] reports: incomplete 14-MO NOT counted as a filling');
  // total_patients counts each checked-out VISIT (both have checkout_timestamp)
  eq(c.total_patients, 2, '[nv] reports: total_patients counts BOTH checked-out visits');
  // nv_patients counts the one NV visit
  eq(c.nv_patients, 1, '[nv] reports: nv_patients counts the one NV visit');
  // cleaning + fluoride only happened in session 2
  eq(c.cleaning_prophy, 1, '[nv] reports: cleaning_prophy from session 2');
  eq(c.fluoride, 1, '[nv] reports: fluoride from session 2');
}

// ===========================================================================
// TEST 5 — TWO LAPTOP: checkout laptop starts EMPTY (db._reset). It reads ONLY
//          the drive (which carries all accumulated station work) and uploads.
//          Reports on the checkout laptop must show the FULL treatment even
//          though that laptop never saw the station saves.
// ===========================================================================
function test5_twoLaptop() {
  section('TEST 5 — TWO-LAPTOP (checkout laptop only ever sees the drive)');

  // ---- LAPTOP A: station laptop. Build up all the work on the drive. -----
  db._reset();
  const dir = newDriveDir();
  const created = db.createPatient({ first_name: 'Dos', last_name: 'Laptops', age_at_first_visit: 11, sex: 'M', drive_number: 41 });
  const driveNumber = 41;
  const visit = model.newVisit(created);
  visit.oh1_done = true; visit.station_status.checkin = true;
  visit.last_modified = model.nowISO();
  created.visits.push(visit);
  writeDrive(dir, created, 'A checkin');
  db.mergeFromDrive(created);

  // dentist
  tick();
  let pat = readDrive(dir, 'A dentist load');
  let v = model.lastVisit(pat);
  v.exam_type = 'E'; v.clinician_type = 'DDS'; v.clinician_initials = 'GH';
  v.treatment_items = dentistItems();
  v.cleaning_type = 'P'; v.oh2_done = true;
  v.tooth_conditions = { '19': 'healthy', '3': 'urgent' };
  v.station_status.dentist = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'A dentist');
  db.mergeFromDrive(pat);

  // cleaning
  tick();
  pat = readDrive(dir, 'A cleaning load');
  v = model.lastVisit(pat);
  v.cleaning_done = true; v.cleaning_done_at = model.nowISO();
  v.station_status.cleaning = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'A cleaning');
  db.mergeFromDrive(pat);

  // fluoride
  tick();
  pat = readDrive(dir, 'A fluoride load');
  v = model.lastVisit(pat);
  v.oh3_done = true; v.fluoride_done = true; v.fluoride_done_at = model.nowISO();
  v.station_status.fluoride = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'A fluoride');
  db.mergeFromDrive(pat);

  const patientNumberOnDrive = readDrive(dir, 'A snapshot').patient_number;

  // ---- LAPTOP B: checkout laptop. Simulate a SECOND, fresh laptop. -------
  // Per the harness note: outside Electron the master DB is a FIXED temp dir,
  // so db._reset() simulates a brand-new laptop that has NEVER seen this patient.
  db._reset();
  eq(db.allPatients().length, 0, '[two-laptop] checkout laptop starts empty');
  truthy(db.getPatientByNumber(patientNumberOnDrive) == null, '[two-laptop] checkout laptop does NOT know the patient yet');

  // Checkout reads ONLY the drive, sets outcome, uploads.
  tick();
  const fromDrive = readDrive(dir, 'B checkout load');
  const fv = model.lastVisit(fromDrive);
  // The checkout laptop sees ALL accumulated station work on the drive:
  eq(fv.exam_type, 'E', '[two-laptop] drive carries dentist exam_type to checkout laptop');
  eq(fv.cleaning_done, true, '[two-laptop] drive carries cleaning_done to checkout laptop');
  eq(fv.fluoride_done, true, '[two-laptop] drive carries fluoride_done to checkout laptop');
  eq(fv.treatment_items.length, 3, '[two-laptop] drive carries all treatment items');
  fv.visit_outcome = 'F';
  fv.station_status.checkout = true;
  fv.last_modified = model.nowISO();
  writeDrive(dir, fromDrive, 'B checkout');
  db.uploadPatient(fromDrive);

  // ---- Reports on the checkout laptop show the FULL treatment -------------
  const c = reportCounts();
  eq(c.fill_double, 1, '[two-laptop] reports: fill_double present on checkout laptop');
  eq(c.ext_permanent, 1, '[two-laptop] reports: ext_permanent present on checkout laptop');
  eq(c.cleaning_prophy, 1, '[two-laptop] reports: cleaning_prophy present on checkout laptop');
  eq(c.cleaning_recommended, 1, '[two-laptop] reports: cleaning_recommended present');
  eq(c.fluoride, 1, '[two-laptop] reports: fluoride present on checkout laptop');
  eq(c.fluoride_recommended, 1, '[two-laptop] reports: fluoride_recommended present');
  eq(c.oh_lessons, 3, '[two-laptop] reports: oh_lessons (1+2+3) present on checkout laptop');
  eq(c.total_patients, 1, '[two-laptop] reports: total_patients on checkout laptop');
  eq(c.nv_patients, 0, '[two-laptop] reports: nv_patients zero');
  // And the full record now lives in the checkout laptop's master DB.
  const stored = db.getPatientByNumber(patientNumberOnDrive);
  truthy(stored, '[two-laptop] patient now in checkout-laptop master DB');
  if (stored) {
    const mv = model.lastVisit(stored);
    truthy(mv.checkout_timestamp, '[two-laptop] checkout_timestamp stamped on checkout laptop');
    eq(mv.clinician_initials, 'GH', '[two-laptop] clinician carried via drive');
  }
}

// ===========================================================================
// TEST 6 — tooth_conditions + ALL *_done booleans survive a full round-trip
//          (write -> read -> merge -> read back), with every boolean toggled.
// ===========================================================================
function test6_roundTrip() {
  section('TEST 6 — tooth_conditions + all *_done booleans round-trip');
  db._reset();
  const dir = newDriveDir();

  const created = db.createPatient({ first_name: 'Round', last_name: 'Trip', age_at_first_visit: 9, sex: 'M', drive_number: 51 });
  const id = created.id;
  const visit = model.newVisit(created);
  // toggle EVERY boolean / done flag on, set rich tooth_conditions
  visit.oh1_done = true;
  visit.oh2_done = true;
  visit.oh3_done = true;
  visit.cleaning_done = true;
  visit.cleaning_done_at = model.nowISO();
  visit.fluoride_done = true;
  visit.fluoride_done_at = model.nowISO();
  visit.fluoride_recommended = true;
  visit.nt_status = true;
  visit.cleaning_type = 'D';
  visit.tooth_conditions = { '1': 'healthy', '2': 'watch', '3': 'urgent', 'a': 'watch', 't': 'urgent' };
  visit.station_status = { checkin: true, dentist: true, cleaning: true, fluoride: true, checkout: false };
  visit.last_modified = model.nowISO();
  created.visits.push(visit);

  // write -> read -> merge -> read back from master
  writeDrive(dir, created, 'roundtrip write');
  const readBack = readDrive(dir, 'roundtrip read');
  db.mergeFromDrive(readBack);
  const mv = model.lastVisit(db.getPatient(id));
  const dv = model.lastVisit(readDrive(dir, 'roundtrip verify drive'));

  const bools = ['oh1_done', 'oh2_done', 'oh3_done', 'cleaning_done', 'fluoride_done', 'fluoride_recommended', 'nt_status'];
  for (const b of bools) {
    eq(dv[b], true, `[roundtrip] DRIVE ${b} === true`);
    eq(mv[b], true, `[roundtrip] DB    ${b} === true`);
  }
  // tooth_conditions map preserved exactly in both stores
  const tc = { '1': 'healthy', '2': 'watch', '3': 'urgent', 'a': 'watch', 't': 'urgent' };
  eq(dv.tooth_conditions, tc, '[roundtrip] DRIVE tooth_conditions exact');
  eq(mv.tooth_conditions, tc, '[roundtrip] DB    tooth_conditions exact');
  // station_status booleans preserved
  eq(mv.station_status.checkin, true, '[roundtrip] station_status.checkin');
  eq(mv.station_status.dentist, true, '[roundtrip] station_status.dentist');
  eq(mv.station_status.cleaning, true, '[roundtrip] station_status.cleaning');
  eq(mv.station_status.fluoride, true, '[roundtrip] station_status.fluoride');
  // cleaning_type survived
  eq(mv.cleaning_type, 'D', '[roundtrip] cleaning_type D survived');
}

// ===========================================================================
// Run all tests
// ===========================================================================
(function main() {
  console.log('GDR DATA-FLOW PROOF HARNESS');
  console.log('master DB dir:', require('../src/main/paths').base());
  console.log('drive root:   ', ROOT);

  const tests = [
    test1_happyPath,
    test2_outOfOrder,
    test3_staleSuperset,
    test4_nvCarry,
    test5_twoLaptop,
    test6_roundTrip
  ];

  for (const t of tests) {
    try {
      t();
    } catch (e) {
      failCount++;
      console.log('  FAIL  [' + t.name + '] threw: ' + (e && e.stack ? e.stack : e));
      failures.push(t.name + ' threw: ' + (e && e.message ? e.message : e));
    }
  }

  console.log('\n=========================================================');
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    console.log('\nFAILURES:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('\nVERDICT: data flow is NOT fully correct (see failures above).');
    process.exit(1);
  } else {
    console.log('\nVERDICT: station -> station -> checkout -> reports data flow is FULLY CORRECT.');
    process.exit(0);
  }
})();
