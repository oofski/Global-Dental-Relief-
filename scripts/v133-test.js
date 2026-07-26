'use strict';
/*
 * GDR v1.3.3 PERMISSION-SLIP PROOF HARNESS (TEST-ONLY)
 * ---------------------------------------------------------------------------
 * The clinic replaced our draft consent text with their real paper permission
 * slip, which carries three individually ticked opt-in boxes (Cleaning /
 * Fillings / Extractions). Clinicians must be warned when a parent declined
 * one. This harness proves that behaviour end to end against the REAL modules
 * (no mocks), exactly as the stations drive it:
 *     check-in writes consent -> drive.writePatient -> db.mergeFromDrive
 *     -> station reads model.consentPermissions(patient)
 *
 *   1. newConsent() carries the slip fields; consentPermissions() resolves
 *      granted/denied in a fixed order and never throws on junk input.
 *   2. LEGACY SAFETY: a pre-v1.3.3 record (consent with no `permissions` key)
 *      reads as blanket-granted, so returning patients never trip a false
 *      "no permission" alarm at the dentist/hygienist stations.
 *   3. The slip survives a drive.write + db.mergeFromDrive round-trip
 *      (permissions, child_name, school, phone).
 *   4. MERGE DOWNGRADE GUARD: an older legacy drive copy landing on top of a
 *      master that already holds per-treatment opt-ins must NOT erase them;
 *      a genuinely re-signed slip (incl. a REVOKED box) must still win.
 *   5. Denials are display-only: they never alter reporting counts.
 *   6. The real slip replaced the draft, the new keys exist in BOTH
 *      dictionaries, and both clinical stations gate on the popup.
 *
 * Self-checking: prints PASS/FAIL lines, exits non-zero if ANY assertion fails.
 * Does NOT modify any app source.
 *
 * Run:  node scripts/v133-test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../src/main/db');
const drive = require('../src/main/drive');
const reports = require('../src/main/reports');
const model = require('../src/shared/model');

// ---------------------------------------------------------------------------
// Tiny test runner (matches flow-test.js / v132-test.js conventions)
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

const ROOT = path.join(os.tmpdir(), 'gdr-v133-test-' + Date.now());
fs.mkdirSync(ROOT, { recursive: true });
let driveSeq = 0;
function newDriveDir() {
  const d = path.join(ROOT, 'drive-' + (++driveSeq));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function tick() { const until = Date.now() + 3; while (Date.now() < until) { /* spin */ } }

