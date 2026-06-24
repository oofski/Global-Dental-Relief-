/* Admin portal — user account management (create accounts, change passwords). */
import { h, mount, toast, confirmDialog, modal, field, spinner } from '../util.js';
import { T } from '../i18n/index.js';

const ROLE_LABELS = {
  admin: T.role_admin,
  check_in: T.role_check_in,
  dentist: T.role_dentist,
  cleaning: T.role_cleaning,
  fluoride: T.role_fluoride,
  checkout: T.role_checkout
};
const ROLE_ORDER = ['admin', 'check_in', 'dentist', 'cleaning', 'fluoride', 'checkout'];

function errText(code) {
  const map = {
    username_taken: T.err_username_taken,
    username_invalid: T.err_username_invalid,
    username_required: T.err_username_required,
    password_too_short: T.err_password_too_short,
    role_invalid: T.err_role_invalid,
    last_admin: T.err_last_admin,
    forbidden: T.err_forbidden,
    not_found: T.error
  };
  return map[code] || T.error;
}

function roleSelect(value) {
  const sel = h('select', { class: 'text-input' },
    ROLE_ORDER.map((r) => {
      const o = h('option', { value: r, text: ROLE_LABELS[r] || r });
      if (r === value) o.selected = true;
      return o;
    })
  );
  return sel;
}

// Password field with a show/hide toggle. Returns { node, get }.
function passwordField(initial) {
  const input = h('input', { class: 'text-input', type: 'password', value: initial || '' });
  let shown = false;
  const toggle = h('button', { class: 'pw-toggle', type: 'button' }, T.show);
  toggle.addEventListener('click', () => {
    shown = !shown; input.type = shown ? 'text' : 'password';
    toggle.textContent = shown ? T.hide : T.show; input.focus();
  });
  return { node: h('div', { class: 'pw-row' }, [input, toggle]), get: () => input.value };
}

