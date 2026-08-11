'use strict';
/*
 * Demo-data seed for PRODUCT SCREENSHOTS (TEST-ONLY).
 *
 * Populates the simulated flash drive + master ledger with a realistic clinic
 * day so the captured screens look like real use rather than empty templates.
 *
 * EVERY name here is invented. Nothing in this file is, or is derived from, a
 * real patient — these images are meant for a public website.
 *
 * Usage:  node scripts/shots-seed.js [--consent-denied]
 *   --consent-denied  the chart patient's slip declines fillings + extractions,
 *                     so the station raises the red consent warning (for the
 *                     screenshot of that dialog).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const model = require('../src/shared/model');
const checksum = require('../src/shared/checksum');

function electronUserData() {
  const appName = require('../package.json').name;
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdg, appName);
}
const DATA_DIR = electronUserData();
const SIM_DRIVE = path.join(DATA_DIR, 'sim-drive');
const MASTER_DIR = path.join(DATA_DIR, 'master');
const MASTER_FILE = path.join(MASTER_DIR, 'master_db.json');
fs.mkdirSync(SIM_DRIVE, { recursive: true });
fs.mkdirSync(MASTER_DIR, { recursive: true });

const consentDenied = process.argv.includes('--consent-denied');

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// The chart patient shown on the station screens.
// ---------------------------------------------------------------------------
const SCHOOL = 'Escuela Primaria Benito Juárez';
const patient = model.newPatient({
  patient_number: 147,
  school_group: SCHOOL,
  first_name: 'Sofía',
  last_name: 'Hernández',
  age_at_first_visit: 9,
  sex: 'F',
  drive_number: 7
});

// A couple of medical flags so the alert banner is visible in the shots.
patient.medical_history.asthma = true;
patient.medical_history.allergies = true;
patient.medical_history.allergies_text = 'Penicilina';
patient.medical_history.last_updated = model.nowISO();

patient.consent = Object.assign(model.newConsent(), {
  signed: true,
  signatory_name: 'María Hernández',
  signed_date: model.nowISO(),
  permissions: consentDenied
    ? { cleaning: true, fillings: false, extractions: false }
    : { cleaning: true, fillings: true, extractions: true },
  child_name: 'Sofía Hernández',
  school: SCHOOL,
  phone: '555 128 4471'
});

// A prior visit so the visit-history panel has content.
const older = model.newVisit(patient);
older.visit_date = daysAgo(372);
older.exam_type = 'E';
older.clinician_type = 'DDS';
older.clinician_initials = 'RM';
older.cleaning_type = 'P';
older.oh1_done = true; older.oh2_done = true;
older.fluoride_done = true;
older.visit_outcome = 'F';
older.checkout_timestamp = older.visit_date + 'T15:20:00.000Z';
older.treatment_items = [
  { id: 'h1', tooth: '30', treatment_type: 'sealant', surfaces: [], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'cleaning' }
];
older.station_status = { checkin: true, dentist: true, cleaning: true, fluoride: true, checkout: true };
patient.visits.push(older);

// Today's visit — a charted plan mid-treatment.
const visit = model.newVisit(patient);
visit.exam_type = 'R';
visit.clinician_type = 'DDS';
visit.clinician_initials = 'AM';
visit.rdh_initials = 'JL';
visit.cleaning_type = 'P';
visit.oh1_done = true;
visit.fluoride_recommended = true;
visit.tooth_conditions = { '19': 'urgent', '3': 'watch', '14': 'healthy', 'a': 'watch' };
visit.treatment_items = [
  { id: 's1', tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'dentist' },
  { id: 's2', tooth: '3', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false, not_done: false, planned_by: 'dentist', performed_by: null },
  { id: 's3', tooth: '30', treatment_type: 'sealant', surfaces: [], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'cleaning', performed_by: 'cleaning' },
  { id: 's4', tooth: 'a', treatment_type: 'sdf', surfaces: [], surgical: false, treating_today: true, complete: false, not_done: false, planned_by: 'cleaning', performed_by: null }
];
visit.treatment_notes = '19-OB, 3-O, 30-seal, a-SDF';
visit.station_status.checkin = true;
visit.station_status.dentist = true;
visit.last_modified = model.nowISO();
patient.visits.push(visit);

for (const f of fs.readdirSync(SIM_DRIVE)) {
  if (/^patient_\d+\.json$/i.test(f)) fs.unlinkSync(path.join(SIM_DRIVE, f));
}
const target = path.join(SIM_DRIVE, `patient_${String(147).padStart(5, '0')}.json`);
fs.writeFileSync(target, JSON.stringify(checksum.wrap(patient), null, 2), 'utf8');

// ---------------------------------------------------------------------------
// A populated master ledger so the Reports screen shows a real clinic week.
// ---------------------------------------------------------------------------
const FIRST = ['Sofía', 'Mateo', 'Valentina', 'Diego', 'Camila', 'Santiago', 'Lucía', 'Emiliano',
  'Regina', 'Sebastián', 'Ximena', 'Andrés', 'Renata', 'Iker', 'Danna', 'Bruno',
  'Paulina', 'Leonardo', 'Fernanda', 'Maximiliano'];
const LAST = ['Hernández', 'García', 'Martínez', 'López', 'Ramírez', 'Torres', 'Flores', 'Cruz',
  'Morales', 'Reyes', 'Jiménez', 'Vargas'];
const SCHOOLS = [SCHOOL, 'Escuela Primaria Morelos', 'Escuela Primaria Emiliano Zapata'];

const patients = {};
let counter = 147;
let seq = 0;
function pick(arr) { return arr[(seq * 7 + arr.length) % arr.length]; }

for (let day = 4; day >= 0; day--) {
  const perDay = [11, 14, 12, 15, 9][day];
  for (let i = 0; i < perDay; i++) {
    seq++;
    counter++;
    const p = model.newPatient({
      patient_number: counter,
      school_group: SCHOOLS[seq % SCHOOLS.length],
      first_name: pick(FIRST),
      last_name: LAST[(seq * 5) % LAST.length],
      age_at_first_visit: 6 + (seq % 9),
      sex: seq % 2 ? 'F' : 'M',
      drive_number: 1 + (seq % 8)
    });
    p.created_date = daysAgo(day);
    const v = model.newVisit(p);
    v.visit_date = daysAgo(day);
    v.exam_type = seq % 5 === 0 ? 'R' : 'E';
    v.clinician_type = seq % 3 === 0 ? 'RDH' : 'DDS';
    v.clinician_initials = ['AM', 'RM', 'JL', 'KP'][seq % 4];
    v.cleaning_type = seq % 7 === 0 ? 'D' : 'P';
    // An ordered cleaning is normally carried out the same visit; leaving this
    // unset would report 61 cleanings recommended and 0 performed.
    v.cleaning_done = seq % 8 !== 0;
    v.cleaning_done_at = v.cleaning_done ? daysAgo(day) + 'T15:40:00.000Z' : null;
    v.oh1_done = true;
    v.oh2_done = seq % 4 !== 0;
    v.fluoride_done = seq % 6 !== 0;
    v.visit_outcome = seq % 11 === 0 ? 'NV' : 'F';

    const items = [];
    const nFill = seq % 3;
    for (let f = 0; f < nFill; f++) {
      items.push({
        id: `p${counter}-f${f}`, tooth: String(2 + ((seq + f) % 28)),
        treatment_type: 'restoration',
        surfaces: f === 0 ? ['O'] : ['O', 'B'],
        surgical: false, treating_today: true, complete: true, not_done: false,
        planned_by: 'dentist', performed_by: 'dentist'
      });
    }
    if (seq % 4 === 0) {
      items.push({
        id: `p${counter}-x`, tooth: seq % 8 === 0 ? 'k' : String(1 + (seq % 32)),
        treatment_type: 'extraction', surfaces: [], surgical: seq % 12 === 0,
        treating_today: true, complete: true, not_done: false,
        planned_by: 'dentist', performed_by: 'dentist'
      });
    }
    if (seq % 2 === 0) {
      items.push({
        id: `p${counter}-s`, tooth: String(2 + (seq % 30)),
        treatment_type: 'sealant', surfaces: [], surgical: false,
        treating_today: true, complete: true, not_done: false,
        planned_by: 'cleaning', performed_by: 'cleaning'
      });
    }
    if (seq % 9 === 0) {
      items.push({
        id: `p${counter}-d`, tooth: String(2 + (seq % 20)),
        treatment_type: 'sdf', surfaces: [], surgical: false,
        treating_today: true, complete: true, not_done: false,
        planned_by: 'cleaning', performed_by: 'cleaning'
      });
    }
    v.treatment_items = items;
    v.checkout_timestamp = daysAgo(day) + 'T16:05:00.000Z';
    v.station_status = { checkin: true, dentist: true, cleaning: true, fluoride: true, checkout: true };
    v.last_modified = model.nowISO();
    p.visits.push(v);
    p.consent = Object.assign(model.newConsent(), {
      signed: true, signatory_name: 'Tutor', signed_date: v.visit_date,
      permissions: { cleaning: true, fillings: true, extractions: true },
      child_name: model.fullName(p), school: p.school_group
    });
    patients[p.id] = p;
  }
}

fs.writeFileSync(MASTER_FILE, JSON.stringify({
  schema_version: model.SCHEMA_VERSION,
  created_at: model.nowISO(),
  last_modified: model.nowISO(),
  counter,
  patients,
  drives: {}
}, null, 2), 'utf8');

console.log('[shots-seed] data dir:   ', DATA_DIR);
console.log('[shots-seed] sim drive:  ', target);
console.log('[shots-seed] consent:    ', consentDenied ? 'DENIED (fillings + extractions)' : 'fully granted');
console.log('[shots-seed] ledger:     ', Object.keys(patients).length, 'patients across 5 clinic days');
