'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./db');
const drive = require('./drive');
const reports = require('./reports');
const paths = require('./paths');
const users = require('./users');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

// Simple in-process auth session so privileged IPC (user management) can be
// guarded server-side, not just hidden in the UI.
let session = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0d6e78',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    title: 'Mexico Clinic - Global Dental Relief',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Headless self-test (CI / sandbox): load the UI, capture any renderer error,
  // then exit. Enabled only via env var, never in production.
  if (process.env.GDR_SMOKE_LAUNCH) {
    let hadError = false;
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) { hadError = true; console.error('[renderer]', message); }
    });
    mainWindow.webContents.on('render-process-gone', (_e, d) => { hadError = true; console.error('[render-gone]', d.reason); });
    mainWindow.webContents.on('did-finish-load', async () => {
      // Give the renderer a beat to run boot() and render the login screen.
      setTimeout(async () => {
        try {
          const inputs = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.login-input').length");
          const btnText = await mainWindow.webContents.executeJavaScript("(document.querySelector('.login-btn')||{}).textContent||''");
          const subText = await mainWindow.webContents.executeJavaScript("(document.querySelector('.login-h2')||{}).textContent||''");
          console.log('[smoke] login inputs rendered:', inputs);
          console.log('[smoke] sign-in button:', JSON.stringify(btnText));
          console.log('[smoke] login subtitle:', JSON.stringify(subText));
          if (inputs < 2) hadError = true;

          // Optional: drive a real login (GDR_SMOKE_LOGIN="user:pass").
          if (process.env.GDR_SMOKE_LOGIN) {
            const [u, p] = process.env.GDR_SMOKE_LOGIN.split(':');
            await mainWindow.webContents.executeJavaScript(`(() => {
              const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
              set(document.querySelectorAll('.login-input')[0], ${JSON.stringify(u)});
              set(document.querySelectorAll('.login-input')[1], ${JSON.stringify(p)});
              document.querySelector('.login-btn').click();
            })()`);
            await new Promise((r) => setTimeout(r, 900));
            const roleChip = await mainWindow.webContents.executeJavaScript("(document.querySelector('.role-chip')||{}).textContent||''");
            const tabs = await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.tab')).map(t=>t.textContent)");
            const brand = await mainWindow.webContents.executeJavaScript("(document.querySelector('.brand-title')||{}).textContent||''");
            const driveLabel = await mainWindow.webContents.executeJavaScript("(document.querySelector('.drive-label')||{}).textContent||''");
            console.log('[smoke] after login role chip:', JSON.stringify(roleChip));
            console.log('[smoke] brand title:', JSON.stringify(brand));
            console.log('[smoke] drive label:', JSON.stringify(driveLabel));
            console.log('[smoke] tabs:', JSON.stringify(tabs));
            const clearBtns = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.danger-zone .btn-danger').length");
            console.log('[smoke] clear-ledger buttons visible:', clearBtns);
            if (!roleChip) hadError = true;
            // If a Settings tab exists (admin), open it -> Accounts section -> verify seeded accounts.
            const hasSettings = await mainWindow.webContents.executeJavaScript("!!Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Settings'))");
            if (hasSettings) {
              await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Settings')).click()");
              await new Promise((r) => setTimeout(r, 700));
              const subtabs = await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.subtab')).map(t=>t.textContent)");
              const rows = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.accounts-table tbody tr').length");
              console.log('[smoke] settings subtabs:', JSON.stringify(subtabs));
              console.log('[smoke] account rows:', rows);
              if (rows < 6) hadError = true;
              // Open the Clinic section.
              await mainWindow.webContents.executeJavaScript("(Array.from(document.querySelectorAll('.subtab')).find(t=>/Clinic|Cl.nica/.test(t.textContent))||{}).click&&Array.from(document.querySelectorAll('.subtab')).find(t=>/Clinic|Cl.nica/.test(t.textContent)).click()");
              await new Promise((r) => setTimeout(r, 400));
              const hasClinicForm = await mainWindow.webContents.executeJavaScript("!!document.querySelector('.settings-card')");
              console.log('[smoke] clinic settings form present:', hasClinicForm);
            }

            // Drive check-in -> medical-history screen and confirm the patient
            // sees the form in the patient (Spanish) language.
            if (process.env.GDR_SMOKE_MED) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("document.querySelector('.choice-new').click()"); await wait(350);
              await mainWindow.webContents.executeJavaScript(`(() => {
                const set=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
                const ins=document.querySelectorAll('.view-body .text-input');
                set(ins[0],'Prueba'); set(ins[2],'Escuela'); set(ins[3],'8');
                [...document.querySelectorAll('.seg-btn')].find(b=>b.textContent.trim()==='M').click();
                document.querySelector('.view-foot .btn-primary').click();
              })()`); await wait(350);
              await mainWindow.webContents.executeJavaScript(`(() => {
                const t=document.querySelector('.view-body .text-input'); if(t){t.value='Tutor';t.dispatchEvent(new Event('input',{bubbles:true}));}
                document.querySelector('.view-foot .btn-primary').click();
              })()`); await wait(350);
              const medTitle = await mainWindow.webContents.executeJavaScript("(document.querySelector('.view-head h2')||{}).textContent||''");
              const medLabels = await mainWindow.webContents.executeJavaScript("[...document.querySelectorAll('.med-row .checkbox span')].map(s=>s.textContent)");
              console.log('[smoke] medical screen title:', JSON.stringify(medTitle));
              console.log('[smoke] medical labels:', JSON.stringify(medLabels));
              if (!medLabels.length) hadError = true;
            }

            // Read station: load sim drive, confirm patient-context panels render.
            if (process.env.GDR_SMOKE_LOADSIM) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("var c=document.querySelector('.drive-chip.sim'); if(c) c.click();"); await wait(800);
              const panels = await mainWindow.webContents.executeJavaScript("[...document.querySelectorAll('.panel summary')].map(s=>s.textContent)");
              console.log('[smoke] context panels:', JSON.stringify(panels));
              if (panels.length < 2) hadError = true;
            }

            // Checkout "ending form": load sim drive, confirm the care checklist
            // is interactive (OH / cleaning / fluoride checkboxes) and toggles.
            if (process.env.GDR_SMOKE_CHECKOUT) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("var c=document.querySelector('.drive-chip.sim'); if(c) c.click();"); await wait(800);
              const boxes = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.care-checklist input[type=checkbox]').length");
              await mainWindow.webContents.executeJavaScript("var b=document.querySelector('.care-checklist input[type=checkbox]'); if(b) b.click();"); await wait(150);
              const firstChecked = await mainWindow.webContents.executeJavaScript("(document.querySelector('.care-checklist input[type=checkbox]')||{}).checked");
              console.log('[smoke] care-checklist checkboxes:', boxes);
              console.log('[smoke] first checkbox toggled to:', firstChecked);
              if (boxes < 5) hadError = true;
            }

            // Dentist chart: load sim drive, check layout dropdown + health mode.
            if (process.env.GDR_SMOKE_DENTIST) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("var c=document.querySelector('.drive-chip.sim'); if(c) c.click();"); await wait(800);
              const views = await mainWindow.webContents.executeJavaScript("[...document.querySelectorAll('.chart-view-select option')].map(o=>o.textContent)");
              const teeth = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.tooth').length");
              console.log('[smoke] chart layouts:', JSON.stringify(views));
              console.log('[smoke] teeth (hybrid):', teeth);
              await mainWindow.webContents.executeJavaScript("var s=document.querySelector('.chart-view-select'); s.value='adult'; s.dispatchEvent(new Event('change',{bubbles:true}));"); await wait(300);
              const adultTeeth = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.tooth').length");
              console.log('[smoke] teeth (adult only):', adultTeeth);
              await mainWindow.webContents.executeJavaScript("var b=[...document.querySelectorAll('.chart-toolbar .seg-btn')].find(x=>/Health|salud/i.test(x.textContent)); if(b) b.click();"); await wait(200);
              await mainWindow.webContents.executeJavaScript("var t=document.querySelector('.tooth'); if(t){t.click();t.click();}"); await wait(200);
              const tinted = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.tooth.cond-healthy,.tooth.cond-watch,.tooth.cond-urgent').length");
              console.log('[smoke] health-tinted teeth after 2 clicks:', tinted);
              if (!teeth || !views.length) hadError = true;
            }
          }
        } catch (e) { hadError = true; console.error('[smoke] eval failed', e); }
        console.log(hadError ? '[smoke] LAUNCH FAILED' : '[smoke] LAUNCH OK');
        app.exit(hadError ? 1 : 0);
      }, 1500);
    });
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---- Auto-update (electron-updater + GitHub Releases) -------------------
// Checks the public GitHub repo's releases for a newer version, downloads it,
// and (via the admin Settings page) lets the user install + restart. Status is
// forwarded to the renderer. Only active in the packaged, installed app.
let autoUpdater = null;
let updateState = { status: 'idle', version: null, percent: 0, error: null };

