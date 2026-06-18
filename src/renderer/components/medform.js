/*
 * Medical history form (spec 4.2 / 5.1 Screen D).
 *
 * This form is PATIENT-FACING — the parent/guardian reads and fills it — so it
 * renders in the patient language (PT, from config.consent_language; Spanish by
 * default), independent of the English staff UI. Conditions with an "identify"
 * sub-field expand a text input when turned on. Mutates the passed `med` object.
 */
import { h } from '../util.js';
import { PT } from '../i18n/index.js';

// [boolKey, labelKey, textKey?, highPriority]  — labels resolved via PT at render.
const FIELDS = [
  ['asthma', 'med_asthma', null, false],
  ['medications', 'med_medications', 'medications_text', false],
  ['recent_hospital', 'med_recent_hospital', 'recent_hospital_text', false],
  ['allergies', 'med_allergies', 'allergies_text', true],
  ['bleeding_problems', 'med_bleeding', 'bleeding_problems_text', true],
  ['infectious_disease', 'med_infectious', 'infectious_disease_text', true],
  ['epilepsy_fainting', 'med_epilepsy', null, false],
  ['heart_problems', 'med_heart', null, true],
  ['diabetes', 'med_diabetes', null, false]
];

export function medForm(med) {
  const host = h('div', { class: 'med-form' });
  FIELDS.forEach(([boolKey, labelKey, textKey, hi]) => {
    const chk = h('input', { type: 'checkbox', checked: !!med[boolKey] });
    const textInput = textKey
      ? h('input', { class: 'text-input', type: 'text', placeholder: PT.identify, value: med[textKey] || '' })
      : null;
    if (textInput) {
      textInput.style.display = med[boolKey] ? '' : 'none';
      textInput.addEventListener('input', () => { med[textKey] = textInput.value; });
    }
    chk.addEventListener('change', () => {
      med[boolKey] = chk.checked;
      if (textInput) {
        textInput.style.display = chk.checked ? '' : 'none';
        if (!chk.checked) { med[textKey] = ''; textInput.value = ''; }
      }
    });
    host.appendChild(h('div', { class: 'med-row' + (hi ? ' med-hi' : '') }, [
      h('label', { class: 'checkbox' }, [chk, h('span', { text: PT[labelKey] })]),
      textInput
    ]));
  });
  return host;
}