export function renderAccounts(container) {
  async function load() {
    mount(container, spinner(T.loading));
    const res = await window.api.users.list();
    if (!res.ok) { mount(container, h('div', { class: 'big-info', text: T.err_forbidden })); return; }
    render(res.data || []);
  }

  function render(usersList) {
    const rows = usersList.map((u) => h('tr', { class: u.active ? '' : 'row-inactive' }, [
      h('td', { text: u.username }),
      h('td', { text: u.display_name || '—' }),
      h('td', { text: u.email || '—' }),
      h('td', {}, h('span', { class: 'tag', text: ROLE_LABELS[u.role] || u.role })),
      h('td', {}, h('span', { class: 'tag ' + (u.active ? 'tag-F' : 'tag-NV'), text: u.active ? T.active : T.inactive })),
      h('td', { class: 'acct-actions' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => changePassword(u) }, '🔑 ' + T.change_password),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => editAccount(u) }, '✎ ' + T.edit),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => toggleActive(u) }, u.active ? T.deactivate : T.activate),
        h('button', { class: 'btn btn-danger btn-sm', onClick: () => removeAccount(u) }, '🗑 ' + T.delete)
      ])
    ]));

    mount(container, h('div', { class: 'view accounts-view' }, [
      h('div', { class: 'view-head' }, [
        h('h2', { text: T.accounts_title }),
        h('button', { class: 'btn btn-primary', onClick: createAccount }, '＋ ' + T.create_account)
      ]),
      h('div', { class: 'card' }, [
        h('table', { class: 'report-table accounts-table' }, [
          h('thead', {}, h('tr', {}, [
            h('th', { text: T.username }),
            h('th', { text: T.display_name }),
            h('th', { text: T.email }),
            h('th', { text: T.role }),
            h('th', { text: T.status }),
            h('th', { text: T.actions })
          ])),
          h('tbody', {}, rows)
        ])
      ]),
      h('div', { class: 'muted', text: T.default_pw_hint })
    ]));
  }

  async function createAccount() {
    const uname = h('input', { class: 'text-input', autocapitalize: 'none', spellcheck: 'false' });
    const fname = h('input', { class: 'text-input' });
    const lname = h('input', { class: 'text-input' });
    const dname = h('input', { class: 'text-input' });
    const emailInp = h('input', { class: 'text-input', type: 'email', autocapitalize: 'none', spellcheck: 'false' });
    const role = roleSelect('dentist');
    const pw = passwordField('welcome123');
    const body = h('div', { class: 'form-grid' }, [
      field(T.username, uname, { required: true }),
      field(T.first_name, fname),
      field(T.last_name, lname),
      field(T.display_name, dname),
      field(T.email, emailInp),
      field(T.role, role, { required: true, hint: 'Trip leaders should be given the Admin role so they can access and modify patient files.' }),
      field(T.password, pw.node, { hint: T.default_pw_hint })
    ]);
    const val = await modal({
      title: T.new_account, body,
      actions: [{ label: T.cancel, value: false }, { label: T.create_account, value: true, primary: true }]
    });
    if (!val) return;
    const res = await window.api.users.create({
      username: uname.value.trim(),
      first_name: fname.value.trim(),
      last_name: lname.value.trim(),
      display_name: dname.value.trim(),
      email: emailInp.value.trim(),
      role: role.value,
      password: pw.get()
    });
    if (!res.ok) { toast(errText(res.error), 'error'); return; }
    toast(T.account_created, 'success');
    load();
  }

  async function editAccount(u) {
    const fname = h('input', { class: 'text-input', value: u.first_name || '' });
    const lname = h('input', { class: 'text-input', value: u.last_name || '' });
    const dname = h('input', { class: 'text-input', value: u.display_name || '' });
    const emailInp = h('input', { class: 'text-input', type: 'email', value: u.email || '', autocapitalize: 'none', spellcheck: 'false' });
    const role = roleSelect(u.role);
    const body = h('div', { class: 'form-grid' }, [
      field(T.username, h('input', { class: 'text-input', value: u.username, disabled: true })),
      field(T.first_name, fname),
      field(T.last_name, lname),
      field(T.display_name, dname),
      field(T.email, emailInp),
      field(T.role, role, { hint: 'Trip leaders should be given the Admin role so they can access and modify patient files.' })
    ]);
    const val = await modal({
      title: T.edit + ' — ' + u.username, body,
      actions: [{ label: T.cancel, value: false }, { label: T.save, value: true, primary: true }]
    });
    if (!val) return;
    const res = await window.api.users.update(u.id, { first_name: fname.value.trim(), last_name: lname.value.trim(), display_name: dname.value.trim(), email: emailInp.value.trim(), role: role.value });
    if (!res.ok) { toast(errText(res.error), 'error'); return; }
    toast(T.account_updated, 'success');
    load();
  }

  async function changePassword(u) {
    const p1 = passwordField('');
    const p2 = passwordField('');
    const body = h('div', {}, [
      h('div', { class: 'muted', text: u.username }),
      field(T.new_password, p1.node, { required: true }),
      field(T.confirm_password, p2.node, { required: true })
    ]);
    const val = await modal({
      title: T.change_password, body,
      actions: [{ label: T.cancel, value: false }, { label: T.save, value: true, primary: true }]
    });
    if (!val) return;
    if (p1.get() !== p2.get()) { toast(T.passwords_no_match, 'error'); return; }
    const res = await window.api.users.changePassword(u.id, p1.get());
    if (!res.ok) { toast(errText(res.error), 'error'); return; }
    toast(T.password_changed, 'success');
    load();
  }

  async function toggleActive(u) {
    const res = await window.api.users.update(u.id, { active: !u.active });
    if (!res.ok) { toast(errText(res.error), 'error'); return; }
    toast(T.account_updated, 'success');
    load();
  }

  async function removeAccount(u) {
    const okToDelete = await confirmDialog(T.delete + ' — ' + u.username, T.confirm_delete_account, { danger: true });
    if (!okToDelete) return;
    const res = await window.api.users.remove(u.id);
    if (!res.ok) { toast(errText(res.error), 'error'); return; }
    toast(T.account_deleted, 'success');
    load();
  }

  load();
}
