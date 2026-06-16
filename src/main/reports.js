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
  'sealant', 'sdf', 'cleaning_prophy', 'cleaning_debride',
  'fluoride', 'oh_lessons', 'total_patients', 'nv_patients'
];

function reportLang() {
  return config.load().report_language || 'es';
}

function inRange(dateStr, from, to) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
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

      // Treatments from structured items (preferred). Count completed items.
      const items = (v.treatment_items || []).filter((t) => t.complete);
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

      // Cleanings
      if (v.cleaning_done) {
        if (v.cleaning_type === 'P') counts.cleaning_prophy++;
        else if (v.cleaning_type === 'D') counts.cleaning_debride++;
      }
      // Fluoride
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
    rows: ROW_KEYS.map((k) => ({ key: k, label: S.rows[k], count: counts[k] }))
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
  return `${stats.from || S.range_start} ${S.range_to} ${stats.to || S.range_end}`;
}

// ---- Treatment summary export (8.2) ------------------------------------
function exportSummaryCSV(stats) {
  const S = reportStrings(stats.report_language || reportLang());
  const lines = [];
  lines.push(csvEscape(S.summary_title));
  lines.push(`${csvEscape(S.clinic)},${csvEscape(config.load().clinic_name)}`);
  lines.push(`${csvEscape(S.date_range)},${csvEscape(rangeText(S, stats))}`);
  lines.push(`${csvEscape(S.generated)},${csvEscape(stats.generated_at)}`);
  lines.push('');
  lines.push([S.col_type, S.col_count].map(csvEscape).join(','));
  stats.rows.forEach((r) => lines.push([csvEscape(r.label), r.count].join(',')));
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
  const S = reportStrings(stats.report_language || reportLang());
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
  ws.getCell('B5').value = stats.generated_at;
  ws.addRow([]);
  ws.addRow([S.col_type, S.col_count]).font = { bold: true };
  stats.rows.forEach((r) => ws.addRow([r.label, r.count]));
  ws.addRow([]);
  ws.addRow(['© 2026 Software Smiles™ — Mexico Clinic - Global Dental Relief']).font = { italic: true, size: 9, color: { argb: 'FF888888' } };
  ws.getColumn(1).width = 46;
  ws.getColumn(2).width = 12;
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
  computeStats,
  exportSummaryCSV,
  exportSummaryXLSX,
  exportMasterJSON,
  exportMasterCSV
};
