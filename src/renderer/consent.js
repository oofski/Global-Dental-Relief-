/*
 * GDR Consent form — Spanish render (spec 5.1 Screen C, 9.1).
 *
 * NOTE (Open Question 11.4): GDR has not yet provided the FINAL official Spanish
 * text of their consent document. The text below is a complete, clinically
 * reasonable DRAFT so the screen, the text-to-speech reader and the signature
 * capture are fully functional. Replace `CONSENT_PARAGRAPHS` with GDR's official
 * wording when supplied — no code changes required.
 */

export const CONSENT_TITLE = 'Consentimiento para Tratamiento Dental — Global Dental Relief';

export const CONSENT_DRAFT_NOTICE =
  'BORRADOR — pendiente del texto oficial de GDR. Reemplazar antes del despliegue.';

export const CONSENT_PARAGRAPHS = [
  'Global Dental Relief (GDR) es una organización sin fines de lucro que brinda atención dental gratuita a niños en edad escolar.',
  'Doy mi consentimiento para que mi hijo/a reciba una evaluación dental y el tratamiento dental que el equipo clínico considere necesario. Esto puede incluir exámenes, limpiezas, empastes (restauraciones), extracciones de dientes, sellantes, aplicaciones de flúor y aplicaciones de fluoruro diamino de plata (SDF).',
  'Entiendo que el tratamiento se brinda de forma voluntaria y gratuita, y que los voluntarios clínicos son dentistas e higienistas con licencia.',
  'Entiendo que, como con cualquier procedimiento dental, existen riesgos. He tenido la oportunidad de hacer preguntas sobre el tratamiento.',
  'He proporcionado, a mi leal saber y entender, información médica precisa sobre mi hijo/a, incluyendo alergias, medicamentos y condiciones de salud.',
  'Autorizo a GDR a registrar la información del tratamiento de mi hijo/a para fines de continuidad de la atención en futuras visitas a la clínica.',
  'Como padre, madre o tutor legal, confirmo que tengo la autoridad para dar este consentimiento en nombre del niño/a.'
];

// Plain-text version used by the text-to-speech reader.
export function consentSpeechText() {
  return [CONSENT_TITLE, ...CONSENT_PARAGRAPHS].join(' ');
}
