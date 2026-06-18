'use strict';
/*
 * GDR data model factory functions.
 * Pure CommonJS (no fs) so it is shared between main and preload.
 *
 * Sync-readiness (spec 10.4): every patient and visit record carries a unique
 * `id`, a `last_modified` ISO timestamp, a `synced` flag and a `schema_version`
 * so the Phase 2 server can ingest these records without a data migration.
 */

const SCHEMA_VERSION = 1;

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  // local calendar date (YYYY-MM-DD)
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

// Lightweight UUID (RFC4122 v4-ish) — no external dependency.
function uuid() {
  let s = '';
  for (let i = 0; i < 32; i++) {
    if (i === 12) { s += '4'; continue; }
    if (i === 16) { s += ((Math.random() * 4) | 8).toString(16); continue; }
    s += ((Math.random() * 16) | 0).toString(16);
  }
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ---- Medical history (4.2) ---------------------------------------------
function newMedicalHistory() {
  return {
    med_date_initial: todayISO(),
    med_date_updated_1: null,
    med_date_updated_2: null,
    med_date_updated_3: null,
    asthma: false,
    medications: false,
    medications_text: '',
    recent_hospital: false,
    recent_hospital_text: '',
    allergies: false,
    allergies_text: '',
    bleeding_problems: false,
    bleeding_problems_text: '',
    infectious_disease: false,
    infectious_disease_text: '',
    epilepsy_fainting: false,
    heart_problems: false,
    diabetes: false,
    last_modified: nowISO()
  };
}

// High-priority clinical flags (4.2 / 5.2 alert banner).
function activeAlerts(med) {
  if (!med) return [];
  const flags = [];
  if (med.allergies) flags.push({ key: 'allergies', text: med.allergies_text || '' });
  if (med.bleeding_problems) flags.push({ key: 'bleeding_problems', text: med.bleeding_problems_text || '' });
  if (med.infectious_disease) flags.push({ key: 'infectious_disease', text: med.infectious_disease_text || '' });
  if (med.heart_problems) flags.push({ key: 'heart_problems', text: '' });
  if (med.diabetes) flags.push({ key: 'diabetes', text: '' });
  return flags;
}

// ---- Consent (5.1 Screen C) --------------------------------------------
function newConsent() {
  return {
    signed: false,
    signatory_name: '',
    signature_image: null, // dataURL
    signed_date: null
  };
}

// ---- Visit record (4.3) -------------------------------------------------
function newVisit(patient) {
  return {
    visit_id: uuid(),
    patient_id: patient ? patient.id : null,
    patient_number: patient ? patient.patient_number : null,
    visit_date: todayISO(),
    exam_type: null,            // 'E' | 'R'
    clinician_type: null,       // 'DDS' | 'RDH'
    clinician_initials: '',
    nt_status: false,
    treatment_items: [],        // [{ tooth, surfaces[], treatment_type, surgical, treating_today, complete }]
    tooth_conditions: {},       // { '<tooth>': 'healthy' | 'watch' | 'urgent' } quick screening
    chart_view: 'hybrid',       // 'hybrid' | 'adult' | 'primary'
    treatment_notes: '',
    cleaning_type: 'None',      // 'P' | 'D' | 'None'  (clinician recommendation)
    fluoride_recommended: true, // standard of care unless a heavy extraction
    cleaning_done: false,
    cleaning_done_at: null,
    oh1_done: false,
    oh2_done: false,
    oh3_done: false,
    fluoride_done: false,
    fluoride_done_at: null,
    visit_outcome: null,        // 'F' | 'NV'
    checkout_timestamp: null,
    // station completion tracking (5.5 Screen A completeness indicator)
    station_status: {
      checkin: false,
      dentist: false,
      cleaning: false,
      fluoride: false,
      checkout: false
    },
    last_modified: nowISO(),
    synced: false,
    schema_version: SCHEMA_VERSION
  };
}

function newTreatmentItem(tooth) {
  return {
    id: uuid(),
    tooth: tooth || '',
    surfaces: [],
    treatment_type: 'restoration',
    surgical: false,
    treating_today: true,
    complete: false
  };
}

// ---- Patient identity (4.1) --------------------------------------------
function newPatient(fields) {
  const f = fields || {};
  const p = {
    id: uuid(),
    patient_number: f.patient_number || null, // assigned by db (sequential)
    school_group: f.school_group || '',
    first_name: f.first_name || '',
    last_name: f.last_name || '',
    age_at_first_visit: f.age_at_first_visit != null ? Number(f.age_at_first_visit) : null, // STATIC
    sex: f.sex || '',           // 'M' | 'F'
    created_date: todayISO(),
    drive_number: f.drive_number != null ? f.drive_number : null, // session
    prior_paper_history: f.prior_paper_history || '', // 7.2 free-text archive
    medical_history: newMedicalHistory(),
    consent: newConsent(),
    visits: [],
    last_modified: nowISO(),
    synced: false,
    schema_version: SCHEMA_VERSION
  };
  return p;
}

function touch(record) {
  if (record) record.last_modified = nowISO();
  return record;
}

function fullName(p) {
  if (!p) return '';
  return [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
}

function lastVisit(p) {
  if (!p || !p.visits || !p.visits.length) return null;
  return p.visits[p.visits.length - 1];
}

module.exports = {
  SCHEMA_VERSION,
  nowISO,
  todayISO,
  uuid,
  newMedicalHistory,
  activeAlerts,
  newConsent,
  newVisit,
  newTreatmentItem,
  newPatient,
  touch,
  fullName,
  lastVisit
};
