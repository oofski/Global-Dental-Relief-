'use strict';
/*
 * Demo-data seed for PRODUCT SCREENSHOTS (TEST-ONLY).
 *
 * Populates the simulated flash drive + master ledger with a realistic clinic
 * day so the captured screens look like real use rather than empty templates.
 * The data itself lives in src/server/demo-data.js (shared with the web test
 * server's first-boot seed). EVERY name there is invented.
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
const demo = require('../src/server/demo-data');

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

// The chart patient shown on the station screens.
const patient = demo.chartPatient({ number: 147, consentDenied });
for (const f of fs.readdirSync(SIM_DRIVE)) {
  if (/^patient_\d+\.json$/i.test(f)) fs.unlinkSync(path.join(SIM_DRIVE, f));
}
const target = path.join(SIM_DRIVE, `patient_${String(147).padStart(5, '0')}.json`);
fs.writeFileSync(target, JSON.stringify(checksum.wrap(patient), null, 2), 'utf8');

// A populated master ledger so the Reports screen shows a real clinic week.
const { patients, counter } = demo.ledger({ startNumber: 147 });
const byId = {};
patients.forEach((p) => { byId[p.id] = p; });
fs.writeFileSync(MASTER_FILE, JSON.stringify({
  schema_version: model.SCHEMA_VERSION,
  created_at: model.nowISO(),
  last_modified: model.nowISO(),
  counter,
  patients: byId,
  drives: {}
}, null, 2), 'utf8');

console.log('[shots-seed] data dir:   ', DATA_DIR);
console.log('[shots-seed] sim drive:  ', target);
console.log('[shots-seed] consent:    ', consentDenied ? 'DENIED (fillings + extractions)' : 'fully granted');
console.log('[shots-seed] ledger:     ', patients.length, 'patients across 5 clinic days');
