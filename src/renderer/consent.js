/*
 * GDR permission slip — the clinic's real paper form (spec 5.1 Screen C, 9.1).
 *
 * Wording lives in the dictionaries and is read here through PT, so the slip
 * follows the PATIENT language (config.consent_language) rather than the staff
 * UI language. The parent ticks each care option individually — nothing is
 * pre-granted, so the three permission entries are rendered by the check-in
 * screen as opt-in checkboxes.
 */
import { PT } from './i18n/index.js';

export const CONSENT_SLIP = {
  title: PT.consent_slip_title,
  intro: PT.consent_slip_intro,
  receives: PT.consent_slip_receives,
  // The permission sentence is split around the blank where the parent/guardian
  // writes their name: "<lead> ______ <tail>".
  lead: PT.consent_slip_lead,
  tail: PT.consent_slip_tail,
  // [consent.permissions key, printed label] — fixed order, matches the paper form.
  permissions: [
    ['cleaning', PT.consent_perm_cleaning],
    ['fillings', PT.consent_perm_fillings],
    ['extractions', PT.consent_perm_extractions]
  ]
};

// Spoken sentence for the blank line: the name itself is not read aloud, so the
// punctuation that brackets the blank is trimmed away ("I, , give" -> "I give").
function permissionSentence() {
  const lead = String(CONSENT_SLIP.lead || '').trim().replace(/[,;:]+$/, '');
  const tail = String(CONSENT_SLIP.tail || '').trim().replace(/^[,;:]+\s*/, '');
  return [lead, tail].filter(Boolean).join(' ');
}

// Plain-text version used by the text-to-speech reader: the whole slip, ending
// with the three care options by name so a parent who cannot read the form
// still hears exactly what they are being asked to authorize.
export function consentSpeechText() {
  return [
    CONSENT_SLIP.title,
    CONSENT_SLIP.intro,
    CONSENT_SLIP.receives,
    permissionSentence(),
    CONSENT_SLIP.permissions.map(([, label]) => label).join(', ')
  ].filter(Boolean).join(' ');
}
