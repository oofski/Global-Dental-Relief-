'use strict';
/*
 * Report/export language strings (main process, CommonJS).
 *
 * GENERATED reports and exports use this language (config.report_language,
 * default Spanish) — independent of the app UI language. Add a language by
 * adding a parallel block; every `rows` key must match reports.js ROW_KEYS,
 * every `grid.rows` key must match reports.js GRID_ROW_SPECS, and `months`
 * must list the 12 spelled-out month names (long-form report dates).
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
    months: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
    grid: {
      title: 'Resumen Estadístico de la Clínica Dental',
      col_total: 'Total',
      rows: {
        patients_total: 'Pacientes',
        patients_male: 'Masculino',
        patients_female: 'Femenino',
        patients_age_18_under: '18 años o menos',
        patients_age_19_older: '19 años o más',
        exams: 'Exámenes',
        cleaning_prophy: 'Limpieza - Profilaxis',
        cleaning_debridement: 'Debridamiento',
        fluoride: 'Flúor',
        sealants: 'Sellantes',
        fillings_total: 'Empastes',
        fillings_1_surface: '1 superficie',
        fillings_2_surface: '2 superficies',
        fillings_3_surface: '3 superficies',
        fillings_4_surface: '4 superficies',
        composites_total: 'Composites',
        composites_1_surface: '1 superficie',
        composites_2_surface: '2 superficies',
        composites_3_surface: '3 superficies',
        extractions_total: 'Extracciones',
        extractions_primary: 'Primarias',
        extractions_adult: 'Adultas',
        extractions_surgical: 'Quirúrgicas',
        sdf_apply: 'Aplicaciones de SDF',
        nt: 'NT',
        oh_lessons: 'OH 1,2,3'
      }
    },
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
      cleaning_recommended: 'Limpiezas recomendadas',
      fluoride: 'Aplicaciones de flúor',
      fluoride_recommended: 'Flúor recomendado',
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
    months: ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'],
    grid: {
      title: 'Dental Clinic Summary Statistics',
      col_total: 'Total',
      rows: {
        patients_total: 'Patients',
        patients_male: 'Male',
        patients_female: 'Female',
        patients_age_18_under: '18/under',
        patients_age_19_older: '19/older',
        exams: 'Exams',
        cleaning_prophy: 'CL - Prophy',
        cleaning_debridement: 'Debridement',
        fluoride: 'Fluoride',
        sealants: 'Sealants',
        fillings_total: 'Fillings',
        fillings_1_surface: '1 surface',
        fillings_2_surface: '2 surface',
        fillings_3_surface: '3 surface',
        fillings_4_surface: '4 surface',
        composites_total: 'Composites',
        composites_1_surface: '1 surface',
        composites_2_surface: '2 surface',
        composites_3_surface: '3 surface',
        extractions_total: 'Extractions',
        extractions_primary: 'Primary',
        extractions_adult: 'Adult',
        extractions_surgical: 'Surgical',
        sdf_apply: 'SDF apply',
        nt: 'NT',
        oh_lessons: 'OH 1,2,3'
      }
    },
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
      cleaning_recommended: 'Cleanings recommended',
      fluoride: 'Fluoride applications',
      fluoride_recommended: 'Fluoride recommended',
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
