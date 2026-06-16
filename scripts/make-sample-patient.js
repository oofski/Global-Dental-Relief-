'use strict';
/*
 * Generate a sample patient file for the Doctor (Dentist) workflow demo.
 * Produces an integrity-wrapped patient_00147.json exactly as the Check-In
 * station would write it, with a prior NV visit (pending treatment) plus a
 * blank current-visit shell for the dentist to fill — matching the product
 * overview (5.1, 5.2, 6.x, 7.x).
 */
const fs = require('fs');
const path = require('path');
const model = require('../src/shared/model');
const checksum = require('../src/shared/checksum');

function item(tooth, type, surfaces, complete, surgical) {
  return { id: model.uuid(), tooth, treatment_type: type, surfaces: surfaces || [], surgical: !!surgical, treating_today: true, complete: !!complete };
}

// ---- Identity (4.1) ----
const p = model.newPatient({
  first_name: 'Mateo',
  last_name: 'García Hernández',
  school_group: 'Escuela Primaria Benito Juárez',
  age_at_first_visit: 9,
  sex: 'M',
  drive_number: 12
});
p.patient_number = 147;
p.created_date = '2025-12-10';

// ---- Medical history (4.2) — allergy triggers the clinical alert banner ----
p.medical_history.allergies = true;
p.medical_history.allergies_text = 'Penicilina';
p.medical_history.asthma = true;
p.medical_history.med_date_initial = '2025-12-10';

// ---- Consent (5.1) ----
p.consent = { signed: true, signatory_name: 'María Hernández (madre)', signature_image: null, signed_date: '2025-12-10T10:05:00.000Z' };

// ---- Prior visit (6 months ago) with pending NV treatment (7.3) ----
const prior = model.newVisit(p);
prior.visit_date = '2025-12-10';
prior.exam_type = 'E';
prior.clinician_type = 'DDS';
prior.clinician_initials = 'JR';
prior.treatment_items = [
  item('19', 'restoration', ['O', 'B'], true),   // 19-OB done
  item('18', 'extraction', [], true),            // 18-ext done
  item('30', 'sdf', [], true),                   // 30-SDF done
  item('31', 'sealant', [], true),               // 31-seal done
  item('3', 'restoration', ['O'], false)         // 3-O still needed -> NV
];
prior.cleaning_type = 'P';
prior.cleaning_done = true;
prior.cleaning_done_at = '2025-12-10T10:40:00.000Z';
prior.oh1_done = true; prior.oh2_done = true; prior.oh3_done = true;
prior.fluoride_done = true; prior.fluoride_done_at = '2025-12-10T10:50:00.000Z';
prior.visit_outcome = 'NV';
prior.checkout_timestamp = '2025-12-10T11:00:00.000Z';
prior.station_status = { checkin: true, dentist: true, cleaning: true, fluoride: true, checkout: true };

// ---- Current visit shell (today) — created at Check-In, dentist fills it ----
const today = model.newVisit(p);
today.oh1_done = true;
today.station_status.checkin = true;

p.visits = [prior, today];

// ---- Write integrity-wrapped file named by patient number (10.2/10.3) ----
const outDir = path.join(__dirname, '..', 'sample-patient-drive');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, 'patient_00147.json');
fs.writeFileSync(file, JSON.stringify(checksum.wrap(p), null, 2), 'utf8');
console.log('Wrote', file);