function readSrc(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

// db assigns patient_number in the real flow; these fixtures bypass db, so the
// number is supplied explicitly (drive.writePatient rejects a numberless chart).
let numSeq = 500;

// A patient carrying a fully-filled slip.
function patientWithSlip(perms, extra = {}) {
  const p = model.newPatient({ patient_number: ++numSeq, first_name: 'Ana', last_name: 'Lopez', school_group: 'Esc. Benito Juarez', age_at_first_visit: 9, sex: 'F', drive_number: 1 });
  p.consent = Object.assign(model.newConsent(), {
    signed: true,
    signatory_name: 'Maria Lopez',
    signature_image: 'data:image/png;base64,AAAA',
    signed_date: model.nowISO(),
    permissions: perms,
    child_name: 'Ana Lopez',
    school: 'Esc. Benito Juarez',
    phone: '555-0143'
  }, extra);
  return p;
}

// A pre-v1.3.3 record: signed, but no `permissions` key at all.
function legacyPatient() {
  const p = model.newPatient({ patient_number: ++numSeq, first_name: 'Luis', last_name: 'Ramirez', school_group: 'Esc. Morelos', age_at_first_visit: 11, sex: 'M', drive_number: 2 });
  p.consent = {
    signed: true,
    signatory_name: 'Rosa Ramirez',
    signature_image: 'data:image/png;base64,BBBB',
    signed_date: model.nowISO()
  };
  return p;
}

// ---------------------------------------------------------------------------
// 1. consentPermissions contract
// ---------------------------------------------------------------------------
function test1_permissionsContract() {
  section('1. consentPermissions() contract');

  const blank = model.newConsent();
  eq(JSON.stringify(blank.permissions), JSON.stringify({ cleaning: false, fillings: false, extractions: false }),
    'newConsent() starts with all three boxes UNTICKED (parent must opt in)');
  eq(blank.child_name, '', 'newConsent() carries child_name');
  eq(blank.school, '', 'newConsent() carries school (Escuela)');
  eq(blank.phone, '', 'newConsent() carries phone');

  eq(JSON.stringify(model.PERMISSION_KEYS), JSON.stringify(['cleaning', 'fillings', 'extractions']),
    'PERMISSION_KEYS is the fixed slip order');

  const all = model.consentPermissions(patientWithSlip({ cleaning: true, fillings: true, extractions: true }));
  truthy(all.cleaning && all.fillings && all.extractions, 'all three ticked -> all granted');
  eq(all.denied.length, 0, 'all three ticked -> denied is empty');
  falsy(all.legacy, 'a real slip is not flagged legacy');

  const none = model.consentPermissions(patientWithSlip({ cleaning: false, fillings: false, extractions: false }));
  eq(none.denied, ['cleaning', 'fillings', 'extractions'], 'no boxes ticked -> all three denied, in slip order');
  falsy(none.cleaning || none.fillings || none.extractions, 'no boxes ticked -> nothing granted');

  const partial = model.consentPermissions(patientWithSlip({ cleaning: true, fillings: false, extractions: false }));
  eq(partial.denied, ['fillings', 'extractions'], 'cleaning-only slip -> fillings + extractions denied');
  truthy(partial.cleaning, 'cleaning-only slip -> cleaning granted');

  const extractOnly = model.consentPermissions(patientWithSlip({ cleaning: false, fillings: true, extractions: false }));
  eq(extractOnly.denied, ['cleaning', 'extractions'], 'fillings-only slip -> cleaning + extractions denied');
}

// ---------------------------------------------------------------------------
// 2. Legacy safety — the false-alarm guard
// ---------------------------------------------------------------------------
function test2_legacySafety() {
  section('2. LEGACY records must not trip the red popup');

  const legacy = model.consentPermissions(legacyPatient());
  truthy(legacy.legacy, 'pre-v1.3.3 consent (no permissions key) is flagged legacy');
  truthy(legacy.cleaning && legacy.fillings && legacy.extractions,
    'legacy blanket consent reads as all three GRANTED');
  eq(legacy.denied.length, 0,
    'legacy record denies nothing -> returning patients never trip a false alarm');

  // Junk / absent input must degrade to the same safe legacy answer, never throw.
  const cases = [
    ['null patient', null],
    ['undefined patient', undefined],
    ['patient with no consent', { id: 'x' }],
    ['consent with null permissions', { consent: { signed: true, permissions: null } }],
    ['consent with non-object permissions', { consent: { signed: true, permissions: 'yes' } }]
  ];
  cases.forEach(([label, input]) => {
    let r = null;
    try { r = model.consentPermissions(input); } catch (e) { fail(`${label} must not throw (${e.message})`); return; }
    truthy(r && r.legacy && r.denied.length === 0, `${label} -> safe legacy-granted, no throw`);
  });
}

// ---------------------------------------------------------------------------
// 3. Slip survives the drive round-trip
// ---------------------------------------------------------------------------
function test3_driveRoundTrip() {
  section('3. Slip survives drive.write -> db.mergeFromDrive');

  const dir = newDriveDir();
  const p = patientWithSlip({ cleaning: true, fillings: false, extractions: false });
  const w = drive.writePatient(dir, p);
  truthy(w.ok, 'drive.writePatient accepted the slip-bearing record');

  const r = drive.readPatient(dir);
  truthy(r.ok, 'drive.readPatient round-tripped (checksum intact)');
  const back = r.patient;

  eq(JSON.stringify(back.consent.permissions), JSON.stringify({ cleaning: true, fillings: false, extractions: false }),
    'permissions survive the drive round-trip verbatim');
  eq(back.consent.child_name, 'Ana Lopez', "child's name survives the drive round-trip");
  eq(back.consent.school, 'Esc. Benito Juarez', 'Escuela survives the drive round-trip');
  eq(back.consent.phone, '555-0143', 'phone survives the drive round-trip');

  const merged = db.mergePatient(null, back);
  eq(JSON.stringify(merged.consent.permissions), JSON.stringify({ cleaning: true, fillings: false, extractions: false }),
    'permissions survive the master merge');
  const perms = model.consentPermissions(merged);
  eq(perms.denied, ['fillings', 'extractions'],
    'a station reading the merged record still sees the two denials');
}

// ---------------------------------------------------------------------------
// 4. Merge downgrade guard
// ---------------------------------------------------------------------------
function test4_mergeDowngradeGuard() {
  section('4. Merge must not DOWNGRADE a slip');

  // Master already holds a real slip; an older laptop still writes legacy consent.
  const master = patientWithSlip({ cleaning: true, fillings: false, extractions: false });
  const masterMerged = db.mergePatient(null, master);
  tick();

  const stale = JSON.parse(JSON.stringify(masterMerged));
  delete stale.consent.permissions;           // legacy copy: no boxes at all
  delete stale.consent.child_name;
  delete stale.consent.school;
  delete stale.consent.phone;
  stale.consent.signed_date = model.nowISO(); // and it is NEWER
  stale.last_modified = model.nowISO();

  const after = db.mergePatient(masterMerged, stale);
  truthy(after.consent.permissions, 'a legacy copy does NOT erase the master permissions object');
  eq(JSON.stringify(after.consent.permissions), JSON.stringify({ cleaning: true, fillings: false, extractions: false }),
    'the per-treatment opt-ins are carried forward intact');
  eq(after.consent.child_name, 'Ana Lopez', 'child_name carried forward when the incoming copy lacks it');
  eq(after.consent.school, 'Esc. Benito Juarez', 'school carried forward when the incoming copy lacks it');
  eq(after.consent.phone, '555-0143', 'phone carried forward when the incoming copy lacks it');
  eq(model.consentPermissions(after).denied, ['fillings', 'extractions'],
    'the station still sees the denials after a legacy save landed on top');

  // A genuinely re-signed slip MUST win — including revoking a previously granted box.
  const resigned = JSON.parse(JSON.stringify(masterMerged));
  resigned.consent.permissions = { cleaning: false, fillings: true, extractions: false };
  resigned.consent.signed_date = model.nowISO();
  resigned.last_modified = model.nowISO();
  const after2 = db.mergePatient(masterMerged, resigned);
  eq(JSON.stringify(after2.consent.permissions), JSON.stringify({ cleaning: false, fillings: true, extractions: false }),
    'a re-signed slip fully replaces the old boxes (a REVOKED cleaning stays revoked)');
  eq(model.consentPermissions(after2).denied, ['cleaning', 'extractions'],
    'revocation is visible to the stations');

  // An UNSIGNED incoming copy must never clobber a signed slip.
  const unsigned = JSON.parse(JSON.stringify(masterMerged));
  unsigned.consent = { signed: false, signatory_name: '', signature_image: null, signed_date: null };
  unsigned.last_modified = model.nowISO();
  const after3 = db.mergePatient(masterMerged, unsigned);
  truthy(after3.consent.signed, 'an unsigned copy never clobbers a signed slip');
  eq(JSON.stringify(after3.consent.permissions), JSON.stringify({ cleaning: true, fillings: false, extractions: false }),
    'permissions survive an unsigned incoming copy');

  // Merge must not mutate its inputs.
  eq(JSON.stringify(masterMerged.consent.permissions), JSON.stringify({ cleaning: true, fillings: false, extractions: false }),
    'db.mergePatient does not mutate the existing record');
}

// ---------------------------------------------------------------------------
// 5. Denials are display-only (never change reporting)
// ---------------------------------------------------------------------------
function test5_reportsUnaffected() {
  section('5. Consent denials are display-only (never change report math)');

  const rowsToMap = (stats) => { const o = {}; stats.rows.forEach((r) => { o[r.key] = r.count; }); return o; };

  // Seed the SAME completed work under a fully-granted slip, then under a
  // fully-denied one. The consent boxes are a clinician-facing warning; they
  // must never silently suppress work that was actually performed and recorded.
  function seed(perms, who) {
    db._reset();
    const p = db.createPatient({ first_name: who, last_name: 'Slip', age_at_first_visit: 9, sex: 'F', drive_number: 8 });
    p.consent = Object.assign(model.newConsent(), {
      signed: true, signatory_name: 'Tutor', signed_date: model.nowISO(), permissions: perms
    });
    const v = model.newVisit(p);
    v.exam_type = 'E';
    v.treatment_items = [
      { id: 'c1', tooth: '19', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'dentist' },
      { id: 'c2', tooth: '18', treatment_type: 'extraction', surfaces: [], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'dentist' }
    ];
    v.visit_outcome = 'F';
    v.checkout_timestamp = model.nowISO();
    v.last_modified = model.nowISO();
    p.visits.push(v);
    db.uploadPatient(p);
    return rowsToMap(reports.computeStats({}));
  }

  const granted = seed({ cleaning: true, fillings: true, extractions: true }, 'Granted');
  const denied = seed({ cleaning: false, fillings: false, extractions: false }, 'Denied');

  eq(granted.fill_single, 1, 'granted-slip patient: the completed fill is counted');
  eq(denied.fill_single, 1, 'denied-slip patient: the completed fill is STILL counted (warning is display-only)');
  eq(denied.ext_permanent, granted.ext_permanent, 'extraction counts identical regardless of the consent boxes');
  eq(JSON.stringify(denied), JSON.stringify(granted),
    'identical clinical work reports identically whatever the parent ticked');

  db._reset();
}

// ---------------------------------------------------------------------------
// 6. Source-level proof: draft gone, keys parallel, both stations gated
// ---------------------------------------------------------------------------
function test6_sourceProof() {
  section('6. Real slip replaced the draft; both stations gate on it');

  const consentSrc = readSrc('src/renderer/consent.js');
  falsy(/CONSENT_DRAFT_NOTICE/.test(consentSrc), 'the BORRADOR/draft notice is gone from consent.js');
  falsy(/CONSENT_PARAGRAPHS/.test(consentSrc), 'the old draft paragraphs are gone from consent.js');
  falsy(/pendiente del texto oficial/.test(consentSrc), 'the "pending official text" placeholder is gone');

  const checkin = readSrc('src/renderer/views/checkin.js');
  // The persistence whitelist at check-in must carry every new slip field, or
  // the parent's answers are silently dropped on the way to the record.
  ['permissions', 'child_name', 'school', 'phone'].forEach((k) => {
    truthy(new RegExp('patient\\.consent\\s*=\\s*\\{[\\s\\S]{0,900}?\\b' + k + '\\s*:').test(checkin),
      `check-in persists consent.${k} (whitelist extended)`);
  });

  const dentist = readSrc('src/renderer/views/dentist.js');
  const cleaning = readSrc('src/renderer/views/cleaning.js');
  truthy(/consentPermissions|consentLimits/.test(dentist), 'dentist station consults the consent permissions');
  truthy(/consentPermissions|consentLimits/.test(cleaning), 'hygienist station consults the consent permissions');

  const shared = readSrc('src/renderer/components/shared.js');
  truthy(/consentLimitsBanner/.test(shared), 'the standing red banner is a SHARED component (not duplicated per station)');
  truthy(/consentLimitsBanner/.test(dentist) && /consentLimitsBanner/.test(cleaning),
    'both stations render the identical shared banner');

  // i18n parity: the whole suite depends on en/es staying key-for-key parallel.
  const enSrc = readSrc('src/renderer/i18n/en.js');
  const esSrc = readSrc('src/renderer/i18n/es.js');
  const NEW_KEYS = [
    'consent_slip_title', 'consent_slip_intro', 'consent_slip_receives', 'consent_slip_lead',
    'consent_slip_tail', 'consent_perm_cleaning', 'consent_perm_fillings', 'consent_perm_extractions',
    'consent_child_name', 'consent_school', 'consent_parent_signature', 'consent_phone',
    'consent_guardian_name', 'consent_limits_title', 'consent_limits_intro', 'consent_limits_ack',
    'consent_limits_banner', 'consent_limits_none', 'consent_unsigned', 'consent_all_granted'
  ];
  let missing = [];
  NEW_KEYS.forEach((k) => {
    if (!new RegExp('\\b' + k + '\\s*:').test(enSrc)) missing.push('en.' + k);
    if (!new RegExp('\\b' + k + '\\s*:').test(esSrc)) missing.push('es.' + k);
  });
  eq(missing.length, 0, 'all 20 new slip/limit keys exist in BOTH dictionaries' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));

  // The clinic prints "Escuela" on their English sheet too — keep it verbatim.
  truthy(/consent_school\s*:\s*['"]Escuela['"]/.test(enSrc), 'consent_school stays "Escuela" in the English dictionary (matches the paper form)');
}

// ---------------------------------------------------------------------------
(function main() {
  console.log('=========================================================');
  console.log('GDR v1.3.3 — permission slip + consent-restriction harness');
  console.log('=========================================================');
  console.log('drive root:   ', ROOT);

  const tests = [
    test1_permissionsContract,
    test2_legacySafety,
    test3_driveRoundTrip,
    test4_mergeDowngradeGuard,
    test5_reportsUnaffected,
    test6_sourceProof
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
    console.log('\nVERDICT: v1.3.3 permission-slip behaviour is NOT fully correct (see failures above).');
    process.exit(1);
  } else {
    console.log('\nVERDICT: v1.3.3 permission slip (opt-in boxes / legacy safety / drive round-trip / merge downgrade guard / station gating) is FULLY CORRECT.');
    process.exit(0);
  }
})();
