'use strict';
/*
 * Generate a fake-data sandbox for exercising the whole workflow.
 *
 *   sample-data/drive-files/patient_00XXX.json  -> load at Dentist/Cleaning/etc.
 *   sample-data/master_db_import.json           -> Import via Checkout > Reports
 *                                                  (populates Reports, NV board,
 *                                                   returning-patient search)
 *
 * Drive files are integrity-wrapped exactly like Check-In writes them. The
 * master import is the same shape as the app's "Export master DB (JSON)".
 */
const fs = require('fs');
const path = require('path');
const model = require('../src/shared/model');
const checksum = require('../src/shared/checksum');

const OUT = path.join(__dirname, '..', 'sample-data');
const DRIVES = path.join(OUT, 'drive-files');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(DRIVES, { recursive: true });

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function tx(tooth, type, surfaces, complete, surgical) {
  return { id: model.uuid(), tooth, treatment_type: type, surfaces: surfaces || [], surgical: !!surgical, treating_today: true, complete: complete !== false };
}
function patient(num, fields) {
  const p = model.newPatient(fields);
  p.patient_number = num;
  p.created_date = fields.created_date || daysAgo(180);
  return p;
}
function med(p, changes) { Object.assign(p.medical_history, changes); }
function consent(p, name) { p.consent = { signed: true, signatory_name: name, signature_image: null, signed_date: p.created_date + 'T10:00:00.000Z' }; }

// Blank current visit shell, as Check-In leaves it for the Dentist.
function shell(p) {
  const v = model.newVisit(p);
  v.oh1_done = true;
  v.station_status.checkin = true;
  return v;
}

