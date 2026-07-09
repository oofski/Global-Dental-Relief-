'use strict';
/*
 * GDR v1.3.2 "Becky Bay" DATA-LAYER PROOF HARNESS (TEST-ONLY)
 * ---------------------------------------------------------------------------
 * Proves the v1.3.2 data-layer behaviour behind the Becky-Bay call changes,
 * driving the REAL modules (no mocks), exactly as the renderer/IPC stations do:
 *     read drive -> mutate model.lastVisit(patient) -> bump last_modified
 *     -> drive.writePatient -> db.mergeFromDrive
 *
 *   1. rdh_initials + fluoride_initials persist through a drive.write +
 *      db.mergeFromDrive round-trip, and a later stale ('') re-save does NOT
 *      clobber them (prefer-non-empty scalar merge).
 *   2. planned_by is WRITE-ONCE: set once at the charting station and never
 *      overwritten across merges, even when a newer copy carries null.
 *   3. performed_by is set when an item is completed at a station, tracks the
 *      completing role, and a newer null copy does NOT clobber it.
 *   4. treatmentChipClass-equivalent logic: after merge, done / nd / pending are
 *      MUTUALLY EXCLUSIVE (complete wins over not_done; never both).
 *   5. Reports still count PERFORMED-only (complete && !not_done); the new
 *      planned_by / performed_by stamps are display-only and never change counts.
 *
 * Self-checking: prints PASS/FAIL lines, exits non-zero if ANY assertion fails.
 * Does NOT modify any app source.
 *
 * Run:  node scripts/v132-test.js
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
// Tiny test runner (matches flow-test.js conventions)
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];

function pass(msg) { passCount++; console.log('  PASS  ' + msg); }
function stringify(v) {
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
  return String(v);
}
function fail(msg, expected, actual) {
  failCount++;
  const detail = (expected !== undefined || actual !== undefined)
    ? `\n           expected: ${stringify(expected)}\n           actual:   ${stringify(actual)}` : '';
  console.log('  FAIL  ' + msg + detail);
  failures.push(msg + (detail ? detail.replace(/\n\s+/g, ' ') : ''));
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
// Station plumbing that mirrors the real renderer/IPC behaviour
// ---------------------------------------------------------------------------
const ROOT = path.join(os.tmpdir(), 'gdr-v132-test-' + Date.now());
fs.mkdirSync(ROOT, { recursive: true });
let driveSeq = 0;
function newDriveDir() {
  const d = path.join(ROOT, 'drive-' + (++driveSeq));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function readDrive(dir, ctx) {
  const r = drive.readPatient(dir);
  if (!r.ok) { fail(`[${ctx}] drive.readPatient failed: ${r.reason}`); throw new Error(`drive read failed at ${ctx}`); }
  return r.patient;
}
function writeDrive(dir, patient, ctx) {
  const w = drive.writePatient(dir, patient);
  if (!w.ok) { fail(`[${ctx}] drive.writePatient failed: ${w.reason}`); throw new Error(`drive write failed at ${ctx}`); }
  return w;
}
// Force a strictly-increasing last_modified between back-to-back station saves.
function tick() { const until = Date.now() + 3; while (Date.now() < until) { /* spin */ } }

// The SINGLE-source-of-truth chip class, replicated verbatim from
// src/renderer/components/shared.js treatmentChipClass() (that module imports
// browser-only util.js/window.api and can't be required under node). Kept in
// lock-step so this test proves the exact class the UI renders.
function chipClass(item) {
  return 'code-chip' + (item && item.complete ? ' done' : (item && item.not_done ? ' nd' : ''));
}

