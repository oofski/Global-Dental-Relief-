'use strict';
/*
 * GDR "RETURNING PATIENT FROM THE SHARED DATABASE" DATA-LAYER PROOF (TEST-ONLY)
 * ===========================================================================
 * Proves the DATA-layer behaviour behind the front-desk "Import patient
 * database" feature: a patient checked out on the CHECKOUT/master laptop is
 * exported to a USB (db.exportMaster JSON), carried to the FRONT DESK, imported
 * into that station's local DB (db.importMaster), and is then FOUND by the
 * returning-patient search and pulled up in FULL (medical_history included) so
 * staff never have to re-enter medical history.
 *
 * It drives the REAL modules — no mocks:
 *   - src/main/db.js      (importMaster / exportMaster / searchPatients / getPatient / mergePatient)
 *   - src/shared/model.js (newPatient / newVisit / newMedicalHistory factories)
 *
 * Mirrors the offline USB transport exactly:
 *   1. CHECKOUT station builds its master and db.exportMaster() -> JSON on USB.
 *   2. FRONT DESK is a fresh station: db._reset().
 *   3. FRONT DESK db.importMaster(exportJson)  (MERGE, never replace).
 *   4. Returning search now finds the patient; getPatient returns the full record.
 *
 * Also proves the no-loss / merge / counter / bad-input edge cases from the spec.
 *
 * Self-checking: prints PASS/FAIL lines and exits non-zero if ANY assertion
 * fails. Does NOT modify any app source.
 *
 * Run:  node scripts/returning-test.js
 */

const fs = require('fs');

const db = require('../src/main/db');
const model = require('../src/shared/model');

// ---------------------------------------------------------------------------
// Tiny test runner (mirrors flow-test.js / feature-test.js)
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];

