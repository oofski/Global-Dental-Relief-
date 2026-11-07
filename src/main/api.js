'use strict';
/*
 * Request handlers — the single source of truth for everything the UI can ask
 * the back end to do, independent of how the request arrives.
 *
 * The desktop app serves this table over Electron IPC (main.js). The web build
 * serves the SAME table over HTTP (src/server/server.js), so the permission
 * guards and business logic cannot drift between the two.
 *
 *   createHandlers(platform) -> { '<channel>': (payload, ctx) => result }
 *
 * ctx       Per-client state: { session } — null until login. The desktop app
 *           has exactly one; the web server keeps one per browser, so testers
 *           logged in as different stations don't overwrite each other.
 * platform  Host-specific capabilities: native dialogs, the auto-updater, and
 *           which drive folders a client may touch. See main.js (desktop) and
 *           src/server/platform.js (web).
 */
const config = require('./config');
const db = require('./db');
const drive = require('./drive');
const reports = require('./reports');
const paths = require('./paths');
const users = require('./users');

function ok(data) { return { ok: true, data }; }
function fail(error, detail) { return { ok: false, error, detail }; }

// Non-secret config exposed to the renderer (no PINs).
function publicConfig() {
  const c = config.load();
  return {
    clinic_name: c.clinic_name,
    deployment_label: c.deployment_label,
    patient_number_start: c.patient_number_start,
    ui_language: c.ui_language || 'en',
    report_language: c.report_language || 'es',
    consent_language: c.consent_language || 'es'
  };
}

// Who may call what. Each set is exactly the roles whose screens make that
// request (mapped from every window.api call in src/renderer), so a role can
// do over the wire only what its own station does in the UI. Before sign-in,
// only config, version info, the update banner and login itself are open.
//
// On the desktop the renderer is trusted, so these mostly harden against a
// compromised page. On the web build they are what stops someone who has only
// the site password — or is signed in as one station — from reading or
// rewriting the patient ledger directly.
const RECORDS_ROLES = ['check_in', 'checkout', 'admin'];               // the patient ledger
const CHECKOUT_ROLES = ['checkout', 'admin'];                          // upload, clear drive, NV, reports
const DRIVE_WRITE_ROLES = ['check_in', 'dentist', 'cleaning', 'fluoride']; // stations that save to a drive
const SIGNED_IN = 'signed_in';                                         // any station

