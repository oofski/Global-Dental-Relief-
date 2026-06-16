'use strict';
/*
 * Report/export language strings (main process, CommonJS).
 *
 * GENERATED reports and exports use this language (config.report_language,
 * default Spanish) — independent of the app UI language. Add a language by
 * adding a parallel block; every `rows` key must match reports.js ROW_KEYS.
 */

const STRINGS = {
  es: {
    summary_title: 'Reporte de Resumen de Tratamientos — Global Dental Relief',
    clinic: 'Clínica',
    deployment: 'Despliegue',
    date_range: 'Rango de fechas',
    range_start: 'Inicio',
    range_end: 'Hoy',
    range_to: 'a',
    generated: 'Generado',
    visits_in_range: 'Visitas en el rango',
    col_type: 'Tipo de tratamiento',
    col_count: 'Cantidad',
    sheet_name: 'Resumen',
    rows: {
      fill_single: 'Empastes de una superficie',
      fill_double: 'Empastes de dos superficies',
      fill_multi: 'Empastes de tres o más superficies',
      composite: 'Empastes de composite (estéticos)',
      ext_permanent: 'Extracciones de dientes permanentes',
      ext_primary: 'Extracciones de dientes primarios',
      ext_surgical: 'Extracciones quirúrgicas',
      sealant: 'Sellantes',
      sdf: 'Aplicaciones de SDF',
      cleaning_prophy: 'Limpiezas estándar (Profilaxis)',
      cleaning_debride: 'Limpiezas profundas (Debridamiento)',
      fluoride: 'Aplicaciones de flúor',
      oh_lessons: 'Lecciones de salud bucal impartidas',
      total_patients: 'Total de pacientes atendidos',
      nv_patients: 'Pacientes con próxima visita (NV)'
    }
  },
  en: {
    summary_title: 'Treatment Summary Report — Global Dental Relief',
    clinic: 'Clinic',
    deployment: 'Deployment',
    date_range: 'Date range',
    range_start: 'Start',
    range_end: 'Today',
    range_to: 'to',
    generated: 'Generated',
    visits_in_range: 'Visits in range',
    col_type: 'Treatment type',
    col_count: 'Count',
    sheet_name: 'Summary',
    rows: {
      fill_single: 'Single-surface fillings',
      fill_double: 'Double-surface fillings',
      fill_multi: 'Multi-surface fillings (3+)',
      composite: 'Composite fillings',
      ext_permanent: 'Permanent tooth extractions',
      ext_primary: 'Primary tooth extractions',
      ext_surgical: 'Surgical extractions',
      sealant: 'Sealants',
      sdf: 'SDF applications',
      cleaning_prophy: 'Standard cleanings (Prophy)',
      cleaning_debride: 'Deep cleanings (Debridement)',
      fluoride: 'Fluoride applications',
      oh_lessons: 'Oral health lessons given',
      total_patients: 'Total patients seen',
      nv_patients: 'Next-visit (NV) patients'
    }
  }
};

const LANG_NAMES = { es: 'Español', en: 'English' };

function reportStrings(lang) {
  return STRINGS[lang] || STRINGS.es;
}

module.exports = { reportStrings, LANG_NAMES, STRINGS };
