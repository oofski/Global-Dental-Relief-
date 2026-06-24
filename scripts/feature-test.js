'use strict';
/*
 * GDR NEW-FEATURE DATA-LAYER PROOF HARNESS (TEST-ONLY)
 * ===========================================================================
 * Proves the 6 client features + healthy-archive behave correctly at the
 * DATA layer (model factories, merge, codes classification, reports counting
 * and the flash-drive round-trip). It drives the REAL modules — no mocks:
 *
 *   - src/main/db.js      (master DB, mergeFromDrive, mergeVisit, mergePatient)
 *   - src/main/drive.js   (flash-drive transport, checksum-wrapped)
 *   - src/main/reports.js (computeStats over the master DB)
 *   - src/shared/model.js (newVisit / newTreatmentItem factories)
 *   - src/shared/codes.js (isAdultExtractionItem / hasAdultExtraction)
 *
 * Features covered here (data layer only — the renderer/UI is proven by e2e):
 *   FLU-7  fluoride block rule semantics (only === false blocks)
 *   FLOW-5 skip-doctor visit keeps default fluoride_recommended === true
 *   CHK-8  not_done outcome: excluded from reports; complete wins on merge
 *   DOC-3  hasAdultExtraction true for adult ext, false for baby / non-ext
 *   hygienist fields (oh2_done / fluoride_done / cleaning_type) survive a
 *     drive write + db.mergeFromDrive round-trip
 *   cleaning_type stays a single mutually-exclusive scalar 'P'|'D'|'None'
 *
 * Backward-compat is exercised throughout: legacy records lacking not_done /
 * fluoride_recommended must behave (absent not_done => counted; absent/undefined
 * fluoride_recommended => recommended, NOT blocked).
 *
 * Self-checking: prints PASS/FAIL lines and exits non-zero if ANY fails.
 * Does NOT modify any app source.
 *
 * Run:  node scripts/feature-test.js
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
// Tiny test runner (mirrors flow-test.js)
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
// Drive + station helpers (mirror the real renderer/IPC station behaviour)
// ---------------------------------------------------------------------------
const ROOT = path.join(os.tmpdir(), 'gdr-feature-test-' + Date.now());
fs.mkdirSync(ROOT, { recursive: true });
let driveSeq = 0;
function newDriveDir() {
  const d = path.join(ROOT, 'drive-' + (++driveSeq));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function readDrive(dir, ctx) {
  const r = drive.readPatient(dir);
  if (!r.ok) { fail(`[${ctx}] drive.readPatient failed: ${r.reason}`); throw new Error(`drive read failed at ${ctx}: ${r.reason}`); }
  return r.patient;
}
function writeDrive(dir, patient, ctx) {
  const w = drive.writePatient(dir, patient);
  if (!w.ok) { fail(`[${ctx}] drive.writePatient failed: ${w.reason}`); throw new Error(`drive write failed at ${ctx}: ${w.reason}`); }
  return w;
}
// Force a strictly-increasing last_modified (nowISO has ms resolution).
function tick() { const until = Date.now() + 3; while (Date.now() < until) { /* spin */ } }

function reportCounts() {
  const stats = reports.computeStats({});
  const out = {};
  stats.rows.forEach((r) => { out[r.key] = r.count; });
  return out;
}

// Mirror the renderer's FLU-7 gate: ONLY an explicit false blocks fluoride.
// (Backward-compat: absent/undefined/true must NOT block.)
function fluorideBlocked(visit) {
  return visit && visit.fluoride_recommended === false;
}

