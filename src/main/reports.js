'use strict';
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const db = require('./db');
const codes = require('../shared/codes');
const config = require('./config');
const { reportStrings, LANG_NAMES } = require('./i18n');

/*
 * Reporting & end-of-clinic export (spec 8).
 *
 * Counts every treatment type GDR reports into Salesforce for donated-value-of-
 * care. The app reports COUNTS only (no dollar values, spec 8.1). Treatments are
 * counted when marked complete (the paper "slash"); cleanings/fluoride/OH from
 * their done flags.
 *
 * GENERATED reports/exports are localized to config.report_language (default
 * Spanish) — independent of the app UI language. See src/main/i18n.js.
 */

// Row order (labels come from the report-language dictionary).
const ROW_KEYS = [
  'fill_single', 'fill_double', 'fill_multi', 'composite',
  'ext_permanent', 'ext_primary', 'ext_surgical',
  'sealant', 'sdf', 'cleaning_prophy', 'cleaning_debride', 'cleaning_recommended',
  'fluoride', 'fluoride_recommended', 'oh_lessons', 'total_patients', 'nv_patients'
];

// Clinic summary grid (the GDR paper "Dental Clinic Summary Statistics" sheet):
// one column per clinic day in the range + a Total column. EXACT sheet row
// order; labels come from i18n `grid.rows`. Keys are prefix-free snake_case.
const GRID_ROW_SPECS = [
  { key: 'patients_total', indent: false },
  { key: 'patients_male', indent: true },
  { key: 'patients_female', indent: true },
  { key: 'patients_age_18_under', indent: true },
  { key: 'patients_age_19_older', indent: true },
  { key: 'exams', indent: false },
  { key: 'cleaning_prophy', indent: false },
  { key: 'cleaning_debridement', indent: false },
  { key: 'fluoride', indent: false },
  { key: 'sealants', indent: false },
  { key: 'fillings_total', indent: false },
  { key: 'fillings_1_surface', indent: true },
  { key: 'fillings_2_surface', indent: true },
  { key: 'fillings_3_surface', indent: true },
  { key: 'fillings_4_surface', indent: true },
  { key: 'composites_total', indent: false },
  { key: 'composites_1_surface', indent: true },
  { key: 'composites_2_surface', indent: true },
  { key: 'composites_3_surface', indent: true },
  { key: 'extractions_total', indent: false },
  { key: 'extractions_primary', indent: true },
  { key: 'extractions_adult', indent: true },
  { key: 'extractions_surgical', indent: true },
  { key: 'sdf_apply', indent: false },
  { key: 'nt', indent: false },
  { key: 'oh_lessons', indent: false }
];

function reportLang() {
  return config.load().report_language || 'es';
}

// ---- Long-form report dates (item 1) ------------------------------------
// Displayed dates in generated reports are spelled out ("May 1, 2026" EN /
// "1 de mayo de 2026" ES). Raw ISO stays untouched in data files and in the
// machine-readable stats fields (from/to/generated_at/day_dates).

/** Spell out a date-only ISO string (YYYY-MM-DD). Never uses Date parsing —
 *  a date-only ISO parses as UTC and can render off by one day locally. */
