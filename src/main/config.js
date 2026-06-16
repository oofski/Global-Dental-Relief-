'use strict';
const fs = require('fs');
const paths = require('./paths');

/*
 * Station role config and clinic settings (spec 3.1 / 11.4).
 *
 * Roles use simple, memorable PINs suitable for a fast-paced clinic with
 * rotating volunteers (spec 3.1 note). PINs are stored in config.json on the
 * local machine and can be changed there. Defaults below are intentionally
 * simple and documented in the README.
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
  // Spec change: UI in English, consent + reports in Spanish (configurable).
  ui_language: 'en',
  report_language: 'es',
  consent_language: 'es',
  // Default station PINs (change in config.json on each laptop).
  roles: {
    check_in: { pin: '1111', access: 'station' },
    dentist: { pin: '2222', access: 'station' },
    cleaning: { pin: '3333', access: 'station' },
    fluoride: { pin: '4444', access: 'station' },
    checkout: { pin: '0000', access: 'admin' }
  }
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
  if (c.roles && typeof c.roles === 'object') {
    for (const k of Object.keys(out.roles)) {
      if (c.roles[k] && c.roles[k].pin != null) out.roles[k].pin = String(c.roles[k].pin);
    }
  }
  return out;
}

function save(c) {
  paths.ensure(paths.base());
  fs.writeFileSync(paths.configFile(), JSON.stringify(c, null, 2), 'utf8');
  cache = c;
}

function authenticate(role, pin) {
  const c = load();
  const r = c.roles[role];
  if (!r) return { ok: false };
  if (String(pin) !== String(r.pin)) return { ok: false };
  return { ok: true, role, access: r.access };
}

module.exports = { load, save, authenticate, DEFAULT_CONFIG };