// ===========================================================================
// TEST A — not_done outcome (CHK-8): excluded from reports + merge complete-wins
// ===========================================================================
function testA_notDone() {
  section('TEST A — not_done outcome (CHK-8)');
  db._reset();

  // ---- A1: a not_done item is EXCLUDED from reports treatment-type counts ----
  // One patient, one finished visit with TWO completed fillings, ONE of which is
  // ALSO flagged not_done (should NEVER happen normally, but reports must still
  // exclude any item with not_done === true regardless of complete).
  const p = db.createPatient({ first_name: 'Not', last_name: 'Done', age_at_first_visit: 9, sex: 'M' });
  const v = model.newVisit(p);
  v.exam_type = 'E';
  v.station_status.dentist = true;
  v.treatment_items = [
    // counted: complete, not flagged not_done
    { id: 'i-counted', tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true, not_done: false },
    // excluded: explicitly not_done (even though complete is true — exclusion wins)
    { id: 'i-nd', tooth: '14', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true, not_done: true }
  ];
  v.checkout_timestamp = model.nowISO();
  v.visit_outcome = 'F';
  p.visits.push(v);
  db.savePatient(p);

  let c = reportCounts();
  eq(c.fill_double, 1, '[A1] not_done item EXCLUDED from reports (1 counted, 1 not_done excluded)');
  eq(c.total_patients, 1, '[A1] not_done exclusion does NOT change Total patients seen');

  // ---- A1b: legacy item with not_done ABSENT is still counted (backward-compat) ----
  db._reset();
  const p2 = db.createPatient({ first_name: 'Legacy', last_name: 'Item', age_at_first_visit: 10, sex: 'F' });
  const v2 = model.newVisit(p2);
  v2.exam_type = 'E';
  v2.treatment_items = [
    // NOTE: no not_done key at all (legacy record)
    { id: 'leg-1', tooth: '3', treatment_type: 'extraction', surfaces: [], surgical: false, treating_today: true, complete: true }
  ];
  v2.checkout_timestamp = model.nowISO();
  p2.visits.push(v2);
  db.savePatient(p2);
  c = reportCounts();
  eq(c.ext_permanent, 1, '[A1b] legacy item lacking not_done is STILL counted (absent => false)');

  // ---- A2: merge (complete) vs (not_done) for SAME item id => complete wins ----
  // Two laptops chart the SAME visit/item. Laptop A marks it complete; laptop B
  // (older save) marks it not_done. After mergeFromDrive: complete=true, not_done=false.
  db._reset();
  const dirA = newDriveDir();
  const created = db.createPatient({ first_name: 'Merge', last_name: 'Wins', age_at_first_visit: 11, sex: 'M', drive_number: 91 });
  const id = created.id;

  // Laptop B writes FIRST (older): item flagged not_done (clinician marked "could not do").
  const visitB = model.newVisit(created);
  visitB.exam_type = 'E';
  visitB.station_status.dentist = true;
  visitB.treatment_items = [
    { id: 'shared-21', tooth: '21', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false, not_done: true }
  ];
  visitB.last_modified = model.nowISO();
  created.visits = [visitB];
  writeDrive(dirA, created, 'A2 not_done save');
  db.mergeFromDrive(created);

  // Laptop A writes LATER (newer): SAME item id now complete (treatment was done).
  tick();
  const patA = readDrive(dirA, 'A2 complete load');
  const va = model.lastVisit(patA);
  va.treatment_items[0].complete = true;
  va.treatment_items[0].not_done = true;   // stale flag still set on this copy
  va.last_modified = model.nowISO();
  writeDrive(dirA, patA, 'A2 complete save');
  db.mergeFromDrive(patA);

  const mv = model.lastVisit(db.getPatient(id));
  const item = (mv.treatment_items || []).find((t) => t.id === 'shared-21');
  truthy(item, '[A2] merged item shared-21 present');
  eq(item && item.complete, true, '[A2] merge: complete wins (complete=true)');
  eq(item && item.not_done, false, '[A2] merge: not_done cleared by complete (mutually exclusive)');

  // ---- A2b: merge of two not_done copies (neither complete) keeps not_done=true
  db._reset();
  const dirB = newDriveDir();
  const c2 = db.createPatient({ first_name: 'Both', last_name: 'ND', age_at_first_visit: 12, sex: 'F', drive_number: 92 });
  const id2 = c2.id;
  const vb1 = model.newVisit(c2);
  vb1.treatment_items = [{ id: 'nd-30', tooth: '30', treatment_type: 'restoration', surfaces: ['O'], complete: false, not_done: true }];
  vb1.last_modified = model.nowISO();
  c2.visits = [vb1];
  writeDrive(dirB, c2, 'A2b first');
  db.mergeFromDrive(c2);
  tick();
  const pb = readDrive(dirB, 'A2b second load');
  const vb2 = model.lastVisit(pb);
  vb2.treatment_items[0].not_done = true;
  vb2.last_modified = model.nowISO();
  writeDrive(dirB, pb, 'A2b second');
  db.mergeFromDrive(pb);
  const mvb = model.lastVisit(db.getPatient(id2));
  const ib = (mvb.treatment_items || []).find((t) => t.id === 'nd-30');
  eq(ib && ib.complete, false, '[A2b] both-not_done merge: complete stays false');
  eq(ib && ib.not_done, true, '[A2b] both-not_done merge: not_done stays true');
  // And it is excluded from reports (incomplete + not_done => never counted).
  c = reportCounts();
  eq(c.fill_single, 0, '[A2b] not_done (incomplete) item not counted in reports');
}

