'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

/*
 * Centralised filesystem locations.
 * - In Electron, userData is the per-user app data dir (protected, spec 10.2).
 * - The master database and config live there.
 * - A simulated flash-drive folder is provided for development on machines
 *   without a real removable drive.
 */

let app = null;
try { app = require('electron').app; } catch (_) { /* running outside electron (smoke test) */ }

function baseDir() {
  if (app) return app.getPath('userData');
  // Smoke-test / headless fallback
  const dir = path.join(os.tmpdir(), 'gdr-clinic-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const paths = {
  base: baseDir,
  master: () => path.join(baseDir(), 'master'),
  masterFile: () => path.join(baseDir(), 'master', 'master_db.json'),
  configFile: () => path.join(baseDir(), 'config.json'),
  usersFile: () => path.join(baseDir(), 'users.json'),
  driveLog: () => path.join(baseDir(), 'master', 'drive_log.json'),
  exports: () => ensure(path.join(baseDir(), 'exports')),
  simDrive: () => ensure(path.join(baseDir(), 'sim-drive')),
  ensure
};

module.exports = paths;
