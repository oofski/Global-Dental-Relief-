/* Station login (spec 3.1) — pick a role, enter PIN. */
import { h, mount, toast } from '../util.js';
import { T } from '../i18n/es.js';

const ROLES = [
  { key: 'check_in', label: T.role_check_in, icon: '📝' },
  { key: 'dentist', label: T.role_dentist, icon: '🦷' },
  { key: 'cleaning', label: T.role_cleaning, icon: '🪥' },
  { key: 'fluoride', label: T.role_fluoride, icon: '💧' },
  { key: 'checkout', label: T.role_checkout, icon: '✅' }
];

export function renderLogin({ config, onLogin }) {
  const wrap = h('div', { class: 'login-wrap' });
  let selected = null;

  const pinInput = h('input', {
    class: 'pin-input', type: 'password', inputmode: 'numeric',
    autocomplete: 'off', placeholder: '••••', maxlength: '12'
  });

  async function attempt() {
    if (!selected) { toast(T.login_subtitle, 'warn'); return; }
    const res = await window.api.auth.login(selected, pinInput.value);
    if (res && res.ok) onLogin(res.role, res.access);
    else { toast(T.bad_pin, 'error'); pinInput.value = ''; pinInput.focus(); }
  }

  pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });

  const roleGrid = h('div', { class: 'role-grid' }, ROLES.map((r) =>
    h('button', {
      class: 'role-tile', type: 'button',
      onClick: (e) => {
        selected = r.key;
        [...roleGrid.children].forEach((c) => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        pinInput.focus();
      }
    }, [
      h('span', { class: 'role-icon', text: r.icon }),
      h('span', { class: 'role-name', text: r.label })
    ])
  ));

  mount(wrap,
    h('div', { class: 'login-card' }, [
      h('img', { class: 'login-logo', src: '../../assets/icon.png', alt: '' }),
      h('h1', { class: 'login-title', text: config.clinic_name || T.app_title }),
      h('div', { class: 'login-sub', text: T.by }),
      h('h2', { class: 'login-h2', text: T.login_title }),
      h('div', { class: 'login-hint', text: T.login_subtitle }),
      roleGrid,
      h('div', { class: 'pin-row' }, [
        h('label', { class: 'field-label', text: T.pin }),
        pinInput,
        h('button', { class: 'btn btn-primary', onClick: attempt }, T.enter)
      ])
    ])
  );
  return wrap;
}