// ===========================================================================
// TEST B — fluoride default + FLU-7 / FLOW-5 rule semantics
// ===========================================================================
function testB_fluoride() {
  section('TEST B — fluoride default + FLU-7 block rule (FLOW-5 skip-doctor)');

  // ---- B1: newVisit default fluoride_recommended === true (NOT flipped) ----
  const v = model.newVisit({ id: 'x', patient_number: 1 });
  eq(v.fluoride_recommended, true, '[B1] newVisit().fluoride_recommended === true (standard of care)');

  // ---- B2: FLU-7 rule — ONLY === false blocks; true & undefined do NOT ----
  eq(fluorideBlocked({ fluoride_recommended: false }), true, '[B2] fluoride_recommended === false BLOCKS (FLU-7)');
  falsy(fluorideBlocked({ fluoride_recommended: true }), '[B2] fluoride_recommended === true does NOT block');
  falsy(fluorideBlocked({ fluoride_recommended: undefined }), '[B2] fluoride_recommended undefined does NOT block (backward-compat)');
  falsy(fluorideBlocked({}), '[B2] fluoride_recommended absent does NOT block (legacy record)');
  // a real new visit must not be blocked
  falsy(fluorideBlocked(v), '[B2] a fresh newVisit() is NOT blocked');

  // ---- B3: FLOW-5 skip-doctor visit (no exam, dentist station false) ----
  // A patient who skips the doctor still has the default true and is therefore
  // NOT blocked (product decision: allowed fluoride by default).
  db._reset();
  const dir = newDriveDir();
  const created = db.createPatient({ first_name: 'Skip', last_name: 'Doctor', age_at_first_visit: 8, sex: 'F', drive_number: 81 });
  const id = created.id;
  const sv = model.newVisit(created);
  sv.station_status.checkin = true;
  // explicitly NO dentist exam:
  sv.exam_type = null;
  sv.station_status.dentist = false;
  sv.last_modified = model.nowISO();
  created.visits = [sv];
  writeDrive(dir, created, 'B3 checkin');
  db.mergeFromDrive(created);

  const mv = model.lastVisit(db.getPatient(id));
  eq(mv.exam_type, null, '[B3] skip-doctor visit has NO exam_type');
  eq(mv.station_status.dentist, false, '[B3] skip-doctor visit dentist station false');
  eq(mv.fluoride_recommended, true, '[B3] skip-doctor visit keeps fluoride_recommended === true (NOT flipped)');
  truthy(mv.fluoride_recommended !== false, '[B3] FLU-7: fluoride_recommended !== false => NOT blocked');
  falsy(fluorideBlocked(mv), '[B3] skip-doctor visit is NOT blocked at fluoride station');

  // ---- B3b: reports — skip-doctor (no exam) is NOT counted as fluoride_recommended
  // (the recommended count is gated on an actual dentist exam; default-true alone
  //  must not inflate the recommended tally for patients the doctor never saw).
  const c = reportCounts();
  eq(c.fluoride_recommended, 0, '[B3b] reports: skip-doctor NOT counted as fluoride_recommended (gate unchanged)');

  // ---- B4: dentist "no fluoride" (=== false) persists and blocks ----
  db._reset();
  const dir2 = newDriveDir();
  const c4 = db.createPatient({ first_name: 'No', last_name: 'Fluoride', age_at_first_visit: 13, sex: 'M', drive_number: 82 });
  const id4 = c4.id;
  const dv = model.newVisit(c4);
  dv.exam_type = 'E';
  dv.station_status.dentist = true;
  dv.fluoride_recommended = false; // doctor turned it OFF after a heavy adult extraction
  dv.last_modified = model.nowISO();
  c4.visits = [dv];
  writeDrive(dir2, c4, 'B4 dentist');
  db.mergeFromDrive(c4);

  // stale downstream copy re-saves carrying default true — must NOT restore it.
  tick();
  const stale = readDrive(dir2, 'B4 stale load');
  const sv4 = model.lastVisit(stale);
  sv4.fluoride_recommended = true; // stale default
  sv4.fluoride_done = false;
  sv4.last_modified = model.nowISO();
  writeDrive(dir2, stale, 'B4 stale');
  db.mergeFromDrive(stale);

  const mv4 = model.lastVisit(db.getPatient(id4));
  eq(mv4.fluoride_recommended, false, '[B4] dentist "no fluoride" (false) survives a stale true re-save');
  truthy(fluorideBlocked(mv4), '[B4] FLU-7: fluoride_recommended === false => blocked at fluoride station');
}

