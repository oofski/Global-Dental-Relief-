'use strict';
/*
 * The web build's half of the platform contract consumed by src/main/api.js.
 * (The desktop's half lives in src/main/main.js.)
 *
 * Differences from the desktop, and why:
 *  - Flash drives: a server has no USB ports. Instead it offers N "virtual
 *    drives" — numbered folders under the data dir — so several testers can each
 *    carry a patient from station to station at the same time, exactly like the
 *    clinic's numbered USB sticks. The browser only ever sees opaque ids
 *    ('vdrive:3'); resolveDrive maps those to folders and refuses anything else,
 *    so no client-supplied path can reach the filesystem.
 *  - No native dialogs: folder picking is unavailable (the virtual drives are
 *    listed instead), and importing a master DB sends the file's text from the
 *    browser (handled in api.js) rather than opening a picker here.
 *  - No auto-updater: a push to the deploy branch redeploys the whole service.
 */
const path = require('path');
const paths = require('../main/paths');
const drive = require('../main/drive');
const config = require('../main/config');

const PREFIX = 'vdrive:';

function createWebPlatform({ driveCount, version }) {
  const count = Math.max(1, Math.min(50, Number(driveCount) || 8));
  const root = () => paths.ensure(path.join(paths.base(), 'virtual-drives'));
  const folderFor = (n) => paths.ensure(path.join(root(), 'drive-' + n));

  function parseRef(ref) {
    if (typeof ref !== 'string' || !ref.startsWith(PREFIX)) return null;
    const tail = ref.slice(PREFIX.length);
    if (!/^\d{1,2}$/.test(tail)) return null;
    const n = Number(tail);
    return n >= 1 && n <= count ? n : null;
  }

  function label(n) {
    const es = (config.load().ui_language || 'en') === 'es';
    return (es ? 'Dispositivo virtual ' : 'Virtual drive ') + n;
  }

  return {
    resolveDrive(ref) {
      const n = parseRef(ref);
      return n ? { path: folderFor(n) } : null;
    },

    async listDrives() {
      const out = [];
      for (let n = 1; n <= count; n++) {
        const file = drive.findPatientFile(folderFor(n));
        // Show which patient is "on" the drive, so testers can find theirs.
        const m = file && path.basename(file).match(/(\d+)/);
        const who = m ? ' · #' + Number(m[1]) : '';
        out.push({
          path: PREFIX + n,
          label: label(n) + who,
          device: 'VD' + n,
          free: 0,
          size: 0,
          removable: true,
          simulated: false
        });
      }
      return out;
    },

    pickFolder: async () => null,
    // No pickImportText: api.js returns ok(null) unless the browser sends text.
    pickImportText: null,
    openPath: () => {},
    appInfo: () => ({ version, platform: 'web', dataDir: '~' }),

    updater: {
      available: () => false,
      state: () => ({ status: 'idle', version: null, percent: 0, error: null, current: version, portable: false }),
      check: () => ({ ok: false, error: 'updates_unavailable' }),
      install: () => ({ ok: false, error: 'updates_unavailable' }),
      openReleases: () => ({ ok: false, error: 'updates_unavailable' })
    },

    // For the server's own use (demo seeding, tests).
    _folderFor: folderFor,
    _count: count
  };
}

module.exports = { createWebPlatform, VDRIVE_PREFIX: PREFIX };