// ===========================================================================
// TEST 1 — rdh_initials + fluoride_initials round-trip + no-clobber (items 4,5)
// ===========================================================================
function test1_initialsRoundTrip() {
  section('TEST 1 — rdh_initials + fluoride_initials persist (drive.write + mergeFromDrive)');
  db._reset();
  const dir = newDriveDir();

  // Model default: both new keys exist and start empty.
  const shell = model.newVisit(null);
  eq(shell.rdh_initials, '', 'newVisit() has rdh_initials: ""');
  eq(shell.fluoride_initials, '', 'newVisit() has fluoride_initials: ""');

  const created = db.createPatient({ first_name: 'Becky', last_name: 'Bay', age_at_first_visit: 10, sex: 'F', drive_number: 3 });
  const id = created.id;
  const v = model.newVisit(created);
  v.exam_type = 'E'; v.clinician_type = 'DDS'; v.clinician_initials = 'DR';
  v.last_modified = model.nowISO();
  created.visits.push(v);
  writeDrive(dir, created, 'dentist');
  db.mergeFromDrive(created);

  // Cleaning station: hygienist stamps rdh_initials.
  tick();
  let pat = readDrive(dir, 'cleaning load');
  let vv = model.lastVisit(pat);
  vv.rdh_initials = 'RH';
  vv.last_modified = model.nowISO();
  writeDrive(dir, pat, 'cleaning');
  db.mergeFromDrive(pat);

  // Fluoride station: stamps fluoride_initials.
  tick();
  pat = readDrive(dir, 'fluoride load');
  vv = model.lastVisit(pat);
  vv.fluoride_initials = 'FL';
  vv.last_modified = model.nowISO();
  writeDrive(dir, pat, 'fluoride');
  db.mergeFromDrive(pat);

  // Both stores must carry BOTH initials + the doctor's original clinician_initials.
  const dv = model.lastVisit(readDrive(dir, 'verify drive'));
  const mv = model.lastVisit(db.getPatient(id));
  eq(dv.rdh_initials, 'RH', '[round-trip] DRIVE visit.rdh_initials');
  eq(mv.rdh_initials, 'RH', '[round-trip] DB    visit.rdh_initials');
  eq(dv.fluoride_initials, 'FL', '[round-trip] DRIVE visit.fluoride_initials');
  eq(mv.fluoride_initials, 'FL', '[round-trip] DB    visit.fluoride_initials');
  eq(mv.clinician_initials, 'DR', '[round-trip] DB clinician_initials untouched');

  // No-clobber: a LATER station re-saves a copy whose initials are '' (a fresh
  // clone that never touched those fields). prefer-non-empty merge must keep them.
  tick();
  pat = readDrive(dir, 'stale load');
  vv = model.lastVisit(pat);
  vv.rdh_initials = '';
  vv.fluoride_initials = '';
  vv.last_modified = model.nowISO(); // strictly NEWER
  writeDrive(dir, pat, 'stale');
  db.mergeFromDrive(pat);
  const after = model.lastVisit(db.getPatient(id));
  eq(after.rdh_initials, 'RH', '[no-clobber] newer "" copy does NOT wipe rdh_initials');
  eq(after.fluoride_initials, 'FL', '[no-clobber] newer "" copy does NOT wipe fluoride_initials');
}

// ===========================================================================
// TEST 2 — planned_by write-once + performed_by tracking (item 7)
// ===========================================================================
function test2_providerStamps() {
  section('TEST 2 — planned_by write-once + performed_by set-on-complete');
  db._reset();
  const dir = newDriveDir();

  const created = db.createPatient({ first_name: 'Prov', last_name: 'Stamp', age_at_first_visit: 8, sex: 'M', drive_number: 4 });
  const id = created.id;

  // Model default for a fresh item.
  const fresh = model.newTreatmentItem('19');
  eq(fresh.planned_by, null, 'newTreatmentItem() planned_by defaults null');
  eq(fresh.performed_by, null, 'newTreatmentItem() performed_by defaults null');

  // DENTIST charts one sealant-plan item, stamped planned_by='dentist', not yet done.
  const v = model.newVisit(created);
  v.exam_type = 'E'; v.clinician_type = 'DDS'; v.clinician_initials = 'DR';
  v.treatment_items = [{
    id: 'it1', tooth: '19', treatment_type: 'restoration', surfaces: ['O'],
    surgical: false, treating_today: true, complete: false, not_done: false,
    planned_by: 'dentist', performed_by: null
  }];
  v.last_modified = model.nowISO();
  created.visits.push(v);
  writeDrive(dir, created, 'dentist chart');
  db.mergeFromDrive(created);

  let mItem = model.lastVisit(db.getPatient(id)).treatment_items.find((t) => t.id === 'it1');
  eq(mItem.planned_by, 'dentist', '[charting] DB planned_by=dentist');
  eq(mItem.performed_by, null, '[charting] DB performed_by still null');
  falsy(mItem.complete, '[charting] DB item not complete yet');

  // CLEANING completes it -> performed_by='cleaning', complete=true (planned_by unchanged).
  tick();
  let pat = readDrive(dir, 'cleaning load');
  let vv = model.lastVisit(pat);
  let it = vv.treatment_items.find((t) => t.id === 'it1');
  it.complete = true; it.performed_by = 'cleaning';
  vv.last_modified = model.nowISO();
  writeDrive(dir, pat, 'cleaning complete');
  db.mergeFromDrive(pat);

  mItem = model.lastVisit(db.getPatient(id)).treatment_items.find((t) => t.id === 'it1');
  truthy(mItem.complete, '[complete] DB item complete=true');
  eq(mItem.performed_by, 'cleaning', '[complete] DB performed_by=cleaning');
  eq(mItem.planned_by, 'dentist', '[complete] DB planned_by still dentist (unchanged)');

  // WRITE-ONCE: a NEWER copy arrives with planned_by=null AND performed_by=null
  // (a detached clone that dropped the stamps). Neither may clobber the record.
  tick();
  pat = readDrive(dir, 'stale-stamp load');
  vv = model.lastVisit(pat);
  it = vv.treatment_items.find((t) => t.id === 'it1');
  it.planned_by = null;
  it.performed_by = null;
  vv.last_modified = model.nowISO(); // strictly NEWER
  writeDrive(dir, pat, 'stale-stamp');
  db.mergeFromDrive(pat);

  mItem = model.lastVisit(db.getPatient(id)).treatment_items.find((t) => t.id === 'it1');
  eq(mItem.planned_by, 'dentist', '[write-once] newer null copy does NOT wipe planned_by');
  eq(mItem.performed_by, 'cleaning', '[write-once] newer null copy does NOT wipe performed_by');
  truthy(mItem.complete, '[write-once] item stays complete');
}

