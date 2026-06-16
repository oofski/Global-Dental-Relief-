/*
 * Medical history form (spec 4.2 / 5.1 Screen D).
 * Toggle checkboxes with Spanish labels; conditions with an "identify" sub-field
 * expand a text input when turned on. Mutates the passed `med` object in place.
 */
import { h } from '../util.js';
import { T } from '../i18n/es.js';

// [boolKey, label, textKey?]  — high-priority flags marked for styling.
const FIELDS = [
  ['asthma', T.med_asthma, null, false],
  ['medications', T.med_medications, 'medications_text', false],
  ['recent_hospital', T.med_recent_hospital, 'recent_hospital_text', false],
  ['allergies', T.med_allergies, 'allergies_text', true],
  ['bleeding_problems', T.med_bleeding, 'bleeding_problems_text', true],
  ['infectious_disease', T.med_infectious, 'infectious_disease_text', true],
  ['epilepsy_fainting', T.med_epilepsy, null, false],
  ['heart_problems', T.med_heart, null, true],
  ['diabetes', T.med_diabetes, null, true]
];

export function medForm(med) {
  const host = h('div', { class: 'med-form' });
  FIELDS.forEach(([boolKey, label, textKey, hi]) => {
    const chk = h('input', { type: 'checkbox', checked: !!med[boolKey] });
    const textInput = textKey
      ? h('input', { class: 'text-input', type: 'text', placeholder: T.identify, value: med[textKey] || '' })
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
      h('label', { class: 'checkbox' }, [chk, h('span', { text: label })]),
      textInput
    ]));
  });
  return host;
}
