'use strict';
const fs = require('fs');
const paths = require('./paths');

/*
 * Clinic settings and language configuration.
 *
 * User accounts / authentication live in users.js (username + password).
 * This file holds non-secret clinic settings only.
 */

const DEFAULT_CONFIG = {
  // Open question 11.4: start patient numbering fresh from 1 by default.
  // Set patient_number_start to continue GDR's existing sequence.
  patient_number_start: 1,
  clinic_name: 'GDR Clinic — Mexico',
  deployment_label: '',
  // Language settings:
  //  - ui_language: the application interface language ('en' | 'es').
  //  - report_language: language for GENERATED reports/exports ('es' | 'en').
  //  - consent_language: the patient consent form language (Spanish for Mexico).
  ui_language: 'en',
  report_language: 'es',
  consent_language: 'es'
};

let cache = null;

function load() {
  if (cache) return cache;
  const file = paths.configFile();
  try {
    if (fs.existsSync(file)) {
      const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
      cache = mergeDefaults(onDisk);
    } else {
      cache = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      save(cache);
    }
  } catch (e) {
    cache = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  return cache;
}

function mergeDefaults(c) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!c || typeof c !== 'object') return out;
  if (c.patient_number_start != null) out.patient_number_start = c.patient_number_start;
  if (c.clinic_name) out.clinic_name = c.clinic_name;
  if (c.deployment_label) out.deployment_label = c.deployment_label;
  if (c.ui_language) out.ui_language = c.ui_language;
  if (c.report_language) out.report_language = c.report_language;
  if (c.consent_language) out.consent_language = c.consent_language;
  return out;
}

function save(c) {
  paths.ensure(paths.base());
  fs.writeFileSync(paths.configFile(), JSON.stringify(c, null, 2), 'utf8');
  cache = c;
}

module.exports = { load, save, DEFAULT_CONFIG };