// ===========================================================================
// TEST 3 — chip class mutual exclusivity after merge (item 6 logic)
// ===========================================================================
function test3_chipClassExclusive() {
  section('TEST 3 — treatmentChipClass done/nd/pending mutually exclusive after merge');
  db._reset();
  const dir = newDriveDir();

  const created = db.createPatient({ first_name: 'Chip', last_name: 'Class', age_at_first_visit: 11, sex: 'F', drive_number: 5 });
  const id = created.id;

  // Copy A: itA marked NOT DONE, itB pending, itC pending.
  const v = model.newVisit(created);
  v.exam_type = 'E';
  v.treatment_items = [
    { id: 'itA', tooth: '3', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false, not_done: true, planned_by: 'dentist', performed_by: null },
    { id: 'itB', tooth: '14', treatment_type: 'sealant', surfaces: [], surgical: false, treating_today: true, complete: false, not_done: false, planned_by: 'dentist', performed_by: null },
    { id: 'itC', tooth: '19', treatment_type: 'sealant', surfaces: [], surgical: false, treating_today: true, complete: false, not_done: true, planned_by: 'dentist', performed_by: null }
  ];
  v.last_modified = model.nowISO();
  created.visits.push(v);
  writeDrive(dir, created, 'copyA');
  db.mergeFromDrive(created);

  // Copy B (newer): itA COMPLETED (contradicts its earlier not_done), itB completed,
  // itC left not_done. Merge rule: complete ALWAYS wins over not_done.
  tick();
  const pat = readDrive(dir, 'copyB load');
  const vv = model.lastVisit(pat);
  const A = vv.treatment_items.find((t) => t.id === 'itA');
  const B = vv.treatment_items.find((t) => t.id === 'itB');
  A.complete = true; A.not_done = true; A.performed_by = 'cleaning'; // deliberately set BOTH to prove exclusivity
  B.complete = true; B.performed_by = 'cleaning';
  vv.last_modified = model.nowISO();
  writeDrive(dir, pat, 'copyB');
  db.mergeFromDrive(pat);

  const items = model.lastVisit(db.getPatient(id)).treatment_items;
  const byId = {}; items.forEach((t) => { byId[t.id] = t; });

  // itA: complete wins -> done, not_done cleared.
  eq(byId.itA.complete, true, '[merge] itA complete=true');
  eq(byId.itA.not_done, false, '[merge] itA not_done cleared (complete wins)');
  eq(chipClass(byId.itA), 'code-chip done', '[chip] itA => "code-chip done"');
  // itB: completed cleanly -> done.
  eq(chipClass(byId.itB), 'code-chip done', '[chip] itB => "code-chip done"');
  // itC: never completed, stays not_done -> nd.
  eq(byId.itC.complete, false, '[merge] itC complete=false');
  eq(byId.itC.not_done, true, '[merge] itC not_done=true');
  eq(chipClass(byId.itC), 'code-chip nd', '[chip] itC => "code-chip nd"');

  // Global invariant: NO merged item is both complete AND not_done, and every
  // chip class is exactly one of the three canonical states.
  items.forEach((t) => {
    falsy(t.complete && t.not_done, `[invariant] item ${t.id} not both complete+not_done`);
    const c = chipClass(t);
    truthy(['code-chip', 'code-chip done', 'code-chip nd'].includes(c), `[invariant] item ${t.id} chip class canonical (${c})`);
  });

  // A fresh pending item (no flags) is neither done nor nd.
  eq(chipClass(model.newTreatmentItem('30')), 'code-chip', '[chip] fresh pending item => "code-chip"');
}

