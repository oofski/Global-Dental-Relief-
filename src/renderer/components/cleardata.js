/*
 * "Clear patients" flow — reset the local patient ledger for a new clinic day /
 * deployment. Available to front desk, checkout, and admin. Safety measures:
 *   - a backup JSON is exported automatically (by the main process) before wiping
 *   - the operator must type a confirmation keyword
 *   - optional "reset patient numbering" for a truly fresh ledger
 * Staff-facing -> staff (English) language.
 */
import { h, modal, toast, alertDialog, checkbox, field } from '../util.js';
import { T } from '../i18n/index.js';

export async function clearPatientsFlow(onDone) {
  const cRes = await window.api.db.count();
  const n = (cRes && cRes.ok) ? cRes.data : 0;

  let resetCounter = false;
  const resetBox = checkbox(T.clear_reset_numbering, false, (v) => { resetCounter = v; });
  const input = h('input', { class: 'text-input', placeholder: T.clear_keyword, autocapitalize: 'characters', spellcheck: 'false' });

  const body = h('div', { class: 'clear-flow' }, [
    h('div', { class: 'warn-banner', text: T.clear_warn.replace('{n}', n) }),
    h('div', { class: 'clear-opt' }, [resetBox]),
    field(T.clear_type_confirm.replace('{word}', T.clear_keyword), input)
  ]);

  const val = await modal({
    title: T.clear_title,
    body,
    actions: [
      { label: T.cancel, value: false },
      { label: T.clear_patients, value: true, danger: true }
    ]
  });
  if (!val) return;

  if ((input.value || '').trim().toUpperCase() !== T.clear_keyword.toUpperCase()) {
    toast(T.clear_mismatch, 'error', 5000);
    return;
  }

  const res = await window.api.db.clearAll({ resetCounter });
  if (!res || !res.ok) { toast(T.error, 'error'); return; }
  await alertDialog(
    T.clear_title,
    T.clear_done.replace('{n}', res.data.removed).replace('{file}', res.data.backupFile || '—')
  );
  if (onDone) onDone();
}

// Convenience button factory.
export function clearPatientsButton(onDone, { small = false } = {}) {
  return h('button', {
    class: 'btn btn-danger' + (small ? ' btn-sm' : ''),
    onClick: () => clearPatientsFlow(onDone)
  }, '🗑 ' + T.clear_patients);
}
