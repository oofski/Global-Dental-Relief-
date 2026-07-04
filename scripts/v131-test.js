'use strict';
/*
 * GDR v1.3.1 DATA-LAYER PROOF HARNESS (TEST-ONLY)
 * ===========================================================================
 * Proves the v1.3.1 changes at the data layer, driving the REAL modules
 * (no mocks):
 *   - src/main/reports.js  (computeStats + clinic_summary grid + exports)
 *   - src/main/db.js       (master DB, mergeFromDrive union-by-id)
 *   - src/main/drive.js    (flash-drive transport — raw ISO on disk)
 *   - src/main/i18n.js     (report-language grid labels + months)
 *   - src/shared/model.js  (record factories)
 *   - src/shared/codes.js  (formatItem / sortSurfaces)
 *
 * Covers:
 *   A. Clinic summary grid (item 9): every sheet row across 2 clinic days,
 *      per-day counts, Total = sum of days, parent = sum of children,
 *      performed-only (complete && !not_done), distinct-patient dedup,
 *      surface dedup/clamp/fold rules, surgical-exclusive extractions.
 *   B. Item 7: no double-counting across visits (3 fillings day A + 2 day B
 *      = 5 total; day columns 3 and 2) in BOTH the flat summary and the grid.
 *   C. Item 1 dates: generated report exports (CSV + XLSX) spell out the
 *      month; raw data files (master JSON export, master CSV visit rows,
 *      drive patient file) keep ISO YYYY-MM-DD.
 *   D. Items 4/5/6 (data layer): hygienist-added sealant/SDF items persist
 *      via drive.write + mergeFromDrive (union by id) WITHOUT losing the
 *      doctor's items; APPENDED treatment_notes survive the merge.
 *   E. Items 2/3: today_rule + fluoride_adult_ext_hint removed from renderer
 *      views AND both staff i18n dictionaries (parity preserved); FLU-7
 *      hard-block strings kept.
 *   F. Item 8: the returning suite (export/import DB) still passes.
 *
 * Self-checking: prints PASS/FAIL lines and exits non-zero if ANY assertion
 * fails. Does NOT modify any app source.
 *
 * Run:  node scripts/v131-test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const db = require('../src/main/db');
const drive = require('../src/main/drive');
const reports = require('../src/main/reports');
const model = require('../src/shared/model');
const codes = require('../src/shared/codes');
const { reportStrings } = require('../src/main/i18n');

// ---------------------------------------------------------------------------
// Tiny test runner (mirrors flow-test.js / feature-test.js / returning-test.js)
// ---------------------------------------------------------------------------
let passCount = 0;
let failCount = 0;
const failures = [];

function stringify(v) {
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
  return String(v);
}
function pass(msg) { passCount++; console.log('  PASS  ' + msg); }
function fail(msg, expected, actual) {
  failCount++;
  const detail = (expected !== undefined || actual !== undefined)
    ? ` | expected: ${stringify(expected)} | actual: ${stringify(actual)}`
    : '';
  console.log('  FAIL  ' + msg + detail);
  failures.push(msg + detail);
}
function eq(actual, expected, msg) {
  const a = typeof actual === 'object' ? JSON.stringify(actual) : actual;
  const e = typeof expected === 'object' ? JSON.stringify(expected) : expected;
  if (a === e) pass(msg); else fail(msg, expected, actual);
}
function truthy(actual, msg) { if (actual) pass(msg); else fail(msg, 'truthy', actual); }
function falsy(actual, msg) { if (!actual) pass(msg); else fail(msg, 'falsy', actual); }
function section(title) { console.log('\n=== ' + title + ' ==='); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY_A = '2026-06-01';
const DAY_B = '2026-06-05';
const FROM = '2026-06-01';
const TO = '2026-06-30';

let lmSeq = 0;
function nextLM() {
  // strictly increasing last_modified so merge scalar-winner rules are stable
  return new Date(Date.now() + (++lmSeq) * 1000).toISOString();
}

function item(tooth, treatment_type, opts) {
  const o = opts || {};
  const t = model.newTreatmentItem(tooth);
  t.treatment_type = treatment_type;
  t.surfaces = o.surfaces || [];
  t.surgical = !!o.surgical;
  t.complete = o.complete !== false;      // default: completed/performed
  t.not_done = !!o.not_done;
  return t;
}

function visitOn(patient, date, mut) {
  const v = model.newVisit(patient);
  v.visit_date = date;
  if (mut) mut(v);
  v.last_modified = nextLM();
  return v;
}

function gridRow(grid, key) {
  return grid.rows.find((r) => r.key === key);
}
function perDay(grid, key) { const r = gridRow(grid, key); return r ? r.perDay : null; }
function total(grid, key) { const r = gridRow(grid, key); return r ? r.total : NaN; }

// ===========================================================================
async function main() {
  console.log('GDR v1.3.1 DATA-LAYER PROOF');
  console.log('===========================');

  // =========================================================================
  section('A. Clinic summary grid — seed 2 clinic days covering EVERY row');
  // =========================================================================
  db._reset();

  // P1 — Male, age 8 (18/under). Day A: exam E, NT, prophy done, fluoride,
  // OH1+OH2, sealant, 1s + 2s fillings, primary extraction, SDF.
  // Also carries the performed-only guards: an INCOMPLETE restoration and a
  // sealant marked complete-but-not_done — NEITHER may count anywhere.
  const p1 = db.createPatient({ first_name: 'Niño', last_name: 'Uno', sex: 'M', age_at_first_visit: 8, school_group: 'A' });
  const p1a = visitOn(p1, DAY_A, (v) => {
    v.exam_type = 'E';
    v.nt_status = true;
    v.cleaning_type = 'P';
    v.cleaning_done = true;
    v.fluoride_done = true;
    v.oh1_done = true;
    v.oh2_done = true;
    v.treatment_items = [
      item('a', 'sealant'),
      item('19', 'restoration', { surfaces: ['O'] }),
      item('30', 'restoration', { surfaces: ['O', 'B'] }),
      item('b', 'extraction'),
      item('t', 'sdf'),
      item('20', 'restoration', { surfaces: ['O'], complete: false }),        // planned, NOT performed
      item('c', 'sealant', { complete: true, not_done: true })                // explicitly not done
    ];
  });
  // P1 RETURNS on Day B (distinct-patient rows must count him once per day):
  // exam R + one completed 1-surface filling.
  const p1b = visitOn(p1, DAY_B, (v) => {
    v.exam_type = 'R';
    v.treatment_items = [item('18', 'restoration', { surfaces: ['M'] })];
  });
  p1.visits = [p1a, p1b];
  db.savePatient(p1);

  // P2 — Female, age 25 (19/older). Day A: exam R, debridement done, OH3,
  // 3s + 4s + 5s(clamps to 4) fillings, 1s + 2s composites, adult extraction,
  // surgical extraction (EXCLUSIVE of adult).
  const p2 = db.createPatient({ first_name: 'Adulta', last_name: 'Dos', sex: 'F', age_at_first_visit: 25, school_group: 'A' });
  const p2a = visitOn(p2, DAY_A, (v) => {
    v.exam_type = 'R';
    v.cleaning_type = 'D';
    v.cleaning_done = true;
    v.oh3_done = true;
    v.treatment_items = [
      item('3', 'restoration', { surfaces: ['M', 'O', 'D'] }),
      item('14', 'restoration', { surfaces: ['M', 'O', 'D', 'B'] }),
      item('15', 'restoration', { surfaces: ['M', 'O', 'D', 'B', 'L'] }),     // 5 surfaces -> clamps into 4-surface row
      item('8', 'composite', { surfaces: ['F'] }),
      item('9', 'composite', { surfaces: ['M', 'F'] }),
      item('1', 'extraction'),
      item('16', 'extraction', { surgical: true })
    ];
  });
  p2.visits = [p2a];
  db.savePatient(p2);

  // P3 — sex '' and age null (counts in Patients, NEITHER sex NOR age bucket).
  // TWO visits on the SAME Day A (distinct-patient dedup: Patients counts P3
  // once; per-visit/per-item rows still count both visits).
  // v1: prophy RECOMMENDED but NOT done (must NOT count), 0-surface filling
  // (folds into 1s), duplicated-surface filling O,O,B (dedups to 2s), 3s + 4s
  // (clamps to 3) composites, 0-surface composite (folds to 1s), and a
  // SURGICAL PRIMARY extraction (surgical-exclusive: counts ONLY in Surgical).
  const p3 = db.createPatient({ first_name: 'Sin', last_name: 'Datos', school_group: 'B' });
  const p3a1 = visitOn(p3, DAY_A, (v) => {
    v.cleaning_type = 'P';
    v.cleaning_done = false;                                                  // recommendation only
    v.treatment_items = [
      item('2', 'restoration', { surfaces: [] }),                            // 0-surface -> 1-surface row
      item('4', 'restoration', { surfaces: ['O', 'O', 'B'] }),               // dedup -> 2-surface row
      item('12', 'composite', { surfaces: ['M', 'O', 'D'] }),
      item('13', 'composite', { surfaces: ['M', 'O', 'D', 'B'] }),           // 4 surfaces -> clamps into 3-surface row
      item('5', 'composite', { surfaces: [] }),                              // 0-surface -> 1-surface row
      item('d', 'extraction', { surgical: true })                            // surgical PRIMARY -> Surgical ONLY
    ];
  });
  const p3a2 = visitOn(p3, DAY_A, (v) => {
    v.exam_type = 'E';
    v.treatment_items = [item('s', 'sdf')];
  });
  p3.visits = [p3a1, p3a2];
  db.savePatient(p3);

  // P4 — Female, age 19 EXACTLY (boundary: 19/older). Day B only.
  const p4 = db.createPatient({ first_name: 'Joven', last_name: 'Cuatro', sex: 'F', age_at_first_visit: 19, school_group: 'B' });
  const p4b = visitOn(p4, DAY_B, (v) => {
    v.exam_type = 'E';
    v.fluoride_done = true;
    v.oh1_done = true;
    v.treatment_items = [item('30', 'sealant')];
  });
  p4.visits = [p4b];
  db.savePatient(p4);

  // P5 — Male, age 18 EXACTLY (boundary: 18/under). Day B, NT, no exam.
  const p5 = db.createPatient({ first_name: 'Límite', last_name: 'Cinco', sex: 'M', age_at_first_visit: 18, school_group: 'B' });
  const p5b = visitOn(p5, DAY_B, (v) => {
    v.nt_status = true;
    v.treatment_items = [item('6', 'restoration', { surfaces: ['O'], complete: true, not_done: true })]; // must NOT count
  });
  p5.visits = [p5b];
  db.savePatient(p5);

  // A patient fully OUTSIDE the range must not appear anywhere.
  const p6 = db.createPatient({ first_name: 'Fuera', last_name: 'Rango', sex: 'M', age_at_first_visit: 30 });
  const p6v = visitOn(p6, '2026-05-20', (v) => {
    v.exam_type = 'E';
    v.treatment_items = [item('19', 'restoration', { surfaces: ['O'] })];
  });
  p6.visits = [p6v];
  db.savePatient(p6);

  const stats = reports.computeStats({ from: FROM, to: TO });
  const grid = stats.clinic_summary;

  truthy(grid && Array.isArray(grid.rows) && Array.isArray(grid.day_dates),
    'stats.clinic_summary rides the existing computeStats payload ({day_dates, rows})');
  eq(grid.day_dates, [DAY_A, DAY_B], 'day columns = distinct visit dates in range, ASC (out-of-range 2026-05-20 excluded)');

  // Row contract: exact order, keys, indent flags, per-day widths, labels.
  const EXPECTED_ROWS = [
    ['patients_total', false], ['patients_male', true], ['patients_female', true],
    ['patients_age_18_under', true], ['patients_age_19_older', true],
    ['exams', false], ['cleaning_prophy', false], ['cleaning_debridement', false],
    ['fluoride', false], ['sealants', false],
    ['fillings_total', false], ['fillings_1_surface', true], ['fillings_2_surface', true],
    ['fillings_3_surface', true], ['fillings_4_surface', true],
    ['composites_total', false], ['composites_1_surface', true], ['composites_2_surface', true],
    ['composites_3_surface', true],
    ['extractions_total', false], ['extractions_primary', true], ['extractions_adult', true],
    ['extractions_surgical', true],
    ['sdf_apply', false], ['nt', false], ['oh_lessons', false]
  ];
  eq(grid.rows.map((r) => r.key), EXPECTED_ROWS.map((r) => r[0]), 'grid rows in EXACT sheet order (26 keys)');
  eq(grid.rows.map((r) => !!r.indent), EXPECTED_ROWS.map((r) => r[1]), 'indent flags match the sheet (children indented)');
  truthy(grid.rows.every((r) => r.perDay.length === grid.day_dates.length), 'every row has perDay.length === day_dates.length');

  const S = reportStrings(stats.report_language);
  truthy(grid.rows.every((r) => r.label === S.grid.rows[r.key]),
    `row labels come from the report-language (${stats.report_language}) grid dictionary`);

  // ---- Day A expectations --------------------------------------------------
  section('A1. Day 1 (' + DAY_A + ') per-row counts');
  const expectA = {
    patients_total: 3, patients_male: 1, patients_female: 1,
    patients_age_18_under: 1, patients_age_19_older: 1,
    exams: 3,                       // P1 E + P2 R + P3(second visit) E
    cleaning_prophy: 1,             // P1 done. P3 prophy recommended-not-done does NOT count
    cleaning_debridement: 1,        // P2
    fluoride: 1,                    // P1
    sealants: 1,                    // P1 'a' (the not_done sealant excluded)
    fillings_total: 7,
    fillings_1_surface: 2,          // P1 19-O + P3 0-surface fold
    fillings_2_surface: 2,          // P1 30-OB + P3 O,O,B dedup
    fillings_3_surface: 1,          // P2 3-MOD
    fillings_4_surface: 2,          // P2 14 (4s) + P2 15 (5s clamps)
    composites_total: 5,
    composites_1_surface: 2,        // P2 8-F + P3 0-surface fold
    composites_2_surface: 1,        // P2 9-MF
    composites_3_surface: 2,        // P3 12 (3s) + P3 13 (4s clamps — no 4-row)
    extractions_total: 4,
    extractions_primary: 1,         // P1 'b' (non-surgical primary)
    extractions_adult: 1,           // P2 '1' (non-surgical permanent)
    extractions_surgical: 2,        // P2 16 + P3 'd' (surgical primary counts ONLY here)
    sdf_apply: 2,                   // P1 't' + P3 second visit 's'
    nt: 1,                          // P1
    oh_lessons: 3                   // P1 (oh1+oh2) + P2 (oh3)
  };
  for (const [k, v] of Object.entries(expectA)) {
    eq(perDay(grid, k)[0], v, `Day1 ${k} = ${v}`);
  }

  // ---- Day B expectations --------------------------------------------------
  section('A2. Day 2 (' + DAY_B + ') per-row counts');
  const expectB = {
    patients_total: 3, patients_male: 2, patients_female: 1,
    patients_age_18_under: 2,       // P1 (8) + P5 (exactly 18 -> under bucket)
    patients_age_19_older: 1,       // P4 (exactly 19 -> older bucket)
    exams: 2,                       // P1 R + P4 E
    cleaning_prophy: 0, cleaning_debridement: 0,
    fluoride: 1,                    // P4
    sealants: 1,                    // P4
    fillings_total: 1, fillings_1_surface: 1, fillings_2_surface: 0,
    fillings_3_surface: 0, fillings_4_surface: 0,                         // P5's not_done filling excluded
    composites_total: 0, composites_1_surface: 0, composites_2_surface: 0, composites_3_surface: 0,
    extractions_total: 0, extractions_primary: 0, extractions_adult: 0, extractions_surgical: 0,
    sdf_apply: 0,
    nt: 1,                          // P5
    oh_lessons: 1                   // P4
  };
  for (const [k, v] of Object.entries(expectB)) {
    eq(perDay(grid, k)[1], v, `Day2 ${k} = ${v}`);
  }

  // ---- Invariants ------------------------------------------------------------
  section('A3. Grid invariants');
  truthy(grid.rows.every((r) => r.total === r.perDay.reduce((a, b) => a + b, 0)),
    'Total column = arithmetic sum of the day columns for EVERY row');
  eq(total(grid, 'patients_total'), 6,
    'returning patient counts once per day => Patients Total 6 (per-day attendance sum, not unique patients)');
  eq(total(grid, 'fillings_total'),
    total(grid, 'fillings_1_surface') + total(grid, 'fillings_2_surface') + total(grid, 'fillings_3_surface') + total(grid, 'fillings_4_surface'),
    'Fillings parent = sum of its 4 surface children');
  eq(total(grid, 'composites_total'),
    total(grid, 'composites_1_surface') + total(grid, 'composites_2_surface') + total(grid, 'composites_3_surface'),
    'Composites parent = sum of its 3 surface children');
  eq(total(grid, 'extractions_total'),
    total(grid, 'extractions_primary') + total(grid, 'extractions_adult') + total(grid, 'extractions_surgical'),
    'Extractions parent = Primary + Adult + Surgical (surgical exclusive)');
  truthy(perDay(grid, 'patients_male')[0] + perDay(grid, 'patients_female')[0] < perDay(grid, 'patients_total')[0],
    'unknown sex counts in Patients but neither Male nor Female (Male+Female < Patients on Day1)');
  truthy(perDay(grid, 'patients_age_18_under')[0] + perDay(grid, 'patients_age_19_older')[0] < perDay(grid, 'patients_total')[0],
    'null age counts in Patients but neither age bucket (age rows sum < Patients on Day1)');

  // Daily report (from === to) => exactly one day column.
  const daily = reports.computeStats({ from: DAY_A, to: DAY_A }).clinic_summary;
  eq(daily.day_dates, [DAY_A], 'from === to yields exactly 1 day column');
  eq(gridRow(daily, 'fillings_total').perDay, [7], 'daily grid counts only that day\'s visits');
  eq(gridRow(daily, 'fillings_total').total, 7, 'daily Total equals the single day column');

  // =========================================================================
  section('B. Item 7 — performed-only + NO double-count across visits');
  // =========================================================================
  db._reset();
  const pb = db.createPatient({ first_name: 'Lunes', last_name: 'Viernes', sex: 'M', age_at_first_visit: 10 });
  const vMon = visitOn(pb, DAY_A, (v) => {
    v.exam_type = 'E';
    v.treatment_items = [
      item('19', 'restoration', { surfaces: ['O'] }),
      item('20', 'restoration', { surfaces: ['M'] }),
      item('21', 'restoration', { surfaces: ['D'] })
    ];
  });
  const vFri = visitOn(pb, DAY_B, (v) => {
    v.exam_type = 'R';
    v.treatment_items = [
      item('28', 'restoration', { surfaces: ['O'] }),
      item('29', 'restoration', { surfaces: ['B'] })
    ];
  });
  pb.visits = [vMon, vFri];
  db.savePatient(pb);

  const st7 = reports.computeStats({ from: FROM, to: TO });
  const fillRow = st7.rows.find((r) => r.key === 'fill_single');
  eq(fillRow.count, 5, 'flat summary: 3 fillings Monday + 2 Friday = 5 (never 3, never 10)');
  const g7 = st7.clinic_summary;
  eq(gridRow(g7, 'fillings_total').perDay, [3, 2], 'grid day columns = [3, 2]');
  eq(gridRow(g7, 'fillings_total').total, 5, 'grid Fillings Total = 5 (no double-count across visits)');
  eq(gridRow(g7, 'patients_total').perDay, [1, 1], 'same patient, two days: 1 per day column');

  // Performed-only in the FLAT summary too: flip Monday's items to planned/not_done.
  vMon.treatment_items[0].complete = false;                                  // planned only
  vMon.treatment_items[1].not_done = true;                                   // complete but explicitly not done
  db.savePatient(pb);
  const st7b = reports.computeStats({ from: FROM, to: TO });
  eq(st7b.rows.find((r) => r.key === 'fill_single').count, 3,
    'flat summary drops non-performed items (5 -> 3 after un-completing 2)');
  eq(gridRow(st7b.clinic_summary, 'fillings_total').perDay, [1, 2],
    'grid drops non-performed items per day ([3,2] -> [1,2])');

  // =========================================================================
  section('C. Item 1 — spelled-out months in exports; raw files stay ISO');
  // =========================================================================
  // Re-seed scenario A so the exports have grid content on June dates.
  db._reset();
  const pc = db.createPatient({ first_name: 'Fecha', last_name: 'Prueba', sex: 'F', age_at_first_visit: 12 });
  const vc = visitOn(pc, DAY_A, (v) => {
    v.exam_type = 'E';
    v.treatment_items = [item('19', 'restoration', { surfaces: ['O', 'B'] })];
  });
  pc.visits = [vc];
  db.savePatient(pc);

  const stC = reports.computeStats({ from: FROM, to: TO });
  const lang = stC.report_language;
  const SC = reportStrings(lang);
  const june = SC.months[5];
  const genMonth = SC.months[new Date(stC.generated_at).getMonth()];

  // machine-readable stats fields stay raw ISO
  eq(stC.from, FROM, 'stats.from stays raw ISO');
  eq(stC.clinic_summary.day_dates[0], DAY_A, 'stats.clinic_summary.day_dates stay raw ISO (renderer spells them out)');
  truthy(/^\d{4}-\d{2}-\d{2}T/.test(stC.generated_at), 'stats.generated_at stays a raw ISO timestamp');

  // CSV summary export: spelled-out month, NO numeric ISO dates anywhere.
  const csvFile = reports.exportSummaryCSV(stC);
  const csv = fs.readFileSync(csvFile, 'utf8');
  truthy(csv.includes(june), `summary CSV spells out the range month ("${june}")`);
  truthy(genMonth && csv.includes(genMonth), `summary CSV spells out the generated-at month ("${genMonth}")`);
  falsy(/\d{4}-\d{2}-\d{2}/.test(csv), 'summary CSV contains NO numeric ISO date');
  truthy(csv.includes(SC.grid.title), 'summary CSV contains the clinic-summary grid block (item 9)');
  truthy(csv.includes(SC.grid.col_total), 'summary CSV grid header has the Total column');
  truthy(csv.includes(SC.grid.rows.fillings_total), 'summary CSV grid block lists the Fillings row');

  // XLSX summary export: read it back and find the grid + spelled-out day header.
  const xlsxFile = await reports.exportSummaryXLSX(stC);
  truthy(typeof xlsxFile === 'string' && fs.existsSync(xlsxFile), 'summary XLSX written');
  {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(xlsxFile);
    const ws = wb.worksheets[0];
    const cells = [];
    ws.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value == null ? '' : cell.value))));
    truthy(cells.some((c) => c === SC.grid.title), 'XLSX contains the clinic-summary grid title');
    truthy(cells.some((c) => c.includes(june)), `XLSX day-column header spells out the month ("${june}")`);
    falsy(cells.some((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)), 'XLSX contains no raw ISO date cell');
    truthy(cells.some((c) => c === SC.grid.rows.patients_total), 'XLSX grid block lists the Patients row');
  }

  // Master JSON export: raw ISO preserved (machine-readable, item 1 guard).
  const jsonFile = reports.exportMasterJSON();
  const master = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  const mv = master.patients[0].visits[0];
  eq(mv.visit_date, DAY_A, 'master JSON export keeps visit_date raw ISO YYYY-MM-DD');
  truthy(/^\d{4}-\d{2}-\d{2}T/.test(master.exported_at), 'master JSON exported_at stays raw ISO');

  // Master CSV export: visit rows keep the raw ISO date (Salesforce-readable).
  const mcsvFile = reports.exportMasterCSV();
  const mcsv = fs.readFileSync(mcsvFile, 'utf8');
  truthy(mcsv.includes(DAY_A), 'master CSV keeps raw ISO visit_date');
  falsy(mcsv.includes(june), 'master CSV does NOT spell out months (machine-readable)');

  // Drive patient file: raw ISO on disk.
  const driveDir = path.join(os.tmpdir(), 'gdr-v131-drive-' + Date.now());
  fs.mkdirSync(driveDir, { recursive: true });
  const w = drive.writePatient(driveDir, db.getPatient(pc.id));
  truthy(w.ok, 'drive.writePatient ok');
  const driveRaw = fs.readFileSync(w.file || path.join(driveDir, fs.readdirSync(driveDir)[0]), 'utf8');
  truthy(driveRaw.includes('"' + DAY_A + '"'), 'drive patient file keeps visit_date raw ISO');
  falsy(driveRaw.includes(june), 'drive patient file contains no spelled-out month');

  // =========================================================================
  section('D. Items 4/5/6 — hygienist sealant/SDF + appended notes persist');
  // =========================================================================
  db._reset();
  const pd = db.createPatient({ first_name: 'Silla', last_name: 'Higiene', sex: 'M', age_at_first_visit: 9, drive_number: 3 });
  const vd = visitOn(pd, DAY_A, (v) => {
    v.exam_type = 'E';
    v.station_status.dentist = true;
    v.treatment_items = [
      item('19', 'restoration', { surfaces: ['O', 'B'] }),
      item('3', 'extraction')
    ];
    v.treatment_notes = '19-OB, 3-ext';                                      // doctor's notes
  });
  pd.visits = [vd];
  db.savePatient(pd);

  // DOCTOR saves to the drive.
  const dir2 = path.join(os.tmpdir(), 'gdr-v131-hyg-' + Date.now());
  fs.mkdirSync(dir2, { recursive: true });
  truthy(drive.writePatient(dir2, db.getPatient(pd.id)).ok, 'doctor writes patient to drive');

  // HYGIENIST loads from the drive, charts a sealant + an SDF (exactly what the
  // restricted chart produces: model.newTreatmentItem id + type + complete),
  // APPENDS the codes to treatment_notes (cleaning.js appendChartNotes), then
  // saves via the existing path: drive.write + db.mergeFromDrive.
  const hp = drive.readPatient(dir2).patient;
  const hv = model.lastVisit(hp);
  const seal = item('a', 'sealant');
  const sdf = item('30', 'sdf');
  hv.treatment_items.push(seal, sdf);
  const appendCodes = [codes.formatItem(seal), codes.formatItem(sdf)];
  hv.treatment_notes = hv.treatment_notes.trim().replace(/,+$/, '') + ', ' + appendCodes.join(', ');
  hv.station_status.cleaning = true;
  hv.last_modified = nextLM();
  truthy(drive.writePatient(dir2, hp).ok, 'hygienist writes patient back to drive');
  db.mergeFromDrive(hp);

  const merged = model.lastVisit(db.getPatient(pd.id));
  eq(merged.treatment_items.length, 4, 'master has the union: 2 doctor items + sealant + SDF (union by id)');
  truthy(merged.treatment_items.some((t) => t.id === seal.id && t.treatment_type === 'sealant'),
    'hygienist sealant persisted with its own id');
  truthy(merged.treatment_items.some((t) => t.id === sdf.id && t.treatment_type === 'sdf'),
    'hygienist SDF persisted with its own id');
  truthy(merged.treatment_items.some((t) => t.treatment_type === 'restoration' && codes.sortSurfaces(t.surfaces).join('') === 'OB'),
    "doctor's restoration untouched by the hygienist save");
  eq(merged.treatment_notes, '19-OB, 3-ext, a-seal, 30-SDF',
    "APPENDED notes survive the merge (doctor's free text preserved, codes appended)");

  // And they count in the grid (sealants + sdf_apply rows).
  const gD = reports.computeStats({ from: FROM, to: TO }).clinic_summary;
  eq(gridRow(gD, 'sealants').total, 1, 'hygienist-charted sealant reaches the clinic summary grid');
  eq(gridRow(gD, 'sdf_apply').total, 1, 'hygienist-charted SDF reaches the clinic summary grid');

  // =========================================================================
  section('E. Items 2/3 — removed strings gone; FLU-7 kept; i18n parity');
  // =========================================================================
  const RENDERER = path.join(ROOT, 'src', 'renderer');
  const offenders = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
      const txt = fs.readFileSync(fp, 'utf8');
      if (/today_rule|fluoride_adult_ext_hint/.test(txt)) offenders.push(path.relative(ROOT, fp));
    }
  })(RENDERER);
  eq(offenders, [], 'no renderer file references today_rule or fluoride_adult_ext_hint');

  const dentistSrc = fs.readFileSync(path.join(RENDERER, 'views', 'dentist.js'), 'utf8');
  falsy(/today_rule/.test(dentistSrc), 'dentist view: GDR quadrant-rule line removed (item 2)');
  const fluorideSrc = fs.readFileSync(path.join(RENDERER, 'views', 'fluoride.js'), 'utf8');
  truthy(/fluoride_blocked_title/.test(fluorideSrc) && /fluoride_recommended === false/.test(fluorideSrc),
    'FLU-7 hard-block screen KEPT (explicit doctor "no" still blocks)');
  const cleaningSrc = fs.readFileSync(path.join(RENDERER, 'views', 'cleaning.js'), 'utf8');
  truthy(/allowedTreatments:\s*\[\s*'sealant',\s*'sdf'\s*\]/.test(cleaningSrc),
    'cleaning view charts with allowedTreatments [sealant, sdf] (items 4/5)');
  truthy(/fluoride_done/.test(cleaningSrc), 'cleaning view keeps the manual fluoride checkbox (item 3)');

  // Staff i18n parity via real ESM import (en/es must expose identical key sets).
  const parityScript = `
    import en from ${JSON.stringify('file://' + path.join(RENDERER, 'i18n', 'en.js'))};
    import es from ${JSON.stringify('file://' + path.join(RENDERER, 'i18n', 'es.js'))};
    const ek = Object.keys(en), sk = Object.keys(es);
    console.log(JSON.stringify({
      enCount: ek.length, esCount: sk.length,
      missingInEs: ek.filter((k) => !sk.includes(k)),
      missingInEn: sk.filter((k) => !ek.includes(k)),
      removedGone: !ek.includes('today_rule') && !sk.includes('today_rule')
        && !ek.includes('fluoride_adult_ext_hint') && !sk.includes('fluoride_adult_ext_hint'),
      gridKeys: ek.filter((k) => k.startsWith('grid_')).length,
      flu7Kept: ek.includes('fluoride_blocked_title') && sk.includes('fluoride_blocked_msg')
    }));
  `;
  const pr = spawnSync(process.execPath, ['--input-type=module', '-e', parityScript], { encoding: 'utf8' });
  let parity = null;
  try { parity = JSON.parse((pr.stdout || '').trim().split('\n').pop()); } catch (_) {}
  truthy(parity, 'staff i18n dictionaries import cleanly as ES modules');
  if (parity) {
    eq(parity.enCount, parity.esCount, `staff i18n parity preserved (en ${parity.enCount} == es ${parity.esCount})`);
    eq(parity.missingInEs, [], 'no en key missing from es');
    eq(parity.missingInEn, [], 'no es key missing from en');
    truthy(parity.removedGone, 'today_rule + fluoride_adult_ext_hint removed from BOTH dictionaries');
    eq(parity.gridKeys, 28, '28 grid_* staff keys added (title + col_total + 26 rows)');
    truthy(parity.flu7Kept, 'FLU-7 fluoride_blocked_* strings kept in both dictionaries');
  }

  // Report-language dictionary contract: grid.rows keys must exactly match
  // GRID_ROW_SPECS in both languages; months arrays complete.
  for (const l of ['es', 'en']) {
    const SL = reportStrings(l);
    eq(Object.keys(SL.grid.rows).sort(), reports.GRID_ROW_SPECS.map((r) => r.key).sort(),
      `main i18n ${l}: grid.rows keys exactly match GRID_ROW_SPECS`);
    eq(SL.months.length, 12, `main i18n ${l}: 12 spelled-out month names`);
  }

  // =========================================================================
  section('F. Item 8 — export/import DB (returning suite) still green');
  // =========================================================================
  const rr = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'returning-test.js')], { encoding: 'utf8' });
  const rout = (rr.stdout || '') + (rr.stderr || '');
  const rline = (rout.match(/RESULT: \d+ passed, \d+ failed/) || [''])[0];
  truthy(rr.status === 0 && /RESULT: 63 passed, 0 failed/.test(rout),
    `returning suite green (${rline || 'no RESULT line'})`);

  // =========================================================================
  console.log('\n=========================================================');
  console.log(`RESULT: ${passCount} passed, ${failCount} failed`);
  if (failCount) {
    console.log('\nFAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    console.log('\nVERDICT: v1.3.1 data-layer behaviour has FAILURES (see above).');
    process.exit(1);
  }
  console.log('\nVERDICT: v1.3.1 data-layer behaviour (clinic summary grid / performed-only / no double-count / long-form report dates with raw ISO data / hygienist sealant-SDF + notes / removed hints / import-export) is FULLY CORRECT.');
}

main().catch((e) => { console.error('UNCAUGHT:', e); process.exit(1); });