// ===========================================================================
// TEST 4 — reports remain PERFORMED-only; stamps are display-only (invariant)
// ===========================================================================
function test4_reportsPerformedOnly() {
  section('TEST 4 — reports count performed-only; planned_by/performed_by never change counts');
  db._reset();
  const dir = newDriveDir();

  const created = db.createPatient({ first_name: 'Rep', last_name: 'Counts', age_at_first_visit: 9, sex: 'M', drive_number: 6 });
  const v = model.newVisit(created);
  v.exam_type = 'E'; v.clinician_type = 'DDS'; v.clinician_initials = 'DR';
  v.treatment_items = [
    // completed single-surface fill WITH stamps -> counts as fill_single.
    { id: 'r1', tooth: '19', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'cleaning' },
    // explicitly NOT DONE extraction -> must NOT count.
    { id: 'r2', tooth: '18', treatment_type: 'extraction', surfaces: [], surgical: false, treating_today: true, complete: false, not_done: true, planned_by: 'dentist', performed_by: null },
    // planned but never completed -> must NOT count.
    { id: 'r3', tooth: '3', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false, not_done: false, planned_by: 'dentist', performed_by: null }
  ];
  v.visit_outcome = 'F';
  v.checkout_timestamp = model.nowISO();
  v.last_modified = model.nowISO();
  created.visits.push(v);
  writeDrive(dir, created, 'checkout');
  db.uploadPatient(created);

  const rowsToMap = (stats) => { const o = {}; stats.rows.forEach((r) => { o[r.key] = r.count; }); return o; };
  const c1 = rowsToMap(reports.computeStats({}));
  eq(c1.fill_single, 1, '[reports] one completed fill_single counted');
  eq(c1.ext_permanent || 0, 0, '[reports] not_done extraction NOT counted');
  // sanity: classifyItem agrees the not-counted item WOULD have been ext_permanent.
  eq(codes.classifyItem(v.treatment_items[1]), 'ext_permanent', '[reports] r2 classifies as ext_permanent (but excluded by not_done)');

  // Display-only proof: strip ALL provider stamps from a second identical patient;
  // the counts must be identical (stamps never influence report math).
  db._reset();
  const created2 = db.createPatient({ first_name: 'Rep2', last_name: 'NoStamps', age_at_first_visit: 9, sex: 'M', drive_number: 7 });
  const v2 = model.newVisit(created2);
  v2.exam_type = 'E';
  v2.treatment_items = v.treatment_items.map((t) => Object.assign({}, t, { planned_by: null, performed_by: null }));
  v2.visit_outcome = 'F';
  v2.checkout_timestamp = model.nowISO();
  v2.last_modified = model.nowISO();
  created2.visits.push(v2);
  db.uploadPatient(created2);
  const c2 = rowsToMap(reports.computeStats({}));
  eq(c2.fill_single, 1, '[reports] no-stamp patient still counts fill_single=1');
  eq(c2.fill_single, c1.fill_single, '[reports] fill_single identical with vs without stamps');
  eq((c2.ext_permanent || 0), (c1.ext_permanent || 0), '[reports] ext_permanent identical with vs without stamps');
}

// ===========================================================================
// Run all tests
// ===========================================================================
(function main() {
  console.log('GDR v1.3.2 "Becky Bay" DATA-LAYER PROOF HARNESS');
  console.log('master DB dir:', require('../src/main/paths').base());
  console.log('drive root:   ', ROOT);

  const tests = [
    test1_initialsRoundTrip,
    test2_providerStamps,
    test3_chipClassExclusive,
    test4_reportsPerformedOnly
  ];

  for (const t of tests) {
    try { t(); }
    catch (e) {
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
    console.log('\nVERDICT: v1.3.2 data-layer behaviour is NOT fully correct (see failures above).');
    process.exit(1);
  } else {
    console.log('\nVERDICT: v1.3.2 data layer (rdh/fluoride initials round-trip / planned_by write-once / performed_by / chip-class exclusivity / reports performed-only) is FULLY CORRECT.');
    process.exit(0);
  }
})();