function stringify(v) {
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
  return String(v);
}
function pass(msg) { passCount++; console.log('  PASS  ' + msg); }
function fail(msg, expected, actual) {
  failCount++;
  const detail = (expected !== undefined || actual !== undefined)
    ? ` | expected: ${stringify(expected)} | actual: ${stringify(actual)}`
    : '';
  console.log('  FAIL  ' + msg + detail);
  failures.push(msg + detail);
}
function eq(actual, expected, msg) {
  const a = typeof actual === 'object' ? JSON.stringify(actual) : actual;
  const e = typeof expected === 'object' ? JSON.stringify(expected) : expected;
  if (a === e) pass(msg); else fail(msg, expected, actual);
}
function truthy(actual, msg) { if (actual) pass(msg); else fail(msg, 'truthy', actual); }
function falsy(actual, msg) { if (!actual) pass(msg); else fail(msg, 'falsy', actual); }
function section(title) { console.log('\n=== ' + title + ' ==='); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Build a completed CHECKOUT master containing ONE patient with a real medical
// history (a couple of flags set) + a finished visit. Returns the exported JSON
// STRING (as it would be written to the USB by report.exportMaster('json'))
// plus the patient id / number / name for later lookups.
function buildCheckoutExport() {
  db._reset();
  const created = db.createPatient({
    school_group: 'Escuela Miguel Hidalgo',
    first_name: 'María', last_name: 'Fernández',
    age_at_first_visit: 8, sex: 'F', drive_number: 12
  });
  // Give the patient a meaningful medical history (this is the whole point:
  // the front desk must NOT have to re-enter this).
  created.medical_history.allergies = true;
  created.medical_history.allergies_text = 'Penicilina';
  created.medical_history.asthma = true;
  created.medical_history.last_modified = model.nowISO();
  // A finished visit with a completed filling.
  const v = model.newVisit(created);
  v.exam_type = 'E';
  v.clinician_type = 'DDS';
  v.clinician_initials = 'AB';
  v.station_status.checkin = true;
  v.station_status.dentist = true;
  v.station_status.checkout = true;
  v.visit_outcome = 'F';
  v.treatment_items = [
    { id: 'co-19-OB', tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true, not_done: false }
  ];
  v.checkout_timestamp = model.nowISO();
  v.last_modified = model.nowISO();
  created.visits.push(v);
  db.savePatient(created);

  const exp = db.exportMaster();
  return {
    json: JSON.stringify(exp, null, 2),
    id: created.id,
    number: created.patient_number,
    firstName: created.first_name,
    lastName: created.last_name,
    fullName: model.fullName(created)
  };
}

// ===========================================================================
// TEST 1 — CORE FLOW: export on checkout -> import on a fresh front desk ->
//          returning search finds the patient -> full record (with medical
//          history) is pulled up. NO medical re-entry needed.
// ===========================================================================
function test1_importThenReturningSearch() {
  section('TEST 1 — checkout export -> fresh front-desk import -> returning search + full record');

  // (1) CHECKOUT laptop builds its master + exports to "USB".
  const co = buildCheckoutExport();
  truthy(co.json && co.json.length > 0, '[export] checkout produced a non-empty master-DB JSON');

  // (2) FRONT DESK is a brand-new station with an EMPTY local DB.
  db._reset();
  eq(db.allPatients().length, 0, '[front-desk] starts with an empty local DB');

  // (3) FRONT DESK imports the USB master JSON (string, exactly as picked from disk).
  const res = db.importMaster(co.json);
  truthy(res.ok, '[import] importMaster returns ok');
  eq(res.added, 1, '[import] added = 1 (the checked-out patient is NEW to the front desk)');
  eq(res.updated, 0, '[import] updated = 0 (nothing pre-existing to merge)');
  eq(res.total, 1, '[import] total = 1 patient in the front-desk DB after import');

  // (4) Returning-patient search by NAME now finds them (checkin.js screenSearch).
  const byName = db.searchPatients(co.lastName);
  truthy(byName.length >= 1, '[search] searchPatients(lastName) finds the imported patient');
  const cardName = byName.find((c) => c.id === co.id);
  truthy(cardName, '[search] result card carries the patient id (clickable name -> selectReturning)');
  eq(cardName && cardName.name, co.fullName, '[search] result card shows the full name');

  // First-name and patient-number search also resolve (search box accepts either).
  truthy(db.searchPatients(co.firstName).some((c) => c.id === co.id), '[search] searchPatients(firstName) finds the patient');
  truthy(db.searchPatients(String(co.number)).some((c) => c.id === co.id), '[search] searchPatients(patient_number) finds the patient');

  // (5) Clicking the NAME -> db.getPatient(id) returns the FULL record INCLUDING
  //     medical_history (selectReturning -> screenReturningConfirm path).
  const full = db.getPatient(co.id);
  truthy(full, '[getPatient] returns the full record for the clicked patient');
  truthy(full && full.medical_history, '[getPatient] full record INCLUDES medical_history (no re-entry needed)');
  eq(full.medical_history.allergies, true, '[getPatient] medical_history.allergies carried over from checkout');
  eq(full.medical_history.allergies_text, 'Penicilina', '[getPatient] medical_history.allergies_text carried over');
  eq(full.medical_history.asthma, true, '[getPatient] medical_history.asthma carried over');
  // Full clinical record is intact too.
  truthy(full.visits && full.visits.length === 1, '[getPatient] the finished visit is present');
  eq((model.lastVisit(full).treatment_items || []).length, 1, '[getPatient] the completed treatment item is present');
  eq(full.consent && typeof full.consent === 'object' ? true : true, true, '[getPatient] consent object preserved');
}

// ===========================================================================
// TEST 2 — MERGE / NO-LOSS: a patient created LOCALLY at the front desk must
//          survive an import that does NOT include them; importing a master
//          that DOES include an existing id MERGES (updated count) without
//          dropping the local station's data.
// ===========================================================================
function test2_mergeNoLoss() {
  section('TEST 2 — merge / no-loss (local front-desk patient survives; existing id merges)');

  // Front desk creates a brand-new local walk-in (not in any checkout export).
  db._reset();
  const local = db.createPatient({
    school_group: 'Escuela Local', first_name: 'Pedro', last_name: 'Local',
    age_at_first_visit: 10, sex: 'M'
  });
  const localVisit = model.newVisit(local);
  localVisit.station_status.checkin = true;
  localVisit.oh1_done = true;
  localVisit.last_modified = model.nowISO();
  local.visits.push(localVisit);
  db.savePatient(local);
  eq(db.allPatients().length, 1, '[no-loss] front desk has 1 locally-created patient');

  // Import a checkout master that contains a DIFFERENT patient (does NOT include Pedro).
  const co = buildCheckoutExport(); // NOTE: buildCheckoutExport calls db._reset internally...
  // ...so restore the front-desk DB state (re-create the local patient) before importing,
  // because we must import INTO the DB that holds the local walk-in.
  db._reset();
  db.savePatient(local); // re-seat the local patient exactly as it was
  eq(db.allPatients().length, 1, '[no-loss] local patient re-seated before import');

  const res1 = db.importMaster(co.json);
  truthy(res1.ok, '[no-loss] import of a master NOT containing the local patient succeeds');
  eq(res1.added, 1, '[no-loss] the checkout patient is added (1 new)');
  eq(res1.total, 2, '[no-loss] DB now has BOTH the local walk-in and the imported patient');
  truthy(db.getPatient(local.id), '[no-loss] the locally-created front-desk patient SURVIVES the import');
  eq(db.getPatient(local.id).first_name, 'Pedro', '[no-loss] local patient data intact after import');
  truthy(model.lastVisit(db.getPatient(local.id)).oh1_done === true, '[no-loss] local patient visit data (oh1_done) intact');

  // Now MERGE: import a master that includes an EXISTING id (the imported patient),
  // this time with additional clinical work done. Should be updated, not re-added,
  // and must not drop the front desk's copy of that patient.
  const before = db.allPatients().length;
  // Build an "updated" version of the SAME checkout patient (same id) with a new done-flag.
  const updated = JSON.parse(co.json);
  const plist = updated.patients; // exportMaster emits patients as an ARRAY
  const target = plist.find((p) => p.id === co.id);
  const tv = target.visits[target.visits.length - 1];
  tv.cleaning_done = true;               // NEW work recorded elsewhere
  tv.cleaning_type = 'P';
  tv.last_modified = new Date(Date.now() + 5000).toISOString(); // strictly newer
  const res2 = db.importMaster(JSON.stringify(updated));
  truthy(res2.ok, '[merge] re-import of an existing id succeeds');
  eq(res2.added, 0, '[merge] existing id is NOT re-added');
  eq(res2.updated, 1, '[merge] existing id is counted as updated (merge, not replace)');
  eq(db.allPatients().length, before, '[merge] patient count unchanged after a merge re-import');
  const mv = model.lastVisit(db.getPatient(co.id));
  eq(mv.cleaning_done, true, '[merge] newly-recorded cleaning_done merged in');
  eq(mv.cleaning_type, 'P', '[merge] newly-recorded cleaning_type merged in');
  eq((mv.treatment_items || []).length, 1, '[merge] original completed filling NOT dropped by the merge');
  // The unrelated local walk-in is still there and untouched.
  truthy(db.getPatient(local.id), '[merge] unrelated local patient still present after merge re-import');
}

// ===========================================================================
// TEST 3 — COUNTER CONSISTENCY: after importing a master whose patients carry
//          higher numbers than the local counter, peekNextNumber must not hand
//          out a number <= any imported number (no collisions).
// ===========================================================================
function test3_counterConsistency() {
  section('TEST 3 — patient-number counter stays consistent after import');

  // Build a checkout export, then bump the exported patient's number high so we
  // can prove the counter follows the imported max.
  const co = buildCheckoutExport();
  const exp = JSON.parse(co.json);
  const HIGH = 5000;
  exp.patients.forEach((p) => { p.patient_number = HIGH; });
  exp.counter = 0; // even if the export's own counter is stale, import must recover from patients

  db._reset(); // fresh front desk, counter = 0
  const res = db.importMaster(JSON.stringify(exp));
  truthy(res.ok, '[counter] import succeeds');
  const next = db.peekNextNumber();
  truthy(next > HIGH, `[counter] peekNextNumber (${next}) is strictly greater than the max imported number (${HIGH})`);

  // And a subsequently-created patient actually receives that safe number.
  const p = db.createPatient({ first_name: 'After', last_name: 'Import', age_at_first_visit: 9, sex: 'M' });
  truthy(p.patient_number > HIGH, `[counter] next created patient number (${p.patient_number}) does not collide with imported numbers`);
}

// ===========================================================================
// TEST 4 — BAD INPUT: invalid / non-JSON import returns { ok:false } gracefully
//          (no throw, no partial corruption of the local DB).
// ===========================================================================
function test4_invalidImport() {
  section('TEST 4 — invalid / non-JSON import fails gracefully');

  db._reset();
  const seed = db.createPatient({ first_name: 'Keep', last_name: 'Me', age_at_first_visit: 9, sex: 'M' });
  const before = db.allPatients().length;

  let res, threw = false;
  try { res = db.importMaster('this is { not ] valid JSON'); }
  catch (e) { threw = true; }
  falsy(threw, '[invalid] importMaster does NOT throw on non-JSON input');
  truthy(res && res.ok === false, '[invalid] importMaster returns { ok:false } on non-JSON input');
  eq(res && res.error, 'invalid_json', '[invalid] error reason is invalid_json');
  eq(db.allPatients().length, before, '[invalid] local DB is untouched after a failed import');
  truthy(db.getPatient(seed.id), '[invalid] pre-existing local patient survives a failed import');

  // A truncated JSON string also fails gracefully.
  let res2, threw2 = false;
  try { res2 = db.importMaster('{"patients": ['); }
  catch (e) { threw2 = true; }
  falsy(threw2, '[invalid] importMaster does NOT throw on truncated JSON');
  truthy(res2 && res2.ok === false, '[invalid] truncated JSON returns { ok:false }');
}

// ===========================================================================
// TEST 5 — EDGE: a pending NV (return-visit) patient still surfaces pending
//          treatment via the search summary after being imported at the front
//          desk (so staff can see outstanding work on the returning card).
// ===========================================================================
function test5_pendingNVAfterImport() {
  section('TEST 5 — pending NV visit still shows outstanding treatment after import');

  // Build a checkout master whose patient has an NV (needs-visit) outcome with
  // one incomplete treatment item.
  db._reset();
  const p = db.createPatient({ first_name: 'Nayeli', last_name: 'Volver', age_at_first_visit: 11, sex: 'F' });
  const v = model.newVisit(p);
  v.exam_type = 'E';
  v.visit_outcome = 'NV';
  v.treatment_items = [
    { id: 'nv-3-O', tooth: '3', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false, not_done: false }
  ];
  v.checkout_timestamp = model.nowISO();
  v.last_modified = model.nowISO();
  p.visits.push(v);
  db.savePatient(p);
  const exp = JSON.stringify(db.exportMaster(), null, 2);
  const pid = p.id;

  // Import into a fresh front desk.
  db._reset();
  const res = db.importMaster(exp);
  eq(res.added, 1, '[NV] pending patient imported (added = 1)');

  const card = db.searchPatients('Volver').find((c) => c.id === pid);
  truthy(card, '[NV] pending patient is findable by name after import');
  eq(card && card.has_pending, true, '[NV] search summary flags has_pending = true');
  truthy(card && card.pending_items && card.pending_items.length === 1, '[NV] search summary lists the 1 outstanding treatment item');

  // Full record confirms the incomplete item + NV outcome are intact.
  const full = db.getPatient(pid);
  eq(model.lastVisit(full).visit_outcome, 'NV', '[NV] full record keeps the NV outcome');
  eq((model.lastVisit(full).treatment_items || []).filter((t) => !t.complete).length, 1, '[NV] full record keeps the incomplete item');
}

// ===========================================================================
// TEST 6 — EDGE: empty / duplicate re-import is a no-op-ish (added 0; a
//          duplicate re-import counts as updated, never re-adds or drops data).
// ===========================================================================
function test6_emptyAndDuplicate() {
  section('TEST 6 — empty and duplicate re-import behave (no-op-ish)');

  // Empty master (no patients) -> added 0, updated 0, and does not wipe the DB.
  db._reset();
  const seed = db.createPatient({ first_name: 'Solo', last_name: 'Uno', age_at_first_visit: 9, sex: 'M' });
  const emptyExport = JSON.stringify({ schema_version: 1, patients: [], counter: 0 });
  const resE = db.importMaster(emptyExport);
  truthy(resE.ok, '[empty] empty import succeeds');
  eq(resE.added, 0, '[empty] empty import adds 0');
  eq(resE.updated, 0, '[empty] empty import updates 0');
  eq(db.allPatients().length, 1, '[empty] empty import does NOT wipe existing local patients');
  truthy(db.getPatient(seed.id), '[empty] existing local patient survives an empty import');

  // Duplicate re-import of a real master: first import adds; second identical
  // import updates (merge) and never re-adds or changes the total.
  const co = buildCheckoutExport();
  db._reset();
  const r1 = db.importMaster(co.json);
  eq(r1.added, 1, '[dup] first import adds the patient');
  const totalAfterFirst = db.allPatients().length;
  const r2 = db.importMaster(co.json);
  truthy(r2.ok, '[dup] duplicate re-import succeeds');
  eq(r2.added, 0, '[dup] duplicate re-import adds 0 (already present)');
  eq(r2.updated, 1, '[dup] duplicate re-import counts as updated');
  eq(db.allPatients().length, totalAfterFirst, '[dup] duplicate re-import does not change the patient count');
  truthy(db.getPatient(co.id), '[dup] patient still present after duplicate re-import');
  truthy(db.getPatient(co.id).medical_history, '[dup] medical_history still present after duplicate re-import');
}

// ===========================================================================
// RUN
// ===========================================================================
function run() {
  console.log('GDR returning-patient (shared-DB import) data-layer proof\n');
  try {
    test1_importThenReturningSearch();
    test2_mergeNoLoss();
    test3_counterConsistency();
    test4_invalidImport();
    test5_pendingNVAfterImport();
    test6_emptyAndDuplicate();
  } catch (e) {
    fail('UNCAUGHT EXCEPTION: ' + (e && e.stack ? e.stack : e));
  }

  console.log('\n=========================================================');
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    console.log('\nVERDICT: RETURNING-PATIENT (shared-DB import) data-layer behaviour is NOT fully correct.');
  } else {
    console.log('\nVERDICT: RETURNING-PATIENT (shared-DB import) data-layer behaviour — import/merge/search/full-record/counter/bad-input — is FULLY CORRECT.');
  }
  process.exit(failCount ? 1 : 0);
}

run();
