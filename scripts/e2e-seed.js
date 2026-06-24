'use strict';
/*
 * E2E seed helper (TEST-ONLY).
 *
 * Writes a fresh, check-in-state patient onto the SIMULATED flash drive that the
 * Electron app reads (~/.config/gdr-clinic/sim-drive/patient_NNNNN.json) using
 * the REAL shared modules (model + checksum) and the REAL drive transport. Also
 * optionally resets the master DB so a multi-station UI pass starts clean.
 *
 * This script does NOT touch app/business logic — it only prepares fixtures, the
 * same way the front-desk station would have written the drive at check-in.
 *
 * IMPORTANT: it must resolve the SAME data dir the Electron app uses. Outside
 * Electron, paths.js falls back to os.tmpdir(). To target the app's real dir we
 * point GDR at Electron's userData by requiring electron's app path is not
 * available here, so we compute it from $HOME/.config/<name> the way Electron's
 * app.getPath('userData') does on Linux (XDG config + productName/name).
 *
 * Usage:
 *   node scripts/e2e-seed.js                # seed patient 147, reset master
 *   node scripts/e2e-seed.js --keep-master  # seed patient, keep master DB
 *   node scripts/e2e-seed.js --number 200   # custom patient number
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const model = require('../src/shared/model');
const checksum = require('../src/shared/checksum');

// ---- Resolve the Electron userData dir on Linux --------------------------
// Electron uses $XDG_CONFIG_HOME (default ~/.config) + the app "name" from
// package.json. For this app that is "gdr-clinic".
function electronUserData() {
  const appName = require('../package.json').name; // 'gdr-clinic'
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, appName);
}

const DATA_DIR = electronUserData();
const SIM_DRIVE = path.join(DATA_DIR, 'sim-drive');
const MASTER_DIR = path.join(DATA_DIR, 'master');
const MASTER_FILE = path.join(MASTER_DIR, 'master_db.json');

const args = process.argv.slice(2);
const keepMaster = args.includes('--keep-master');
const withDentist = args.includes('--with-dentist'); // pre-load a completed dentist plan
const noFluoride = args.includes('--no-fluoride');   // dentist turned fluoride OFF
const numIdx = args.indexOf('--number');
const patientNumber = numIdx >= 0 ? Number(args[numIdx + 1]) : 147;

fs.mkdirSync(SIM_DRIVE, { recursive: true });
fs.mkdirSync(MASTER_DIR, { recursive: true });

// ---- Build a fresh CHECK-IN-state patient (front desk only) --------------
// One visit, OH1 done, station_status.checkin true. NO dentist work yet, so the
// downstream "Treatment this visit (N)" must be 0 until the dentist saves.
const patient = model.newPatient({
  patient_number: patientNumber,
  school_group: 'Escuela E2E',
  first_name: 'Mateo',
  last_name: 'García',
  age_at_first_visit: 9,
  sex: 'M',
  drive_number: 7
});
const visit = model.newVisit(patient);
visit.oh1_done = true;
visit.station_status.checkin = true;
visit.last_modified = model.nowISO();

// Optionally pre-populate the dentist's completed plan so downstream stations can
// be tested independently of the check-in/dentist UI (e.g. the contextBridge bug
// would otherwise prevent a dentist's plan from ever reaching the drive in the UI).
if (withDentist) {
  visit.exam_type = 'E';
  visit.clinician_type = 'DDS';
  visit.clinician_initials = 'AB';
  visit.cleaning_type = 'P';
  visit.oh2_done = true;
  visit.fluoride_recommended = !noFluoride;
  visit.tooth_conditions = { '19': 'healthy', '3': 'urgent' };
  visit.treatment_items = [
    { id: 'seed-19-OB', tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true },
    { id: 'seed-18-ext', tooth: '18', treatment_type: 'extraction', surfaces: [], surgical: false, treating_today: true, complete: true }
  ];
  visit.station_status.dentist = true;
}
patient.visits.push(visit);

// ---- Write it to the sim drive (checksum-wrapped, named by number) --------
function patientFileName(n) {
  return `patient_${String(n == null ? 0 : n).padStart(5, '0')}.json`;
}
// Remove any stale patient files first (one chart per drive).
for (const f of fs.readdirSync(SIM_DRIVE)) {
  if (/^patient_\d+\.json$/i.test(f)) fs.unlinkSync(path.join(SIM_DRIVE, f));
}
const target = path.join(SIM_DRIVE, patientFileName(patientNumber));
fs.writeFileSync(target, JSON.stringify(checksum.wrap(patient), null, 2), 'utf8');

// Verify the checksum round-trips (mirrors drive.js verify-after-write).
const back = checksum.unwrap(JSON.parse(fs.readFileSync(target, 'utf8')));
if (!back.ok) {
  console.error('[seed] FAILED checksum verify:', back.reason);
  process.exit(1);
}

// ---- Reset the master DB to a clean ledger (unless --keep-master) ---------
if (!keepMaster) {
  const blank = {
    schema_version: model.SCHEMA_VERSION,
    created_at: model.nowISO(),
    last_modified: model.nowISO(),
    counter: Math.max(0, patientNumber - 1),
    patients: {},
    drives: {}
  };
  fs.writeFileSync(MASTER_FILE, JSON.stringify(blank, null, 2), 'utf8');
}

console.log('[seed] data dir:      ', DATA_DIR);
console.log('[seed] sim drive file:', target);
console.log('[seed] patient_number:', patientNumber, 'id:', patient.id);
console.log('[seed] visit station_status:', JSON.stringify(visit.station_status));
console.log('[seed] treatment_items:', visit.treatment_items.length, withDentist ? '(dentist plan pre-loaded)' : '(expected 0 at check-in)');
if (withDentist) console.log('[seed] fluoride_recommended:', visit.fluoride_recommended);
console.log('[seed] checksum verify: OK');
console.log('[seed] master reset:   ', keepMaster ? 'NO (kept)' : 'YES (clean ledger)');