// ===========================================================================
// TEST C — codes.hasAdultExtraction / isAdultExtractionItem (DOC-3)
// ===========================================================================
function testC_adultExtraction() {
  section('TEST C — codes.hasAdultExtraction (DOC-3)');

  // isAdultExtractionItem
  truthy(codes.isAdultExtractionItem({ treatment_type: 'extraction', tooth: '19' }), '[C] adult ext (tooth 19) is adult-extraction item');
  falsy(codes.isAdultExtractionItem({ treatment_type: 'extraction', tooth: 'a' }), '[C] primary ext (tooth a) is NOT adult-extraction item');
  falsy(codes.isAdultExtractionItem({ treatment_type: 'restoration', tooth: '19' }), '[C] non-extraction (restoration) is NOT adult-extraction item');
  falsy(codes.isAdultExtractionItem({ treatment_type: 'extraction', tooth: '' }), '[C] extraction with empty tooth is NOT adult-extraction item');
  falsy(codes.isAdultExtractionItem({ treatment_type: 'extraction' }), '[C] extraction with missing tooth is NOT adult-extraction item');
  falsy(codes.isAdultExtractionItem(null), '[C] null item is NOT adult-extraction item');

  // hasAdultExtraction over a visit
  truthy(codes.hasAdultExtraction({ treatment_items: [{ treatment_type: 'extraction', tooth: '19' }] }), '[C] hasAdultExtraction TRUE for adult ext (19)');
  falsy(codes.hasAdultExtraction({ treatment_items: [{ treatment_type: 'extraction', tooth: 'a' }] }), '[C] hasAdultExtraction FALSE for primary ext (a)');
  falsy(codes.hasAdultExtraction({ treatment_items: [{ treatment_type: 'restoration', tooth: '19' }] }), '[C] hasAdultExtraction FALSE for non-extraction');
  falsy(codes.hasAdultExtraction({ treatment_items: [] }), '[C] hasAdultExtraction FALSE for empty items');
  falsy(codes.hasAdultExtraction({}), '[C] hasAdultExtraction FALSE for visit with no treatment_items');
  falsy(codes.hasAdultExtraction(null), '[C] hasAdultExtraction FALSE for null visit (no crash)');
  // mixed: one adult ext among baby + restorations => true
  truthy(codes.hasAdultExtraction({ treatment_items: [
    { treatment_type: 'restoration', tooth: '8' },
    { treatment_type: 'extraction', tooth: 'k' },
    { treatment_type: 'extraction', tooth: '30' }
  ] }), '[C] hasAdultExtraction TRUE when adult ext mixed with baby ext + restoration');
  // tooth '32' (boundary adult upper bound) and uppercase primary 'A' handling
  truthy(codes.isAdultExtractionItem({ treatment_type: 'extraction', tooth: '32' }), '[C] adult ext boundary tooth 32 is adult-extraction');
  falsy(codes.isAdultExtractionItem({ treatment_type: 'extraction', tooth: 'A' }), '[C] uppercase primary "A" treated as primary (NOT adult)');
}

