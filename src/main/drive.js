'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const paths = require('./paths');
const checksum = require('../shared/checksum');

/*
 * Flash-drive transport (spec 2.2, 10.1, 10.3).
 *
 * Each patient's chart travels physically on a numbered USB drive. This module:
 *   - auto-detects removable drives on Windows (DriveType=2),
 *   - reads/writes a single patient file named by patient_number
 *     (patient_00147.json — NOT by name, spec 10.2),
 *   - verifies a checksum envelope on read (corruption -> safe fallback),
 *   - clears the drive after a confirmed checkout upload (spec 5.5 Screen D).
 *
 * On non-Windows / dev machines it falls back to a simulated drive folder so
 * the full flow can be exercised without hardware.
 */

const PATIENT_FILE_RE = /^patient_(\d+)\.json$/i;

function patientFileName(patientNumber) {
  const n = String(patientNumber == null ? 0 : patientNumber).padStart(5, '0');
  return `patient_${n}.json`;
}

// ---- Drive discovery ----------------------------------------------------
function listRemovableWindows() {
  return new Promise((resolve) => {
    // PowerShell: removable volumes with a drive letter.
    const ps = [
      '-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | " +
      'Select-Object DeviceID,VolumeName,FreeSpace,Size | ConvertTo-Json -Compress'
    ];
    execFile('powershell.exe', ps, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      let data;
      try { data = JSON.parse(stdout); } catch (_) { return resolve([]); }
      if (!Array.isArray(data)) data = [data];
      const drives = data.filter(Boolean).map((d) => ({
        path: d.DeviceID + '\\',
        label: d.VolumeName || 'USB',
        device: d.DeviceID,
        free: Number(d.FreeSpace) || 0,
        size: Number(d.Size) || 0,
        removable: true
      }));
      resolve(drives);
    });
  });
}

async function listDrives() {
  const result = [];
  if (process.platform === 'win32') {
    try {
      const w = await listRemovableWindows();
      result.push(...w);
    } catch (_) { /* ignore */ }
  }
  // Always offer the simulated drive (clearly labelled) as a fallback / test target.
  const sim = paths.simDrive();
  result.push({
    path: sim,
    label: 'Simulación (carpeta de prueba)',
    device: 'SIM',
    free: 0,
    size: 0,
    removable: false,
    simulated: true
  });
  return result;
}

// ---- Locate the patient file on a drive --------------------------------
function findPatientFile(drivePath) {
  try {
    const entries = fs.readdirSync(drivePath);
    const match = entries.find((f) => PATIENT_FILE_RE.test(f));
    return match ? path.join(drivePath, match) : null;
  } catch (_) {
    return null;
  }
}

function driveStatus(drivePath) {
  const file = findPatientFile(drivePath);
  return {
    path: drivePath,
    occupied: !!file,
    file: file ? path.basename(file) : null
  };
}

// ---- Read --------------------------------------------------------------
function readPatient(drivePathOrFile) {
  let file = drivePathOrFile;
  try {
    const stat = fs.statSync(drivePathOrFile);
    if (stat.isDirectory()) file = findPatientFile(drivePathOrFile);
  } catch (_) {
    return { ok: false, reason: 'not_found' };
  }
  if (!file) return { ok: false, reason: 'no_file' };
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { ok: false, reason: 'read_error', detail: String(e.message || e) }; }
  let obj;
  try { obj = JSON.parse(raw); }
  catch (e) { return { ok: false, reason: 'corrupt_json' }; }
  const res = checksum.unwrap(obj);
  if (!res.ok) return { ok: false, reason: res.reason, payload: res.payload, file };
  return { ok: true, patient: res.payload, file };
}

// ---- Write -------------------------------------------------------------
function writePatient(drivePath, patient) {
  if (!patient || patient.patient_number == null) {
    return { ok: false, reason: 'no_patient_number' };
  }
  try {
    if (!fs.existsSync(drivePath)) fs.mkdirSync(drivePath, { recursive: true });
  } catch (e) {
    return { ok: false, reason: 'drive_unavailable', detail: String(e.message || e) };
  }
  // Remove any stale patient files first (one chart per drive at a time).
  try {
    for (const f of fs.readdirSync(drivePath)) {
      if (PATIENT_FILE_RE.test(f) && f.toLowerCase() !== patientFileName(patient.patient_number).toLowerCase()) {
        fs.unlinkSync(path.join(drivePath, f));
      }
    }
  } catch (_) {}

  const target = path.join(drivePath, patientFileName(patient.patient_number));
  const envelope = checksum.wrap(patient);
  const tmp = target + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (e) {
    return { ok: false, reason: 'write_error', detail: String(e.message || e) };
  }
  // Verify the write (integrity, spec 10.3).
  const back = readPatient(target);
  if (!back.ok) return { ok: false, reason: 'verify_failed', detail: back.reason };
  return { ok: true, file: target, name: patientFileName(patient.patient_number) };
}

// ---- Clear (spec 5.5 Screen D) -----------------------------------------
function clearDrive(drivePath) {
  let removed = 0;
  try {
    for (const f of fs.readdirSync(drivePath)) {
      if (PATIENT_FILE_RE.test(f)) { fs.unlinkSync(path.join(drivePath, f)); removed++; }
    }
  } catch (e) {
    return { ok: false, reason: 'clear_error', detail: String(e.message || e) };
  }
  return { ok: true, removed };
}

module.exports = {
  listDrives,
  findPatientFile,
  driveStatus,
  readPatient,
  writePatient,
  clearDrive,
  patientFileName,
  PATIENT_FILE_RE
};