function fmtReportDate(iso, S, lang) {
  const m = String(iso == null ? '' : iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso == null ? '' : String(iso);
  const month = S.months && S.months[parseInt(m[2], 10) - 1];
  if (!month) return String(iso).slice(0, 10);
  const day = parseInt(m[3], 10);
  return lang === 'en' ? `${month} ${day}, ${m[1]}` : `${day} de ${month} de ${m[1]}`;
}

/** Spell out a full ISO timestamp (local date + HH:MM). */
function fmtReportTimestamp(iso, S, lang) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return iso == null ? '' : String(iso);
  const month = S.months && S.months[d.getMonth()];
  if (!month) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return lang === 'en'
    ? `${month} ${d.getDate()}, ${d.getFullYear()} ${time}`
    : `${d.getDate()} de ${month} de ${d.getFullYear()} ${time}`;
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/**
 * Clinic summary grid (item 9) — the paper "Dental Clinic Summary Statistics"
 * sheet. Every distinct visit_date in [from,to] becomes a day column (sorted
 * ASC, no cap); Total = arithmetic sum of the day columns for every row.
 *
 * Counting rules (see GRID_ROW_SPECS order):
 * - patients_* count DISTINCT patients (by p.id) with >=1 visit that day;
 *   sex/age subgroups may sum to less than Patients (unknowns excluded).
 *   A patient attending two different days counts once per day, so the
 *   Total of the patient rows is a per-day attendance sum (intentional —
 *   it matches how the paper sheet totals its daily columns).
 * - Treatment rows count STRUCTURED items only (complete && !not_done),
 *   with NO treatment_notes fallback: the surface-split rows cannot be
 *   reconstructed losslessly from free text and the fallback would break
 *   the parent-total = sum-of-children invariant.
 * - Surgical extractions are EXCLUSIVE of Primary/Adult (classifyItem rule),
 *   so Extractions = Primary + Adult + Surgical exactly.
 * Returns { day_dates: ['YYYY-MM-DD'...], rows: [{ key, label, indent, perDay, total }] }.
 */
function computeClinicSummary(opts, S) {
  const o = opts || {};
  const byDay = new Map(); // 'YYYY-MM-DD' -> [{ p, v }]
  for (const p of db.allPatients()) {
    for (const v of (p.visits || [])) {
      if (!v || !inRange(v.visit_date, o.from, o.to)) continue;
      const d = String(v.visit_date).slice(0, 10);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push({ p, v });
    }
  }
  const dayDates = Array.from(byDay.keys()).sort();
  const gridLabels = (S && S.grid && S.grid.rows) || {};
  const rows = GRID_ROW_SPECS.map((spec) => ({
    key: spec.key,
    label: gridLabels[spec.key] || spec.key,
    indent: spec.indent,
    perDay: [],
    total: 0
  }));

  for (const day of dayDates) {
    const c = {};
    GRID_ROW_SPECS.forEach((spec) => { c[spec.key] = 0; });
    const seenPatients = new Set();
    for (const { p, v } of byDay.get(day)) {
      // Distinct patients per day (dedup guards duplicate visits on one date)
      if (!seenPatients.has(p.id)) {
        seenPatients.add(p.id);
        c.patients_total++;
        if (p.sex === 'M') c.patients_male++;
        else if (p.sex === 'F') c.patients_female++;
        const age = p.age_at_first_visit;
        if (typeof age === 'number' && !isNaN(age)) {
          if (age <= 18) c.patients_age_18_under++;
          else if (age >= 19) c.patients_age_19_older++;
        }
      }
      // Per-visit rows
      if (v.exam_type === 'E' || v.exam_type === 'R') c.exams++;
      if (v.cleaning_done) {
        if (v.cleaning_type === 'P') c.cleaning_prophy++;
        else if (v.cleaning_type === 'D') c.cleaning_debridement++;
      }
      if (v.fluoride_done === true) c.fluoride++;
      if (v.nt_status === true) c.nt++;
      if (v.oh1_done) c.oh_lessons++;
      if (v.oh2_done) c.oh_lessons++;
      if (v.oh3_done) c.oh_lessons++;
      // Per-item rows (performed only — same rule as computeStats)
      for (const t of (v.treatment_items || [])) {
        if (!t || !t.complete || t.not_done === true) continue;
        const n = codes.sortSurfaces(t.surfaces).length;
        switch (t.treatment_type) {
          case 'sealant':
            c.sealants++;
            break;
          case 'sdf':
            c.sdf_apply++;
            break;
          case 'restoration':
            c.fillings_total++;
            if (n <= 1) c.fillings_1_surface++;        // 0-surface folds into 1
            else if (n === 2) c.fillings_2_surface++;
            else if (n === 3) c.fillings_3_surface++;
            else c.fillings_4_surface++;               // 4+ clamps into 4
            break;
          case 'composite':
            c.composites_total++;
            if (n <= 1) c.composites_1_surface++;      // 0-surface folds into 1
            else if (n === 2) c.composites_2_surface++;
            else c.composites_3_surface++;             // 3+ clamps (no 4-row)
            break;
          case 'extraction':
            c.extractions_total++;
            if (t.surgical === true) c.extractions_surgical++; // exclusive
            else if (codes.isPrimaryTooth(t.tooth)) c.extractions_primary++;
            else c.extractions_adult++;
            break;
          default:
            break;
        }
      }
    }
    rows.forEach((r) => { r.perDay.push(c[r.key]); r.total += c[r.key]; });
  }
  return { day_dates: dayDates, rows };
}

/**
 * Aggregate treatment counts over a date range (filter by visit_date).
 * opts: { from: 'YYYY-MM-DD'|null, to: 'YYYY-MM-DD'|null }
 * Returns rows + localized headers/title in the report language.
 */
function computeStats(opts) {
  const o = opts || {};
  const lang = reportLang();
  const S = reportStrings(lang);
  const counts = {};
  ROW_KEYS.forEach((k) => { counts[k] = 0; });

  let visitsCounted = 0;
  for (const p of db.allPatients()) {
    for (const v of (p.visits || [])) {
      if (!inRange(v.visit_date, o.from, o.to)) continue;
      visitsCounted++;

      // Treatments from structured items (preferred). Count completed items;
      // never count items explicitly marked "not done" (not_done === true).
      const items = (v.treatment_items || []).filter((t) => t.complete && t.not_done !== true);
      if (items.length) {
        items.forEach((t) => {
          const k = codes.classifyItem(t);
          if (k && counts[k] != null) counts[k]++;
        });
      } else if (v.treatment_notes) {
        // Fallback: parse the free-text notes for slashed/completed codes.
        codes.tokenizeNotes(v.treatment_notes).forEach((tok) => {
          const k = codes.classifyToken(tok);
          if (k && counts[k] != null) counts[k]++;
        });
      }

      // Cleanings — recommended (clinician order) and completed (executed)
      if (v.cleaning_type === 'P' || v.cleaning_type === 'D') counts.cleaning_recommended++;
      if (v.cleaning_done) {
        if (v.cleaning_type === 'P') counts.cleaning_prophy++;
        else if (v.cleaning_type === 'D') counts.cleaning_debride++;
      }
      // Fluoride — recommended (only count when the dentist actually examined the
      // patient; fluoride_recommended defaults true on every new visit) and completed.
      if (v.fluoride_recommended && (v.exam_type || (v.station_status && v.station_status.dentist))) counts.fluoride_recommended++;
      if (v.fluoride_done) counts.fluoride++;
      // OH lessons
      if (v.oh1_done) counts.oh_lessons++;
      if (v.oh2_done) counts.oh_lessons++;
      if (v.oh3_done) counts.oh_lessons++;
      // Outcomes
      if (v.checkout_timestamp) counts.total_patients++;
      if (v.visit_outcome === 'NV') counts.nv_patients++;
    }
  }

  return {
    from: o.from || null,
    to: o.to || null,
    generated_at: new Date().toISOString(),
    visits_in_range: visitsCounted,
    report_language: lang,
    report_language_name: LANG_NAMES[lang] || lang,
    title: S.summary_title,
    col_type: S.col_type,
    col_count: S.col_count,
    rows: ROW_KEYS.map((k) => ({ key: k, label: S.rows[k], count: counts[k] })),
    // Clinic summary grid (item 9) — rides the existing report:stats payload.
    clinic_summary: computeClinicSummary(o, S)
  };
}

function timestampName(prefix, ext) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${prefix}_${stamp}.${ext}`;
}

function csvEscape(val) {
  const s = val == null ? '' : String(val);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rangeText(S, stats) {
  const lang = stats.report_language || reportLang();
  const from = stats.from ? fmtReportDate(stats.from, S, lang) : S.range_start;
  const to = stats.to ? fmtReportDate(stats.to, S, lang) : S.range_end;
  return `${from} ${S.range_to} ${to}`;
}

// Rows of the clinic-summary grid block appended to both summary exports.
// [title], [<blank>, spelled-out day dates..., Total], then one row per grid
// row (indented children get a leading two-space marker).
function gridExportRows(stats, S, lang) {
  const grid = stats.clinic_summary;
  if (!grid || !Array.isArray(grid.rows) || !grid.rows.length) return null;
  const dayDates = grid.day_dates || [];
  const header = [''].concat(dayDates.map((d) => fmtReportDate(d, S, lang)), [S.grid.col_total]);
  const body = grid.rows.map((r) => {
    const perDay = Array.isArray(r.perDay) ? r.perDay : [];
    return [(r.indent ? '  ' : '') + (r.label || r.key)].concat(perDay, [r.total || 0]);
  });
  return { title: S.grid.title, header, body };
}

// ---- Treatment summary export (8.2) ------------------------------------
function exportSummaryCSV(stats) {
  const lang = stats.report_language || reportLang();
  const S = reportStrings(lang);
  const lines = [];
  lines.push(csvEscape(S.summary_title));
  lines.push(`${csvEscape(S.clinic)},${csvEscape(config.load().clinic_name)}`);
  lines.push(`${csvEscape(S.date_range)},${csvEscape(rangeText(S, stats))}`);
  lines.push(`${csvEscape(S.generated)},${csvEscape(fmtReportTimestamp(stats.generated_at, S, lang))}`);
  lines.push('');
  lines.push([S.col_type, S.col_count].map(csvEscape).join(','));
  stats.rows.forEach((r) => lines.push([csvEscape(r.label), r.count].join(',')));
  // Clinic summary grid (item 9): per-day columns + Total.
  const grid = gridExportRows(stats, S, lang);
  if (grid) {
    lines.push('');
    lines.push(csvEscape(grid.title));
    lines.push(grid.header.map(csvEscape).join(','));
    grid.body.forEach((row) => lines.push(row.map(csvEscape).join(',')));
  }
  lines.push('');
  lines.push(csvEscape('© 2026 Software Smiles™ — Mexico Clinic - Global Dental Relief'));
  const out = '﻿' + lines.join('\r\n'); // BOM so Excel reads UTF-8
  const file = path.join(paths.exports(), timestampName('treatment_report', 'csv'));
  fs.writeFileSync(file, out, 'utf8');
  return file;
}

async function exportSummaryXLSX(stats) {
  let ExcelJS;
  try { ExcelJS = require('exceljs'); }
  catch (e) { return { error: 'exceljs_unavailable' }; }
  const lang = stats.report_language || reportLang();
  const S = reportStrings(lang);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Software Smiles — GDR';
  const ws = wb.addWorksheet(S.sheet_name);
  ws.mergeCells('A1:B1');
  ws.getCell('A1').value = S.summary_title;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A3').value = S.clinic;
  ws.getCell('B3').value = config.load().clinic_name;
  ws.getCell('A4').value = S.date_range;
  ws.getCell('B4').value = rangeText(S, stats);
  ws.getCell('A5').value = S.generated;
  ws.getCell('B5').value = fmtReportTimestamp(stats.generated_at, S, lang);
  ws.addRow([]);
  ws.addRow([S.col_type, S.col_count]).font = { bold: true };
  stats.rows.forEach((r) => ws.addRow([r.label, r.count]));
  // Clinic summary grid (item 9): per-day columns + Total.
  const grid = gridExportRows(stats, S, lang);
  if (grid) {
    ws.addRow([]);
    ws.addRow([grid.title]).font = { bold: true, size: 12 };
    ws.addRow(grid.header).font = { bold: true };
    grid.body.forEach((row) => ws.addRow(row));
  }
  ws.addRow([]);
  ws.addRow(['© 2026 Software Smiles™ — Mexico Clinic - Global Dental Relief']).font = { italic: true, size: 9, color: { argb: 'FF888888' } };
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 12;
  if (grid) {
    // Day + Total columns are wide enough for spelled-out date headers.
    for (let ci = 2; ci < 2 + grid.header.length - 1; ci++) {
      ws.getColumn(ci).width = Math.max(ws.getColumn(ci).width || 0, 20);
    }
  }
  // "Progress Report typeface: Georgia" (GDR Graphic Standards).
  ws.eachRow((row) => { row.eachCell((cell) => { cell.font = Object.assign({ name: 'Georgia' }, cell.font || {}); }); });
  const file = path.join(paths.exports(), timestampName('treatment_report', 'xlsx'));
  await wb.xlsx.writeFile(file);
  return file;
}

// ---- Master DB export (8.3) --------------------------------------------
function exportMasterJSON() {
  const data = db.exportMaster();
  const file = path.join(paths.exports(), timestampName('master_db_export', 'json'));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  return file;
}

function exportMasterCSV() {
  // One row per visit, with patient identity columns repeated.
  // Column headers are stable English keys (machine-readable for Salesforce).
  const cols = [
    'patient_number', 'first_name', 'last_name', 'sex', 'age_at_first_visit', 'school_group',
    'visit_date', 'exam_type', 'clinician_type', 'clinician_initials', 'nt_status',
    'treatment_codes', 'cleaning_type', 'cleaning_done', 'oh1', 'oh2', 'oh3', 'fluoride',
    'visit_outcome', 'checkout_timestamp'
  ];
  const lines = [cols.join(',')];
  for (const p of db.allPatients()) {
    const visits = (p.visits && p.visits.length) ? p.visits : [null];
    for (const v of visits) {
      const treatmentCodes = v
        ? (v.treatment_items || []).map((t) => codes.formatItem(t) + (t.complete ? '/' : '')).join(' ')
            + (v.treatment_notes ? ' ' + v.treatment_notes : '')
        : '';
      const row = [
        p.patient_number, p.first_name, p.last_name, p.sex, p.age_at_first_visit, p.school_group,
        v ? v.visit_date : '', v ? v.exam_type : '', v ? v.clinician_type : '', v ? v.clinician_initials : '',
        v ? v.nt_status : '', treatmentCodes.trim(), v ? v.cleaning_type : '', v ? v.cleaning_done : '',
        v ? v.oh1_done : '', v ? v.oh2_done : '', v ? v.oh3_done : '', v ? v.fluoride_done : '',
        v ? v.visit_outcome : '', v ? v.checkout_timestamp : ''
      ];
      lines.push(row.map(csvEscape).join(','));
    }
  }
  const file = path.join(paths.exports(), timestampName('master_db_export', 'csv'));
  fs.writeFileSync(file, '﻿' + lines.join('\r\n'), 'utf8'); // BOM so Excel reads UTF-8
  return file;
}

module.exports = {
  ROW_KEYS,
  GRID_ROW_SPECS,
  computeStats,
  computeClinicSummary,
  exportSummaryCSV,
  exportSummaryXLSX,
  exportMasterJSON,
  exportMasterCSV
};