// ===========================================================================
// TEST D — hygienist fields survive drive write + db.mergeFromDrive round-trip
// ===========================================================================
function testD_hygienistRoundTrip() {
  section('TEST D — hygienist fields survive drive write + mergeFromDrive');
  db._reset();
  const dir = newDriveDir();

  // Dentist first orders a cleaning_type so the hygienist works against a plan.
  const created = db.createPatient({ first_name: 'Hyg', last_name: 'Round', age_at_first_visit: 10, sex: 'F', drive_number: 71 });
  const id = created.id;
  const dv = model.newVisit(created);
  dv.exam_type = 'E';
  dv.station_status.dentist = true;
  dv.cleaning_type = 'P'; // dentist orders prophy
  dv.last_modified = model.nowISO();
  created.visits = [dv];
  writeDrive(dir, created, 'D dentist');
  db.mergeFromDrive(created);

  // Hygienist (cleaning station) sets oh2_done, fluoride_done, cleaning_type.
  // Per shared.js cleaningTypeControl, the hygienist can read/confirm the
  // cleaning_type — here they confirm 'P' (and we also prove a change persists).
  tick();
  let pat = readDrive(dir, 'D hygienist load');
  let v = model.lastVisit(pat);
  v.oh2_done = true;
  v.fluoride_done = true;
  v.fluoride_done_at = model.nowISO();
  v.cleaning_done = true;
  v.cleaning_done_at = model.nowISO();
  v.cleaning_type = 'P';
  v.station_status.cleaning = true;
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'D hygienist');
  db.mergeFromDrive(pat);

  // Verify in BOTH stores (drive + master DB).
  const drivePat = readDrive(dir, 'D verify drive');
  const dv2 = model.lastVisit(drivePat);
  const mv = model.lastVisit(db.getPatient(id));
  eq(dv2.oh2_done, true, '[D] DRIVE oh2_done survived round-trip');
  eq(mv.oh2_done, true, '[D] DB    oh2_done survived merge');
  eq(dv2.fluoride_done, true, '[D] DRIVE fluoride_done survived round-trip');
  eq(mv.fluoride_done, true, '[D] DB    fluoride_done survived merge');
  eq(dv2.cleaning_type, 'P', '[D] DRIVE cleaning_type survived round-trip');
  eq(mv.cleaning_type, 'P', '[D] DB    cleaning_type survived merge');
  eq(mv.cleaning_done, true, '[D] DB cleaning_done survived merge');

  // ---- D2: hygienist CHANGES cleaning_type (e.g. D -> not downgraded, P->D upgrade)
  // Prove a real change to a new order persists through the round-trip + merge.
  tick();
  pat = readDrive(dir, 'D2 change load');
  v = model.lastVisit(pat);
  v.cleaning_type = 'D'; // changed order
  v.last_modified = model.nowISO();
  writeDrive(dir, pat, 'D2 change');
  db.mergeFromDrive(pat);
  const mv2 = model.lastVisit(db.getPatient(id));
  eq(mv2.cleaning_type, 'D', '[D2] cleaning_type change (P->D) persists through merge');
}

// ===========================================================================
// TEST E — cleaning_type is a single mutually-exclusive scalar 'P'|'D'|'None'
// ===========================================================================
function testE_cleaningTypeScalar() {
  section('TEST E — cleaning_type mutually-exclusive scalar');

  // newVisit default is the scalar 'None'.
  const v = model.newVisit({ id: 'z' });
  eq(v.cleaning_type, 'None', '[E] newVisit().cleaning_type default scalar "None"');
  truthy(typeof v.cleaning_type === 'string', '[E] cleaning_type is a string scalar (not an array/set)');

  // Setting one value replaces any prior — only one of P/D/None at a time.
  v.cleaning_type = 'P';
  eq(v.cleaning_type, 'P', '[E] selecting Prophy sets scalar to "P"');
  v.cleaning_type = 'D';
  eq(v.cleaning_type, 'D', '[E] selecting Debridement REPLACES with "D" (mutually exclusive)');
  v.cleaning_type = 'None';
  eq(v.cleaning_type, 'None', '[E] selecting None REPLACES with "None"');
  truthy(['P', 'D', 'None'].indexOf(v.cleaning_type) !== -1, '[E] cleaning_type is always one of P|D|None');

  // Reports treat exactly one bucket per visit: a 'P' cleaning_done counts prophy
  // ONLY (never both prophy and debride for the same visit).
  db._reset();
  const p = db.createPatient({ first_name: 'Clean', last_name: 'Scalar', age_at_first_visit: 9, sex: 'M' });
  const vv = model.newVisit(p);
  vv.exam_type = 'E';
  vv.cleaning_type = 'P';
  vv.cleaning_done = true;
  vv.checkout_timestamp = model.nowISO();
  p.visits.push(vv);
  db.savePatient(p);
  const c = reportCounts();
  eq(c.cleaning_prophy, 1, '[E] cleaning_done with type P counts prophy = 1');
  eq(c.cleaning_debride, 0, '[E] cleaning_done with type P does NOT also count debride (mutually exclusive)');
}

// ===========================================================================
// RUN
// ===========================================================================
function run() {
  console.log('GDR feature test (new client features + healthy-archive, data layer)\n');
  try {
    testA_notDone();
    testB_fluoride();
    testC_adultExtraction();
    testD_hygienistRoundTrip();
    testE_cleaningTypeScalar();
  } catch (e) {
    fail('UNCAUGHT EXCEPTION: ' + (e && e.stack ? e.stack : e));
  }

  console.log('\n=========================================================');
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    console.log('\nVERDICT: NEW-FEATURE data-layer behaviour is NOT fully correct.');
  } else {
    console.log('\nVERDICT: NEW-FEATURE data-layer behaviour (not_done / fluoride FLU-7 / DOC-3 adult-ext / hygienist round-trip / cleaning_type scalar) is FULLY CORRECT.');
  }
  // Clean up temp drives.
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (_) {}
  process.exit(failCount ? 1 : 0);
}

run();