function updaterAvailable() {
  return !!(app.isPackaged && !isDev && !process.env.GDR_SMOKE_LAUNCH);
}

function pushUpdateStatus(patch) {
  updateState = Object.assign({}, updateState, patch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', updateState);
  }
}

function getUpdater() {
  if (autoUpdater) return autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { return null; }
  autoUpdater.autoDownload = true;            // download as soon as one is found
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => pushUpdateStatus({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => pushUpdateStatus({ status: 'available', version: info && info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => pushUpdateStatus({ status: 'up-to-date' }));
  autoUpdater.on('download-progress', (p) => pushUpdateStatus({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => pushUpdateStatus({ status: 'downloaded', version: info && info.version, percent: 100 }));
  autoUpdater.on('error', (err) => pushUpdateStatus({ status: 'error', error: String(err && err.message ? err.message : err) }));
  return autoUpdater;
}

function setupAutoUpdate() {
  if (!updaterAvailable()) return;
  const u = getUpdater();
  if (!u) return;
  try {
    u.checkForUpdates().catch(() => {});
    setInterval(() => { u.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
  } catch (e) { /* never block startup on updater */ }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC contract -------------------------------------------------------
function ok(data) { return { ok: true, data }; }
function fail(error, detail) { return { ok: false, error, detail }; }

// Localized strings for native dialogs (titles shown by the OS file picker).
function uiText(key) {
  const lang = (config.load().ui_language) || 'en';
  const M = {
    en: { pick_folder: 'Select drive / folder', import_master: 'Import master database' },
    es: { pick_folder: 'Seleccionar dispositivo / carpeta', import_master: 'Importar base de datos maestra' }
  };
  return (M[lang] || M.en)[key];
}

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

function requireAdmin() { return !!(session && session.manage_users); }
// Roles that manage the patient ledger (front desk, checkout, admin).
function requireRecordsAccess() { return !!(session && ['check_in', 'checkout', 'admin'].includes(session.role)); }

function registerIpc() {
  // --- Auth / session ---
  ipcMain.handle('auth:login', (_e, { username, password }) => {
    const res = users.authenticate(username, password);
    if (res.ok) session = res.user;
    return res;
  });
  ipcMain.handle('auth:logout', () => { session = null; return ok(true); });

  // --- User accounts (admin portal) ---
  ipcMain.handle('users:roles', () => ok(users.roles()));
  ipcMain.handle('users:list', () => (requireAdmin() ? ok(users.list()) : fail('forbidden')));
  ipcMain.handle('users:create', (_e, payload) => (requireAdmin() ? users.create(payload || {}) : fail('forbidden')));
  ipcMain.handle('users:update', (_e, { id, changes }) => (requireAdmin() ? users.update(id, changes || {}) : fail('forbidden')));
  ipcMain.handle('users:changePassword', (_e, { id, password }) => (requireAdmin() ? users.changePassword(id, password) : fail('forbidden')));
  ipcMain.handle('users:remove', (_e, id) => (requireAdmin() ? users.remove(id) : fail('forbidden')));

  // --- Config ---
  ipcMain.handle('config:get', () => publicConfig());
  // Synchronous channel: the preload reads this during page load so the renderer
  // can pick its UI language before any module evaluates (no flash, no async).
  ipcMain.on('config:get-sync', (e) => { e.returnValue = publicConfig(); });
  ipcMain.handle('config:save', (_e, patch) => {
    if (!requireAdmin()) return fail('forbidden');
    try {
      const c = config.load();
      const allowed = ['clinic_name', 'deployment_label', 'patient_number_start', 'ui_language', 'report_language', 'consent_language'];
      for (const k of allowed) { if (patch && patch[k] != null && patch[k] !== '') c[k] = patch[k]; }
      if (patch && patch.deployment_label != null) c.deployment_label = patch.deployment_label; // allow clearing
      config.save(c);
      return ok(publicConfig());
    } catch (e) { return fail('save_failed', String(e.message || e)); }
  });

  // --- Software updates (admin Settings) ---
  ipcMain.handle('update:available', () => ok(updaterAvailable()));
  ipcMain.handle('update:state', () => ok(updateState));
  ipcMain.handle('update:check', () => {
    if (!updaterAvailable()) return fail('updates_unavailable');
    const u = getUpdater();
    if (!u) return fail('updates_unavailable');
    pushUpdateStatus({ status: 'checking', error: null });
    u.checkForUpdates().catch((err) => pushUpdateStatus({ status: 'error', error: String(err && err.message || err) }));
    return ok(true);
  });
  ipcMain.handle('update:install', () => {
    if (!updaterAvailable() || !autoUpdater) return fail('updates_unavailable');
    setImmediate(() => { try { autoUpdater.quitAndInstall(); } catch (_) {} });
    return ok(true);
  });

  // --- Master DB ---
  ipcMain.handle('db:nextNumber', () => ok(db.peekNextNumber()));
  ipcMain.handle('db:createPatient', (_e, fields) => {
    try { return ok(db.createPatient(fields)); }
    catch (e) { return fail('create_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:savePatient', (_e, patient) => {
    try { return ok(db.savePatient(patient)); }
    catch (e) { return fail('save_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:uploadPatient', (_e, patient) => {
    try { return ok(db.uploadPatient(patient)); }
    catch (e) { return fail('upload_failed', String(e.message || e)); }
  });
  // Stations merge their work into the master record (no checkout stamp) so it
  // accumulates + shows in reports/checkout immediately. Any logged-in role.
  ipcMain.handle('db:mergeFromDrive', (_e, patient) => {
    if (!session) return fail('forbidden');
    try { return ok(db.mergeFromDrive(patient)); }
    catch (e) { return fail('merge_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:getPatient', (_e, id) => ok(db.getPatient(id)));
  ipcMain.handle('db:getPatientByNumber', (_e, num) => ok(db.getPatientByNumber(num)));
  ipcMain.handle('db:search', (_e, q) => ok(db.searchPatients(q)));
  ipcMain.handle('db:listNV', () => ok(db.listNV()));
  ipcMain.handle('db:listDrives', () => ok(db.listDrives()));
  ipcMain.handle('db:logDrive', (_e, { num, status, patientId }) => ok(db.logDrive(num, status, patientId)));
  ipcMain.handle('db:count', () => ok(db.allPatients().length));
  // Clear the patient ledger (front desk / checkout / admin). Auto-backs up first.
  ipcMain.handle('db:clearAll', (_e, opts) => {
    if (!requireRecordsAccess()) return fail('forbidden');
    try {
      const before = db.allPatients().length;
      let backupFile = null;
      if (before > 0) { try { backupFile = reports.exportMasterJSON(); } catch (_) { /* best-effort */ } }
      const res = db.clearAllPatients(opts || {});
      return ok({ removed: res.removed, counter: res.counter, backupFile });
    } catch (e) { return fail('clear_failed', String(e.message || e)); }
  });

  // --- Flash drive ---
  ipcMain.handle('drive:list', async () => ok(await drive.listDrives()));
  ipcMain.handle('drive:status', (_e, p) => ok(drive.driveStatus(p)));
  ipcMain.handle('drive:read', (_e, p) => drive.readPatient(p));
  ipcMain.handle('drive:write', (_e, { drivePath, patient }) => drive.writePatient(drivePath, patient));
  ipcMain.handle('drive:clear', (_e, p) => drive.clearDrive(p));
  ipcMain.handle('drive:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: uiText('pick_folder'),
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return ok(null);
    return ok(res.filePaths[0]);
  });

  // --- Reports / export ---
  ipcMain.handle('report:stats', (_e, range) => ok(reports.computeStats(range || {})));
  ipcMain.handle('report:exportSummary', async (_e, { format, range }) => {
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
  });
  ipcMain.handle('report:exportMaster', (_e, { format }) => {
    try {
      const file = format === 'csv' ? reports.exportMasterCSV() : reports.exportMasterJSON();
      return ok({ file });
    } catch (e) { return fail('export_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:importMaster', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: uiText('import_master'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths.length) return ok(null);
    try {
      const text = fs.readFileSync(res.filePaths[0], 'utf8');
      return ok(db.importMaster(text));
    } catch (e) { return fail('import_failed', String(e.message || e)); }
  });

  // --- Shell helpers ---
  ipcMain.handle('shell:openPath', (_e, p) => { shell.showItemInFolder(p); return ok(true); });
  ipcMain.handle('shell:exportsDir', () => ok(paths.exports()));
  ipcMain.handle('app:info', () => ok({ version: app.getVersion(), platform: process.platform, dataDir: paths.base() }));
}
