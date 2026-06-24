'use strict';
/*
 * Headless smoke test of the core logic (no GUI / no Electron).
 * Exercises the full clinic flow: create -> drive write/read -> dentist edit ->
 * cleaning/fluoride -> checkout upload -> clear drive -> report -> export.
 * Run: npm run smoke
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate data dir for the test.
const TEST_DIR = path.join(os.tmpdir(), 'gdr-smoke-' + Date.now());
fs.mkdirSync(TEST_DIR, { recursive: true });
process.env.GDR_TEST_DIR = TEST_DIR;

// Point paths at the test dir by faking electron app userData via env-aware fallback.
// paths.js uses os.tmpdir()/gdr-clinic-data outside electron; reset DB to keep it clean.
const db = require('../src/main/db');
const drive = require('../src/main/drive');
const reports = require('../src/main/reports');
const users = require('../src/main/users');
const model = require('../src/shared/model');
const codes = require('../src/shared/codes');
const checksum = require('../src/shared/checksum');

let pass = 0;
function ok(name) { pass++; console.log('  ✓', name); }

(async function run() {
  console.log('GDR smoke test\n');

  db._reset();

  // 1. Code engine
  assert.strictEqual(codes.formatItem({ tooth: '19', treatment_type: 'restoration', surfaces: ['B', 'O'] }), '19-OB');
  assert.strictEqual(codes.formatItem({ tooth: '20', treatment_type: 'extraction', surgical: true }), '20-extS');
  assert.strictEqual(codes.formatItem({ tooth: 'a', treatment_type: 'extraction' }), 'a-ext');
  assert.strictEqual(codes.formatItem({ tooth: '31', treatment_type: 'sealant' }), '31-seal');
  assert.strictEqual(codes.formatItem({ tooth: '30', treatment_type: 'sdf' }), '30-SDF');
  assert.strictEqual(codes.formatItem({ tooth: '15', treatment_type: 'composite', surfaces: ['O', 'B'] }), '15-OB comp');
  assert.strictEqual(codes.classifyItem({ tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'] }), 'fill_double');
  assert.strictEqual(codes.classifyItem({ tooth: '8', treatment_type: 'restoration', surfaces: ['F'] }), 'fill_single');
  assert.strictEqual(codes.classifyItem({ tooth: '3', treatment_type: 'restoration', surfaces: ['M', 'O', 'D'] }), 'fill_multi');
  assert.strictEqual(codes.classifyToken('18-ext'), 'ext_permanent');
  assert.strictEqual(codes.classifyToken('a-ext'), 'ext_primary');
  assert.strictEqual(codes.classifyToken('20-extS'), 'ext_surgical');
  ok('code engine formats & classifies treatment codes (6.3 / 8.1)');

  // 2. Checksum envelope
  const env = checksum.wrap({ id: 'x', patient_number: 1, foo: [1, 2, 3] });
  assert.strictEqual(checksum.unwrap(env).ok, true);
  env.payload.foo.push(999); // tamper
  assert.strictEqual(checksum.unwrap(env).ok, false);
  ok('flash-drive checksum detects tampering/corruption (10.3)');

  // 3. Create patient (numbering)
  const p = db.createPatient({ school_group: 'Escuela A', first_name: 'Juan', last_name: 'García', age_at_first_visit: 9, sex: 'M', drive_number: 7 });
  assert.strictEqual(p.patient_number, 1);
  assert.ok(p.id);
  const p2 = db.createPatient({ school_group: 'Escuela A', first_name: 'María', age_at_first_visit: 8, sex: 'F', drive_number: 8 });
  assert.strictEqual(p2.patient_number, 2);
  ok('patient creation assigns sequential numbers (4.1)');

  // medical alert
  p.medical_history.allergies = true; p.medical_history.allergies_text = 'penicilina';
  assert.strictEqual(model.activeAlerts(p.medical_history).length, 1);
  db.savePatient(p);
  ok('medical high-priority alerts surface (4.2 / 5.2)');

  // 4. Flash drive write/read at check-in
  const driveDir = path.join(TEST_DIR, 'drive001');
  fs.mkdirSync(driveDir, { recursive: true });
  const visit = model.newVisit(p); visit.oh1_done = true; visit.station_status.checkin = true;
  p.visits.push(visit); db.savePatient(p);
  let w = drive.writePatient(driveDir, p);
  assert.strictEqual(w.ok, true);
  assert.strictEqual(w.name, 'patient_00001.json'); // named by number not name (10.2)
  let r = drive.readPatient(driveDir);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.patient.first_name, 'Juan');
  ok('drive write/read round-trips, file named by number (2.2 / 10.2)');

  // 5. Dentist edits on the drive copy
  const dpat = r.patient;
  const dvisit = model.lastVisit(dpat);
  dvisit.exam_type = 'E'; dvisit.clinician_type = 'DDS'; dvisit.clinician_initials = 'AB';
  dvisit.treatment_items.push({ id: model.uuid(), tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true });
  dvisit.treatment_items.push({ id: model.uuid(), tooth: '18', treatment_type: 'extraction', surgical: false, treating_today: true, complete: true });
  dvisit.cleaning_type = 'P'; dvisit.oh2_done = true; dvisit.station_status.dentist = true;
  assert.strictEqual(drive.writePatient(driveDir, dpat).ok, true);
  ok('dentist treatment plan saved to drive (5.2)');

  // 6. Cleaning + fluoride
  let cur = drive.readPatient(driveDir).patient;
  let cv = model.lastVisit(cur);
  cv.cleaning_done = true; cv.cleaning_done_at = model.nowISO(); cv.station_status.cleaning = true;
  drive.writePatient(driveDir, cur);
  cur = drive.readPatient(driveDir).patient; cv = model.lastVisit(cur);
  cv.oh3_done = true; cv.fluoride_done = true; cv.fluoride_done_at = model.nowISO(); cv.station_status.fluoride = true;
  drive.writePatient(driveDir, cur);
  ok('cleaning + fluoride logged to drive (5.3 / 5.4)');

  // 7. Checkout upload + clear (two-step, 5.5)
  cur = drive.readPatient(driveDir).patient;
  const fv = model.lastVisit(cur);
  fv.visit_outcome = 'NV'; fv.station_status.checkout = true;
  const up = db.uploadPatient(cur);
  assert.strictEqual(up.ok !== false, true);
  const stored = db.getPatient(p.id);
  assert.ok(model.lastVisit(stored).checkout_timestamp, 'checkout_timestamp stamped');
  // clear
  const cl = drive.clearDrive(driveDir);
  assert.strictEqual(cl.ok, true);
  assert.strictEqual(drive.findPatientFile(driveDir), null);
  ok('checkout upload stamps + drive clears (5.5)');

  // 8. NV dashboard
  const nv = db.listNV();
  assert.strictEqual(nv.length, 1);
  assert.strictEqual(nv[0].patient_number, 1);
  ok('NV recall dashboard lists pending patient (7.3)');

  // 9. Reports
  const stats = reports.computeStats({});
  const get = (k) => stats.rows.find((x) => x.key === k).count;
  assert.strictEqual(get('fill_double'), 1, 'one double-surface filling');
  assert.strictEqual(get('ext_permanent'), 1, 'one permanent extraction');
  assert.strictEqual(get('cleaning_prophy'), 1, 'one prophy');
  assert.strictEqual(get('fluoride'), 1, 'one fluoride');
  assert.strictEqual(get('oh_lessons'), 3, 'OH1+OH2+OH3');
  assert.strictEqual(get('total_patients'), 1, 'one checked-out patient');
  assert.strictEqual(get('nv_patients'), 1, 'one NV');
  assert.strictEqual(get('cleaning_recommended'), 1, 'one cleaning recommended (1.1.1)');
  assert.strictEqual(get('fluoride_recommended'), 1, 'one fluoride recommended (1.1.1)');
  ok('treatment summary counts are correct (8.1)');

  // 10. Exports
  const csv = reports.exportSummaryCSV(stats);
  assert.ok(fs.existsSync(csv));
  const mj = reports.exportMasterJSON();
  assert.ok(fs.existsSync(mj));
  const mc = reports.exportMasterCSV();
  assert.ok(fs.existsSync(mc));
  let xlsxOk = true;
  try { const xf = await reports.exportSummaryXLSX(stats); xlsxOk = typeof xf === 'string' && fs.existsSync(xf); }
  catch (e) { xlsxOk = false; }
  ok('exports written: CSV + master JSON/CSV' + (xlsxOk ? ' + XLSX' : ' (XLSX skipped: exceljs not installed)'));

  // 11. Import round-trip
  db._reset();
  const before = JSON.parse(fs.readFileSync(mj, 'utf8'));
  const imp = db.importMaster(before);
  assert.strictEqual(imp.ok, true);
  assert.ok(imp.total >= 1);
  ok('master DB export/import round-trips (8.3)');

  // 12. User accounts (username + password login + admin portal)
  users._reset();
  assert.strictEqual(users.authenticate('admin', 'welcome123').ok, true, 'admin/welcome123 logs in');
  assert.strictEqual(users.authenticate('admin', 'welcome123').user.role, 'admin');
  assert.strictEqual(users.authenticate('doctor', 'welcome123').user.role, 'dentist');
  assert.strictEqual(users.authenticate('hygienist', 'welcome123').user.role, 'cleaning');
  assert.strictEqual(users.authenticate('admin', 'wrong').ok, false, 'wrong password rejected');
  const created = users.create({ username: 'drnew', password: 'welcome123', role: 'dentist', display_name: 'Dr New' });
  assert.strictEqual(created.ok, true, 'create account');
  assert.strictEqual(users.create({ username: 'drnew', password: 'welcome123', role: 'dentist' }).error, 'username_taken');
  assert.strictEqual(users.changePassword(created.user.id, 'newpass1').ok, true, 'change password');
  assert.strictEqual(users.authenticate('drnew', 'newpass1').ok, true, 'login with new password');
  assert.strictEqual(users.authenticate('drnew', 'welcome123').ok, false, 'old password no longer works');
  const adminUser = users.list().find((u) => u.role === 'admin');
  assert.strictEqual(users.remove(adminUser.id).error, 'last_admin', 'cannot remove last admin');
  ok('user accounts: login, create, change password, last-admin guard');

  // 12b. Station merge accumulates into master (no checkout stamp) + field-merge
  {
    const id = db.allPatients()[0].id;
    const baseClin = model.lastVisit(db.getPatient(id)).clinician_initials;
    const partial = JSON.parse(JSON.stringify(db.getPatient(id)));
    const pv = model.lastVisit(partial);
    pv.oh3_done = true; pv.clinician_initials = ''; pv.last_modified = model.nowISO();
    db.mergeFromDrive(partial);
    const mv = model.lastVisit(db.getPatient(id));
    assert.strictEqual(mv.oh3_done, true, 'merge applies new flag');
    assert.strictEqual(mv.clinician_initials, baseClin, 'field-merge does not drop clinician');
    ok('station merge accumulates without checkout + preserves fields (1.1.3)');
  }

  // 12c. fluoride_recommended: dentist "no fluoride" sticks; not counted before dentist (1.1.5)
  {
    db._reset();
    const fp = db.createPatient({ first_name: 'F', school_group: 'E', age_at_first_visit: 7, sex: 'F' });
    const fv0 = model.newVisit(fp); fv0.oh1_done = true; fv0.station_status.checkin = true; fp.visits = [fv0]; db.savePatient(fp);
    const frCount = () => reports.computeStats({}).rows.find((x) => x.key === 'fluoride_recommended').count;
    assert.strictEqual(frCount(), 0, 'fluoride_recommended NOT counted before the dentist examines');
    // dentist turns fluoride OFF (e.g. heavy extraction)
    const d = JSON.parse(JSON.stringify(db.getPatient(fp.id))); const dv = model.lastVisit(d);
    dv.exam_type = 'E'; dv.fluoride_recommended = false; dv.last_modified = model.nowISO(); db.mergeFromDrive(d);
    assert.strictEqual(model.lastVisit(db.getPatient(fp.id)).fluoride_recommended, false, 'dentist no-fluoride decision kept');
    // a later STALE save carrying the default true must NOT restore the recommendation
    const stale = JSON.parse(JSON.stringify(db.getPatient(fp.id))); const sv = model.lastVisit(stale);
    sv.fluoride_recommended = true; sv.last_modified = model.nowISO(); db.mergeFromDrive(stale);
    assert.strictEqual(model.lastVisit(db.getPatient(fp.id)).fluoride_recommended, false, 'stale default does not restore fluoride recommendation');
    assert.strictEqual(frCount(), 0, 'a declined-fluoride visit is not counted as recommended');
    ok('fluoride_recommended override sticks + gated on dentist exam (1.1.5)');
  }

  // 13. Clear patients (new ledger) + reset numbering
  const beforeClear = db.allPatients().length;
  assert.ok(beforeClear > 0, 'there are patients to clear');
  const cleared = db.clearAllPatients({ resetCounter: true });
  assert.strictEqual(cleared.removed, beforeClear, 'all patients removed');
  assert.strictEqual(db.allPatients().length, 0, 'ledger is empty');
  assert.strictEqual(db.peekNextNumber(), 1, 'numbering reset to start');
  ok('clear patients wipes ledger + resets numbering (1.1.0)');

  console.log(`\nAll ${pass} checks passed ✅`);
  console.log('Data dir:', require('../src/main/paths').base());
})().catch((e) => { console.error('\n✗ SMOKE TEST FAILED:\n', e); process.exit(1); });