function writeDrive(p) {
  const file = path.join(DRIVES, `patient_${String(p.patient_number).padStart(5, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(checksum.wrap(p), null, 2), 'utf8');
  return path.basename(file);
}

// ====================================================================
// 1) DRIVE FILES — four scenarios, each ready to load at the Dentist
// ====================================================================
const driveFiles = [];

// (a) Simple new patient, no alerts
let a = patient(201, { first_name: 'Sofía', last_name: 'Ramírez', school_group: 'Escuela Primaria Benito Juárez', age_at_first_visit: 7, sex: 'F', drive_number: 3, created_date: daysAgo(2) });
consent(a, 'Lucía Ramírez (madre)');
a.visits = [shell(a)];
driveFiles.push([writeDrive(a), 'New patient, no medical alerts']);

// (b) Allergy + asthma -> clinical alert banner
let b = patient(202, { first_name: 'Mateo', last_name: 'García Hernández', school_group: 'Escuela Primaria Benito Juárez', age_at_first_visit: 10, sex: 'M', drive_number: 7, created_date: daysAgo(2) });
med(b, { allergies: true, allergies_text: 'Penicilina', asthma: true });
consent(b, 'María Hernández (madre)');
b.visits = [shell(b)];
driveFiles.push([writeDrive(b), 'Allergy (penicillin) + asthma — shows the red alert banner']);

// (c) Returning patient with pending NV treatment from a prior visit
let c = patient(203, { first_name: 'Diego', last_name: 'López', school_group: 'Escuela Secundaria Morelos', age_at_first_visit: 12, sex: 'M', drive_number: 11, created_date: daysAgo(190) });
consent(c, 'Jorge López (padre)');
const cPrior = model.newVisit(c);
cPrior.visit_date = daysAgo(185);
cPrior.exam_type = 'E'; cPrior.clinician_type = 'DDS'; cPrior.clinician_initials = 'JR';
cPrior.treatment_items = [tx('19', 'restoration', ['O', 'B'], true), tx('14', 'restoration', ['M', 'O'], false)]; // 14-MO still pending
cPrior.cleaning_type = 'P'; cPrior.cleaning_done = true;
cPrior.oh1_done = cPrior.oh2_done = cPrior.oh3_done = true; cPrior.fluoride_done = true;
cPrior.visit_outcome = 'NV'; cPrior.checkout_timestamp = daysAgo(185) + 'T11:00:00.000Z';
cPrior.station_status = { checkin: true, dentist: true, cleaning: true, fluoride: true, checkout: true };
c.visits = [cPrior, shell(c)];
driveFiles.push([writeDrive(c), 'Returning patient — prior visit left 14-MO pending (NV)']);

// (d) Infectious disease + bleeding -> strong alert banner
let d = patient(204, { first_name: 'Valentina', last_name: 'Cruz', school_group: 'Escuela Primaria Hidalgo', age_at_first_visit: 9, sex: 'F', drive_number: 5, created_date: daysAgo(1) });
med(d, { infectious_disease: true, infectious_disease_text: 'Hepatitis B', bleeding_problems: true, bleeding_problems_text: 'Sangrado prolongado' });
consent(d, 'Ana Cruz (madre)');
d.visits = [shell(d)];
driveFiles.push([writeDrive(d), 'Infectious disease + bleeding problems — strongest alert banner']);

// ====================================================================
// 2) MASTER DB IMPORT — completed history so Reports/NV/search populate
// ====================================================================
const FIRST = ['Camila', 'Santiago', 'Valeria', 'Sebastián', 'Ximena', 'Emiliano', 'Regina', 'Maximiliano', 'Renata', 'Ángel', 'Fernanda', 'Leonardo'];
const LAST = ['Martínez', 'Sánchez', 'Flores', 'Gómez', 'Díaz', 'Reyes', 'Morales', 'Jiménez', 'Torres', 'Vázquez', 'Mendoza', 'Castillo'];
const SCHOOLS = ['Escuela Primaria Benito Juárez', 'Escuela Primaria Hidalgo', 'Escuela Secundaria Morelos'];

// Pre-baked treatment sets so every report category gets counts.
const TX_SETS = [
  [tx('19', 'restoration', ['O'], true)],                                   // single
  [tx('3', 'restoration', ['M', 'O'], true)],                               // double
  [tx('30', 'restoration', ['M', 'O', 'D'], true)],                         // multi
  [tx('8', 'composite', ['F'], true)],                                      // composite
  [tx('18', 'extraction', [], true)],                                       // perm ext
  [tx('a', 'extraction', [], true)],                                        // primary ext
  [tx('17', 'extraction', [], true, true)],                                 // surgical ext
  [tx('14', 'sealant', [], true), tx('15', 'sealant', [], true)],           // sealants
  [tx('29', 'sdf', [], true)],                                              // SDF
  [tx('19', 'restoration', ['O', 'B'], true), tx('30', 'sdf', [], true)],   // mixed
  [],                                                                       // NT-style (cleaning only)
  [tx('2', 'restoration', ['O'], true)]                                     // single
];

const masterPatients = [];
for (let i = 0; i < 12; i++) {
  const num = 301 + i;
  const p = patient(num, {
    first_name: FIRST[i], last_name: LAST[i],
    school_group: SCHOOLS[i % SCHOOLS.length],
    age_at_first_visit: 6 + (i % 10), sex: i % 2 ? 'M' : 'F',
    drive_number: (i % 20) + 1, created_date: daysAgo(9 - (i % 9))
  });
  if (i === 4) med(p, { allergies: true, allergies_text: 'Látex' });
  consent(p, `${LAST[i]} (tutor)`);
  const v = model.newVisit(p);
  v.visit_date = daysAgo(i % 9);
  v.exam_type = i % 4 === 0 ? 'R' : 'E';
  v.clinician_type = i % 3 === 0 ? 'RDH' : 'DDS';
  v.clinician_initials = ['AB', 'CD', 'EF', 'GH'][i % 4];
  v.treatment_items = TX_SETS[i];
  v.nt_status = TX_SETS[i].length === 0;
  v.cleaning_type = i % 2 ? 'P' : (i % 3 ? 'D' : 'P');
  v.cleaning_done = true;
  v.oh1_done = true; v.oh2_done = true; v.oh3_done = i % 2 === 0;
  v.fluoride_done = i % 5 !== 0;
  // two of them still need to come back
  v.visit_outcome = (i === 2 || i === 7) ? 'NV' : 'F';
  v.checkout_timestamp = v.visit_date + 'T11:30:00.000Z';
  v.station_status = { checkin: true, dentist: true, cleaning: true, fluoride: true, checkout: true };
  p.visits = [v];
  masterPatients.push(p);
}

const masterExport = {
  schema_version: model.SCHEMA_VERSION,
  exported_at: model.nowISO(),
  deployment: 'Mexico — sample data',
  counter: 312,
  patients: masterPatients
};
fs.writeFileSync(path.join(OUT, 'master_db_import.json'), JSON.stringify(masterExport, null, 2), 'utf8');

// ---- How-to ----
const howto = `GDR Clinic — Sample / fake data
================================

A) WALK A STATION (Dentist / Cleaning / Fluoride / Checkout)
   The "drive-files" folder contains ready-made patient files:
${driveFiles.map(([f, d]) => `      ${f}  — ${d}`).join('\n')}

   How to use:
   - Easiest: sign in (e.g. doctor / welcome123), click "Choose folder…",
     and select the drive-files folder. The app loads the patient in it.
   - Each file is ONE patient. To switch patients, put one file in its own
     folder, or copy a single file into  %APPDATA%\\gdr-clinic\\sim-drive
     and click "Simulation (test folder)".

B) POPULATE REPORTS + NV BOARD + RETURNING-PATIENT SEARCH
   - Sign in as  admin / welcome123  (or checkout / welcome123).
   - Go to Reports (admin: Settings is separate) and click "Import master DB".
   - Select  master_db_import.json.
   - Now: Reports show real treatment counts (use "All" + Generate), the NV
     Dashboard lists 2 patients, and Check-In "Returning Patient" search finds
     patients #301–#312 by name or number.

Note: this is FAKE data for testing only.
`;
fs.writeFileSync(path.join(OUT, 'HOW-TO.txt'), howto, 'utf8');

console.log('Drive files:', driveFiles.map((x) => x[0]).join(', '));
console.log('Master import patients:', masterPatients.length);
console.log('Output:', OUT);