function createHandlers(platform) {
  const isAdmin = (ctx) => !!(ctx.session && ctx.session.manage_users);
  const hasRecords = (ctx) => !!(ctx.session && RECORDS_ROLES.includes(ctx.session.role));
  const allowed = (ctx, roles) => !!ctx.session && (roles === SIGNED_IN || roles.includes(ctx.session.role));
  const gate = (roles, fn) => (p, ctx) => (allowed(ctx, roles) ? fn(p, ctx) : fail('forbidden'));
  // A drive reference arrives from the client. resolveDrive maps it to a real
  // folder, or returns null to refuse it. The desktop passes real USB paths
  // straight through; the web build hands out opaque ids ('vdrive:3') and maps
  // only those, so no client-supplied path ever reaches the filesystem.
  const resolveDrive = (ref) => platform.resolveDrive(ref);

  return {
    // --- Auth / session ---
    'auth:login': (p, ctx) => {
      const { username, password } = p || {};
      const res = users.authenticate(username, password);
      if (res.ok) ctx.session = res.user;
      return res;
    },
    'auth:logout': (_p, ctx) => { ctx.session = null; return ok(true); },

    // --- User accounts (admin portal) ---
    'users:roles': () => ok(users.roles()),
    'users:list': (_p, ctx) => (isAdmin(ctx) ? ok(users.list()) : fail('forbidden')),
    'users:create': (p, ctx) => (isAdmin(ctx) ? users.create(p || {}) : fail('forbidden')),
    'users:update': (p, ctx) => {
      const { id, changes } = p || {};
      return isAdmin(ctx) ? users.update(id, changes || {}) : fail('forbidden');
    },
    'users:changePassword': (p, ctx) => {
      const { id, password } = p || {};
      return isAdmin(ctx) ? users.changePassword(id, password) : fail('forbidden');
    },
    'users:remove': (id, ctx) => (isAdmin(ctx) ? users.remove(id) : fail('forbidden')),

    // --- Config ---
    'config:get': () => publicConfig(),
    'config:save': (patch, ctx) => {
      if (!isAdmin(ctx)) return fail('forbidden');
      try {
        const c = config.load();
        const allowed = ['clinic_name', 'deployment_label', 'patient_number_start', 'ui_language', 'report_language', 'consent_language'];
        for (const k of allowed) { if (patch && patch[k] != null && patch[k] !== '') c[k] = patch[k]; }
        if (patch && patch.deployment_label != null) c.deployment_label = patch.deployment_label; // allow clearing
        config.save(c);
        return ok(publicConfig());
      } catch (e) { return fail('save_failed', String(e.message || e)); }
    },

    // --- Software updates (admin Settings) ---
    'update:available': () => ok(platform.updater.available()),
    'update:state': () => ok(platform.updater.state()),
    'update:check': () => platform.updater.check(),
    'update:install': () => platform.updater.install(),
    'update:openReleases': () => platform.updater.openReleases(),

    // --- Master DB ---
    'db:nextNumber': gate(RECORDS_ROLES, () => ok(db.peekNextNumber())),
    'db:createPatient': gate(RECORDS_ROLES, (fields) => {
      try { return ok(db.createPatient(fields)); }
      catch (e) { return fail('create_failed', String(e.message || e)); }
    }),
    'db:savePatient': gate(RECORDS_ROLES, (patient) => {
      try { return ok(db.savePatient(patient)); }
      catch (e) { return fail('save_failed', String(e.message || e)); }
    }),
    'db:uploadPatient': gate(CHECKOUT_ROLES, (patient) => {
      try { return ok(db.uploadPatient(patient)); }
      catch (e) { return fail('upload_failed', String(e.message || e)); }
    }),
    // Stations merge their work into the master record (no checkout stamp) so it
    // accumulates + shows in reports/checkout immediately. Any logged-in role.
    'db:mergeFromDrive': (patient, ctx) => {
      if (!ctx.session) return fail('forbidden');
      try { return ok(db.mergeFromDrive(patient)); }
      catch (e) { return fail('merge_failed', String(e.message || e)); }
    },
    'db:getPatient': gate(RECORDS_ROLES, (id) => ok(db.getPatient(id))),
    'db:getPatientByNumber': gate(RECORDS_ROLES, (num) => ok(db.getPatientByNumber(num))),
    'db:search': gate(RECORDS_ROLES, (q) => ok(db.searchPatients(q))),
    'db:listNV': gate(CHECKOUT_ROLES, () => ok(db.listNV())),
    'db:listDrives': gate(RECORDS_ROLES, () => ok(db.listDrives())),
    'db:logDrive': gate(RECORDS_ROLES, (p) => {
      const { num, status, patientId } = p || {};
      return ok(db.logDrive(num, status, patientId));
    }),
    'db:count': gate(RECORDS_ROLES, () => ok(db.allPatients().length)),
    // Clear the patient ledger (front desk / checkout / admin). Auto-backs up first.
    'db:clearAll': (opts, ctx) => {
      if (!hasRecords(ctx)) return fail('forbidden');
      try {
        const before = db.allPatients().length;
        let backupFile = null;
        if (before > 0) { try { backupFile = reports.exportMasterJSON(); } catch (_) { /* best-effort */ } }
        const res = db.clearAllPatients(opts || {});
        return ok({ removed: res.removed, counter: res.counter, backupFile });
      } catch (e) { return fail('clear_failed', String(e.message || e)); }
    },
    // The desktop opens a native file picker (payload empty). The web build has
    // no native picker: the browser reads the chosen file and sends its text.
    'db:importMaster': async (p, ctx) => {
      if (!hasRecords(ctx)) return fail('forbidden');
      let text = p && typeof p.text === 'string' ? p.text : null;
      if (text === null) {
        if (!platform.pickImportText) return ok(null);
        try { text = await platform.pickImportText(); }
        catch (e) { return fail('import_failed', String(e.message || e)); }
        if (text === null) return ok(null); // picker cancelled
      }
      try { return ok(db.importMaster(text)); }
      catch (e) { return fail('import_failed', String(e.message || e)); }
    },

    // --- Flash drive ---
    'drive:list': gate(SIGNED_IN, async () => ok(await platform.listDrives())),
    'drive:status': gate(SIGNED_IN, (ref) => {
      const d = resolveDrive(ref);
      return d ? ok(drive.driveStatus(d.path)) : fail('forbidden');
    }),
    'drive:read': gate(SIGNED_IN, (ref) => {
      const d = resolveDrive(ref);
      return d ? drive.readPatient(d.path) : fail('forbidden');
    }),
    'drive:write': gate(DRIVE_WRITE_ROLES, (p) => {
      const { drivePath, patient } = p || {};
      const d = resolveDrive(drivePath);
      if (!d) return fail('forbidden');
      if (platform.onDriveWrite) platform.onDriveWrite(patient);
      return drive.writePatient(d.path, patient);
    }),
    'drive:clear': gate(CHECKOUT_ROLES, (ref) => {
      const d = resolveDrive(ref);
      return d ? drive.clearDrive(d.path) : fail('forbidden');
    }),
    'drive:pickFolder': gate(SIGNED_IN, async () => ok(await platform.pickFolder())),

    // --- Reports / export ---
    'report:stats': gate(CHECKOUT_ROLES, (range) => ok(reports.computeStats(range || {}))),
    'report:exportSummary': gate(CHECKOUT_ROLES, async (p) => {
      const { format, range } = p || {};
      try {
        const stats = reports.computeStats(range || {});
        let file;
        if (format === 'xlsx') {
          const r = await reports.exportSummaryXLSX(stats);
          if (r && r.error) return fail(r.error);
          file = r;
        } else {
          file = reports.exportSummaryCSV(stats);
        }
        return ok({ file, stats });
      } catch (e) { return fail('export_failed', String(e.message || e)); }
    }),
    'report:exportMaster': (p, ctx) => {
      const { format } = p || {};
      if (!hasRecords(ctx)) return fail('forbidden');
      try {
        const file = format === 'csv' ? reports.exportMasterCSV() : reports.exportMasterJSON();
        return ok({ file });
      } catch (e) { return fail('export_failed', String(e.message || e)); }
    },

    // --- Shell helpers ---
    'shell:openPath': gate(SIGNED_IN, (p) => { platform.openPath(p); return ok(true); }),
    'shell:exportsDir': gate(SIGNED_IN, () => ok(paths.exports())),
    'app:info': () => ok(platform.appInfo())
  };
}

module.exports = { createHandlers, publicConfig, ok, fail, RECORDS_ROLES, CHECKOUT_ROLES, DRIVE_WRITE_ROLES };
