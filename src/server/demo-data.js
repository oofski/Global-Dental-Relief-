'use strict';
/*
 * Invented demo clinic data, shared by the product-screenshot script and the
 * web test server's first-boot seed.
 *
 * EVERY name, school and phone number here is made up. Nothing in this file is,
 * or is derived from, a real patient — this data is shown on a public test site
 * and in marketing images.
 */
const model = require('../shared/model');

const SCHOOL = 'Escuela Primaria Benito Juárez';

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * A patient mid-visit at the chair: medical alerts, a prior visit, and a charted
 * plan with work by both the dentist and the hygienist.
 *   consentDenied  the slip declines fillings + extractions, so the clinical
 *                  stations raise the red consent warning for this child.
 */
function chartPatient({ number = 147, consentDenied = false, first = 'Sofía', last = 'Hernández',
  guardian = 'María Hernández', phone = '555 128 4471', sex = 'F', age = 9, drive = 7 } = {}) {
  const patient = model.newPatient({
    patient_number: number, school_group: SCHOOL, first_name: first, last_name: last,
    age_at_first_visit: age, sex, drive_number: drive
  });

  patient.medical_history.asthma = true;
  patient.medical_history.allergies = true;
  patient.medical_history.allergies_text = 'Penicilina';
  patient.medical_history.last_updated = model.nowISO();

  patient.consent = Object.assign(model.newConsent(), {
    signed: true,
    signatory_name: guardian,
    signed_date: model.nowISO(),
    permissions: consentDenied
      ? { cleaning: true, fillings: false, extractions: false }
      : { cleaning: true, fillings: true, extractions: true },
    child_name: `${first} ${last}`,
    school: SCHOOL,
    phone
  });

  // A prior visit so the visit-history panel has content.
  const older = model.newVisit(patient);
  older.visit_date = daysAgo(372);
  older.exam_type = 'E';
  older.clinician_type = 'DDS';
  older.clinician_initials = 'RM';
  older.cleaning_type = 'P';
  older.cleaning_done = true;
  older.oh1_done = true; older.oh2_done = true;
  older.fluoride_done = true;
  older.visit_outcome = 'F';
  older.checkout_timestamp = older.visit_date + 'T15:20:00.000Z';
  older.treatment_items = [
    { id: `h${number}-1`, tooth: '30', treatment_type: 'sealant', surfaces: [], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'cleaning' }
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
    { id: `s${number}-1`, tooth: '19', treatment_type: 'restoration', surfaces: ['O', 'B'], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'dentist', performed_by: 'dentist' },
    { id: `s${number}-2`, tooth: '3', treatment_type: 'restoration', surfaces: ['O'], surgical: false, treating_today: true, complete: false, not_done: false, planned_by: 'dentist', performed_by: null },
    { id: `s${number}-3`, tooth: '30', treatment_type: 'sealant', surfaces: [], surgical: false, treating_today: true, complete: true, not_done: false, planned_by: 'cleaning', performed_by: 'cleaning' },
    { id: `s${number}-4`, tooth: 'a', treatment_type: 'sdf', surfaces: [], surgical: false, treating_today: true, complete: false, not_done: false, planned_by: 'cleaning', performed_by: null }
  ];
  visit.treatment_notes = '19-OB, 3-O, 30-seal, a-SDF';
  visit.station_status.checkin = true;
  visit.station_status.dentist = true;
  visit.last_modified = model.nowISO();
  patient.visits.push(visit);

  return patient;
}

const FIRST = ['Sofía', 'Mateo', 'Valentina', 'Diego', 'Camila', 'Santiago', 'Lucía', 'Emiliano',
  'Regina', 'Sebastián', 'Ximena', 'Andrés', 'Renata', 'Iker', 'Danna', 'Bruno',
  'Paulina', 'Leonardo', 'Fernanda', 'Maximiliano'];
const LAST = ['Hernández', 'García', 'Martínez', 'López', 'Ramírez', 'Torres', 'Flores', 'Cruz',
  'Morales', 'Reyes', 'Jiménez', 'Vargas'];
const SCHOOLS = [SCHOOL, 'Escuela Primaria Morelos', 'Escuela Primaria Emiliano Zapata'];

/**
 * A checked-out clinic week (5 days, 61 patients) so Reports, the NV board and
 * returning-patient search have realistic content. Returns { patients, counter }.
 */
function ledger({ startNumber = 147 } = {}) {
  const patients = [];
  let counter = startNumber;
  let seq = 0;
  const pick = (arr) => arr[(seq * 7 + arr.length) % arr.length];

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
          id: `p${counter}-f${f}`, tooth: String(2 + ((seq + f) % 28)), treatment_type: 'restoration',
          surfaces: f === 0 ? ['O'] : ['O', 'B'], surgical: false, treating_today: true,
          complete: true, not_done: false, planned_by: 'dentist', performed_by: 'dentist'
        });
      }
      if (seq % 4 === 0) {
        items.push({
          id: `p${counter}-x`, tooth: seq % 8 === 0 ? 'k' : String(1 + (seq % 32)), treatment_type: 'extraction',
          surfaces: [], surgical: seq % 12 === 0, treating_today: true, complete: true, not_done: false,
          planned_by: 'dentist', performed_by: 'dentist'
        });
      }
      if (seq % 2 === 0) {
        items.push({
          id: `p${counter}-s`, tooth: String(2 + (seq % 30)), treatment_type: 'sealant', surfaces: [],
          surgical: false, treating_today: true, complete: true, not_done: false,
          planned_by: 'cleaning', performed_by: 'cleaning'
        });
      }
      if (seq % 9 === 0) {
        items.push({
          id: `p${counter}-d`, tooth: String(2 + (seq % 20)), treatment_type: 'sdf', surfaces: [],
          surgical: false, treating_today: true, complete: true, not_done: false,
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
      patients.push(p);
    }
  }
  return { patients, counter };
}

module.exports = { chartPatient, ledger, SCHOOL };
