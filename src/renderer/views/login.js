/* Username + password login (replaces station PINs). */
import { h, mount, toast } from '../util.js';
import { T } from '../i18n/index.js';

export function renderLogin({ config, onLogin }) {
  const wrap = h('div', { class: 'login-wrap' });

  const userInput = h('input', {
    class: 'text-input login-input', type: 'text', autocomplete: 'username',
    placeholder: T.username, autocapitalize: 'none', spellcheck: 'false'
  });
  const passInput = h('input', {
    class: 'text-input login-input', type: 'password', autocomplete: 'current-password',
    placeholder: T.password
  });

  // Show / hide password toggle.
  let shown = false;
  const toggleBtn = h('button', { class: 'pw-toggle', type: 'button' }, T.show);
  toggleBtn.addEventListener('click', () => {
    shown = !shown;
    passInput.type = shown ? 'text' : 'password';
    toggleBtn.textContent = shown ? T.hide : T.show;
    passInput.focus();
  });

  const errorEl = h('div', { class: 'login-error' });

  async function attempt() {
    errorEl.textContent = '';
    const username = userInput.value.trim();
    const password = passInput.value;
    if (!username || !password) { errorEl.textContent = T.bad_credentials; return; }
    const res = await window.api.auth.login(username, password);
    if (res && res.ok && res.user) {
      onLogin(res.user);
    } else {
      errorEl.textContent = T.bad_credentials;
      passInput.value = '';
      passInput.focus();
    }
  }

  userInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') passInput.focus(); });
  passInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });

  mount(wrap,
    h('div', { class: 'login-card' }, [
      h('img', { class: 'login-lockup', src: '../../assets/logo-block.png', alt: 'Global Dental Relief' }),
      h('h1', { class: 'login-title', text: config.clinic_name || T.app_title }),
      h('div', { class: 'login-sub', text: T.by }),
      h('h2', { class: 'login-h2', text: T.login_welcome }),
      h('div', { class: 'field login-field' }, [
        h('label', { class: 'field-label', text: T.username }),
        userInput
      ]),
      h('div', { class: 'field login-field' }, [
        h('label', { class: 'field-label', text: T.password }),
        h('div', { class: 'pw-row' }, [passInput, toggleBtn])
      ]),
      errorEl,
      h('button', { class: 'btn btn-primary btn-lg login-btn', onClick: attempt }, T.sign_in),
      h('div', { class: 'login-foot' }, [
        h('div', { text: 'Mexico Clinic — Global Dental Relief' }),
        h('div', { text: T.copyright })
      ])
    ])
  );

  setTimeout(() => userInput.focus(), 50);
  return wrap;
}
