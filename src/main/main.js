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
    title: 'GDR Clinic — Software Smiles',
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
            console.log('[smoke] after login role chip:', JSON.stringify(roleChip));
            console.log('[smoke] tabs:', JSON.stringify(tabs));
            if (!roleChip) hadError = true;
            // If an Accounts tab exists, open it and verify seeded accounts load.
            const hasAccounts = await mainWindow.webContents.executeJavaScript("!!Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Accounts'))");
            if (hasAccounts) {
              await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Accounts')).click()");
              await new Promise((r) => setTimeout(r, 700));
              const rows = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.accounts-table tbody tr').length");
              console.log('[smoke] account rows:', rows);
              if (rows < 6) hadError = true;
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
// Checks the public GitHub repo's releases for a newer version, downloads it in
// the background, and prompts the user to restart. Only runs in the packaged,
// installed (NSIS) app — never in dev or the portable build.
function setupAutoUpdate() {
  if (isDev || !app.isPackaged || process.env.GDR_SMOKE_LAUNCH) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { return; } // dependency missing -> silently skip
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', async (info) => {
      if (!mainWindow) return;
      const res = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: `Version ${info && info.version ? info.version : ''} has been downloaded.`,
        detail: 'Restart the application to apply the update.'
      });
      if (res.response === 0) { setImmediate(() => autoUpdater.quitAndInstall()); }
    });
    autoUpdater.on('error', (err) => { console.error('[auto-update]', err && err.message ? err.message : err); });
    autoUpdater.checkForUpdates().catch(() => {});
    // Re-check every 6 hours in case the laptop stays on between updates.
    setInterval(() => { autoUpdater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
  } catch (e) { /* never block startup on updater */ }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC contract -------------------------------------------------------
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

function requireAdmin() { return !!(session && session.manage_users); }

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
  ipcMain.handle('db:getPatient', (_e, id) => ok(db.getPatient(id)));
  ipcMain.handle('db:getPatientByNumber', (_e, num) => ok(db.getPatientByNumber(num)));
  ipcMain.handle('db:search', (_e, q) => ok(db.searchPatients(q)));
  ipcMain.handle('db:listNV', () => ok(db.listNV()));
  ipcMain.handle('db:listDrives', () => ok(db.listDrives()));
  ipcMain.handle('db:logDrive', (_e, { num, status, patientId }) => ok(db.logDrive(num, status, patientId)));
  ipcMain.handle('db:count', () => ok(db.allPatients().length));

  // --- Flash drive ---
  ipcMain.handle('drive:list', async () => ok(await drive.listDrives()));
  ipcMain.handle('drive:status', (_e, p) => ok(drive.driveStatus(p)));
  ipcMain.handle('drive:read', (_e, p) => drive.readPatient(p));
  ipcMain.handle('drive:write', (_e, { drivePath, patient }) => drive.writePatient(drivePath, patient));
  ipcMain.handle('drive:clear', (_e, p) => drive.clearDrive(p));
  ipcMain.handle('drive:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleccionar dispositivo / carpeta',
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
      title: 'Importar base de datos maestra',
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
