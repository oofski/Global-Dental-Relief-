'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const codes = require('../shared/codes');
const model = require('../shared/model');

/*
 * Secure bridge between the renderer (UI) and the main process.
 * - All filesystem / DB / drive work goes through ipcRenderer.invoke.
 * - Pure charting helpers + constants are exposed directly so the tooth chart
 *   can format codes synchronously without IPC round-trips (single source of
 *   truth: src/shared/codes.js, src/shared/model.js).
 */

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

// Read config synchronously at preload time so the renderer's i18n can pick the
// UI language before any module evaluates (avoids a Spanish->English flash).
let bootConfig = { ui_language: 'en', report_language: 'es', consent_language: 'es' };
try { bootConfig = ipcRenderer.sendSync('config:get-sync') || bootConfig; } catch (_) { /* defaults */ }

contextBridge.exposeInMainWorld('api', {
  bootConfig,
  auth: {
    login: (username, password) => invoke('auth:login', { username, password }),
    logout: () => invoke('auth:logout')
  },
  users: {
    roles: () => invoke('users:roles'),
    list: () => invoke('users:list'),
    create: (payload) => invoke('users:create', payload),
    update: (id, changes) => invoke('users:update', { id, changes }),
    changePassword: (id, password) => invoke('users:changePassword', { id, password }),
    remove: (id) => invoke('users:remove', id)
  },
  config: {
    get: () => invoke('config:get'),
    save: (patch) => invoke('config:save', patch)
  },
  update: {
    available: () => invoke('update:available'),
    state: () => invoke('update:state'),
    check: () => invoke('update:check'),
    install: () => invoke('update:install'),
    onStatus: (cb) => {
      const handler = (_e, state) => cb(state);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    }
  },
  db: {
    nextNumber: () => invoke('db:nextNumber'),
    createPatient: (fields) => invoke('db:createPatient', fields),
    savePatient: (patient) => invoke('db:savePatient', patient),
    uploadPatient: (patient) => invoke('db:uploadPatient', patient),
    mergeFromDrive: (patient) => invoke('db:mergeFromDrive', patient),
    getPatient: (id) => invoke('db:getPatient', id),
    getPatientByNumber: (num) => invoke('db:getPatientByNumber', num),
    search: (q) => invoke('db:search', q),
    listNV: () => invoke('db:listNV'),
    listDrives: () => invoke('db:listDrives'),
    logDrive: (num, status, patientId) => invoke('db:logDrive', { num, status, patientId }),
    count: () => invoke('db:count'),
    clearAll: (opts) => invoke('db:clearAll', opts),
    importMaster: () => invoke('db:importMaster')
  },
  drive: {
    list: () => invoke('drive:list'),
    status: (p) => invoke('drive:status', p),
    read: (p) => invoke('drive:read', p),
    write: (drivePath, patient) => invoke('drive:write', { drivePath, patient }),
    clear: (p) => invoke('drive:clear', p),
    pickFolder: () => invoke('drive:pickFolder')
  },
  report: {
    stats: (range) => invoke('report:stats', range),
    exportSummary: (format, range) => invoke('report:exportSummary', { format, range }),
    exportMaster: (format) => invoke('report:exportMaster', { format })
  },
  shell: {
    openPath: (p) => invoke('shell:openPath', p),
    exportsDir: () => invoke('shell:exportsDir')
  },
  app: {
    info: () => invoke('app:info')
  },
  // Pure helpers + constants (no IPC)
  codes: {
    ADULT_UPPER: codes.ADULT_UPPER,
    ADULT_LOWER: codes.ADULT_LOWER,
    PRIMARY_UPPER: codes.PRIMARY_UPPER,
    PRIMARY_LOWER: codes.PRIMARY_LOWER,
    SURFACES: codes.SURFACES,
    TREATMENTS: codes.TREATMENTS,
    isPrimaryTooth: (t) => codes.isPrimaryTooth(t),
    sortSurfaces: (s) => codes.sortSurfaces(s),
    formatItem: (i) => codes.formatItem(i),
    classifyItem: (i) => codes.classifyItem(i)
  },
  model: {
    todayISO: () => model.todayISO(),
    nowISO: () => model.nowISO(),
    uuid: () => model.uuid(),
    newVisit: (patient) => model.newVisit(patient),
    newTreatmentItem: (tooth) => model.newTreatmentItem(tooth),
    newMedicalHistory: () => model.newMedicalHistory(),
    activeAlerts: (med) => model.activeAlerts(med),
    fullName: (p) => model.fullName(p),
    lastVisit: (p) => model.lastVisit(p)
  }
});
