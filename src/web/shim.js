/*
 * GDR web shim — gives the UNCHANGED desktop renderer the same `window.api` it
 * gets from src/main/preload.js under Electron, but carried over HTTP to
 * src/server/server.js instead of Electron IPC.
 *
 * Loaded as a classic script before the renderer's module scripts, so window.api
 * exists before i18n/index.js reads window.api.bootConfig at import time.
 *
 * Keep the SHAPE identical to preload.js — scripts/web-test.js fails the build if
 * the two drift apart. Browser-only behaviour is confined to:
 *   - db.importMaster: the browser's file picker reads the JSON and sends its text
 *     (Electron opens a native picker in the main process instead);
 *   - exports: the server writes the file, then the browser downloads it
 *     (on the desktop it stays in the local exports folder);
 *   - drive.pickFolder: there are no local folders — virtual drives are listed.
 */
(function () {
  'use strict';

  var shared = window.__GDR_SHARED__ || {};
  var codes = shared.codes;
  var model = shared.model;

  // Requests and replies travel in an envelope ({p} / {r}) so an absent payload
  // stays absent — exactly as ipcRenderer.invoke(channel) delivers undefined.
  function invoke(channel, payload) {
    return fetch('/api/' + encodeURIComponent(channel), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p: payload })
    }).then(function (res) {
      if (res.status === 401) {
        // The site password lapsed: reloading lets the browser ask for it again.
        location.reload();
        return new Promise(function () {});
      }
      if (!res.ok) return { ok: false, error: 'http_' + res.status };
      return res.json().then(function (body) { return body.r; });
    }, function () {
      return { ok: false, error: 'network_error' };
    });
  }

  function download(file) {
    if (!file) return;
    var name = String(file).split(/[\\/]/).pop();
    var a = document.createElement('a');
    a.href = '/web/download?f=' + encodeURIComponent(name);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function withDownload(promise) {
    return promise.then(function (res) {
      if (res && res.ok && res.data && res.data.file) download(res.data.file);
      return res;
    });
  }

  // Resolves to the chosen file's text, or null if the picker is dismissed.
  function pickTextFile() {
    return new Promise(function (resolve) {
      var settled = false;
      function finish(v) { if (settled) return; settled = true; input.remove(); resolve(v); }
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (!f) return finish(null);
        f.text().then(finish, function () { finish(null); });
      });
      input.addEventListener('cancel', function () { finish(null); });
      document.body.appendChild(input);
      input.click();
    });
  }

  // contextBridge hands the renderer copies, never the module's own arrays.
  function copy(v) { return JSON.parse(JSON.stringify(v)); }

  window.api = {
    bootConfig: window.__GDR_BOOT__ || { ui_language: 'en', report_language: 'es', consent_language: 'es' },
    auth: {
      login: function (username, password) { return invoke('auth:login', { username: username, password: password }); },
      logout: function () { return invoke('auth:logout'); }
    },
    users: {
      roles: function () { return invoke('users:roles'); },
      list: function () { return invoke('users:list'); },
      create: function (payload) { return invoke('users:create', payload); },
      update: function (id, changes) { return invoke('users:update', { id: id, changes: changes }); },
      changePassword: function (id, password) { return invoke('users:changePassword', { id: id, password: password }); },
      remove: function (id) { return invoke('users:remove', id); }
    },
    config: {
      get: function () { return invoke('config:get'); },
      save: function (patch) { return invoke('config:save', patch); }
    },
    update: {
      available: function () { return invoke('update:available'); },
      state: function () { return invoke('update:state'); },
      check: function () { return invoke('update:check'); },
      install: function () { return invoke('update:install'); },
      openReleases: function () { return invoke('update:openReleases'); },
      // The web build redeploys on push; there is no in-app updater to listen to.
      onStatus: function () { return function () {}; }
    },
    db: {
      nextNumber: function () { return invoke('db:nextNumber'); },
      createPatient: function (fields) { return invoke('db:createPatient', fields); },
      savePatient: function (patient) { return invoke('db:savePatient', patient); },
      uploadPatient: function (patient) { return invoke('db:uploadPatient', patient); },
      mergeFromDrive: function (patient) { return invoke('db:mergeFromDrive', patient); },
      getPatient: function (id) { return invoke('db:getPatient', id); },
      getPatientByNumber: function (num) { return invoke('db:getPatientByNumber', num); },
      search: function (q) { return invoke('db:search', q); },
      listNV: function () { return invoke('db:listNV'); },
      listDrives: function () { return invoke('db:listDrives'); },
      logDrive: function (num, status, patientId) { return invoke('db:logDrive', { num: num, status: status, patientId: patientId }); },
      count: function () { return invoke('db:count'); },
      clearAll: function (opts) { return invoke('db:clearAll', opts); },
      importMaster: function () {
        return pickTextFile().then(function (text) {
          if (text === null) return { ok: true, data: null }; // cancelled, as on desktop
          return invoke('db:importMaster', { text: text });
        });
      }
    },
    drive: {
      list: function () { return invoke('drive:list'); },
      status: function (p) { return invoke('drive:status', p); },
      read: function (p) { return invoke('drive:read', p); },
      write: function (drivePath, patient) { return invoke('drive:write', { drivePath: drivePath, patient: patient }); },
      clear: function (p) { return invoke('drive:clear', p); },
      pickFolder: function () { return invoke('drive:pickFolder'); }
    },
    report: {
      stats: function (range) { return invoke('report:stats', range); },
      exportSummary: function (format, range) { return withDownload(invoke('report:exportSummary', { format: format, range: range })); },
      exportMaster: function (format) { return withDownload(invoke('report:exportMaster', { format: format })); }
    },
    shell: {
      // "Open folder" on the desktop; in a browser, fetch the file again.
      openPath: function (p) { download(p); return Promise.resolve({ ok: true, data: true }); },
      exportsDir: function () { return invoke('shell:exportsDir'); }
    },
    app: {
      info: function () { return invoke('app:info'); }
    },
    // Pure helpers + constants (no network), same modules the desktop bridges.
    codes: {
      ADULT_UPPER: copy(codes.ADULT_UPPER),
      ADULT_LOWER: copy(codes.ADULT_LOWER),
      PRIMARY_UPPER: copy(codes.PRIMARY_UPPER),
      PRIMARY_LOWER: copy(codes.PRIMARY_LOWER),
      SURFACES: copy(codes.SURFACES),
      TREATMENTS: copy(codes.TREATMENTS),
      isPrimaryTooth: function (t) { return codes.isPrimaryTooth(t); },
      sortSurfaces: function (s) { return codes.sortSurfaces(s); },
      formatItem: function (i) { return codes.formatItem(i); },
      classifyItem: function (i) { return codes.classifyItem(i); },
      hasAdultExtraction: function (v) { return codes.hasAdultExtraction(v); }
    },
    model: {
      todayISO: function () { return model.todayISO(); },
      nowISO: function () { return model.nowISO(); },
      uuid: function () { return model.uuid(); },
      newVisit: function (patient) { return model.newVisit(patient); },
      newTreatmentItem: function (tooth) { return model.newTreatmentItem(tooth); },
      newMedicalHistory: function () { return model.newMedicalHistory(); },
      activeAlerts: function (med) { return model.activeAlerts(med); },
      newConsent: function () { return model.newConsent(); },
      PERMISSION_KEYS: copy(model.PERMISSION_KEYS),
      consentPermissions: function (p) { return model.consentPermissions(p); },
      fullName: function (p) { return model.fullName(p); }
      // lastVisit() deliberately absent, as in preload.js: the renderer uses its
      // own live-reference lastVisit() from util.js.
    }
  };

  // A standing reminder that this is the test copy, never the clinic system.
  function testBanner() {
    var text = window.__GDR_WEB__ && window.__GDR_WEB__.banner;
    if (!text) return;
    var bar = document.createElement('div');
    bar.id = 'gdr-test-env-banner';
    bar.setAttribute('role', 'note');
    bar.textContent = text;
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:7px 14px;'
      + 'background:#5b2a86;color:#fff;font:600 12.5px/1.3 system-ui,sans-serif;text-align:center;'
      + 'letter-spacing:.02em;box-shadow:0 -1px 6px rgba(0,0,0,.18)';
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '34px';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', testBanner);
  else testBanner();
})();
