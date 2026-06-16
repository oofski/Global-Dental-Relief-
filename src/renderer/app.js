/* App bootstrap, station login, and role-based routing. */
import { h, mount, clear, toast, confirmDialog } from './util.js';
import { T } from './i18n/index.js';

import { renderLogin } from './views/login.js';
import { renderCheckin } from './views/checkin.js';
import { renderDentist } from './views/dentist.js';
import { renderCleaning } from './views/cleaning.js';
import { renderFluoride } from './views/fluoride.js';
import { renderCheckout } from './views/checkout.js';

const ROLE_TITLES = {
  check_in: T.role_check_in,
  dentist: T.role_dentist,
  cleaning: T.role_cleaning,
  fluoride: T.role_fluoride,
  checkout: T.role_checkout
};

const VIEWS = {
  check_in: renderCheckin,
  dentist: renderDentist,
  cleaning: renderCleaning,
  fluoride: renderFluoride,
  checkout: renderCheckout
};

const state = {
  role: null,
  access: null,
  config: { clinic_name: T.app_title },
  appInfo: null
};

const root = () => document.getElementById('app');

async function boot() {
  try {
    const cfg = await window.api.config.get();
    if (cfg) state.config = cfg;
    const info = await window.api.app.info();
    if (info && info.ok) state.appInfo = info.data;
  } catch (e) { /* defaults */ }
  showLogin();
}

function showLogin() {
  state.role = null;
  state.access = null;
  document.body.classList.remove('logged-in');
  mount(root(), renderLogin({
    config: state.config,
    onLogin: (role, access) => { state.role = role; state.access = access; showStation(); }
  }));
}

function header() {
  return h('header', { class: 'app-header' }, [
    h('div', { class: 'brand' }, [
      h('img', { class: 'brand-logo', src: '../../assets/icon.png', alt: '' }),
      h('div', {}, [
        h('div', { class: 'brand-title', text: state.config.clinic_name || T.app_title }),
        h('div', { class: 'brand-sub', text: T.by })
      ])
    ]),
    h('div', { class: 'header-right' }, [
      h('span', { class: 'role-chip', text: `${T.station}: ${ROLE_TITLES[state.role] || state.role}` }),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: async () => {
          const ok = await confirmDialog(T.logout, T.confirm_logout);
          if (ok) showLogin();
        }
      }, '⎋ ' + T.logout)
    ])
  ]);
}

function showStation() {
  document.body.classList.add('logged-in');
  const main = h('main', { class: 'app-main' });
  mount(root(), header(), main);
  const view = VIEWS[state.role];
  const ctx = {
    role: state.role,
    access: state.access,
    config: state.config,
    appInfo: state.appInfo,
    toast,
    logout: showLogin
  };
  if (view) view(main, ctx);
  else mount(main, h('div', { class: 'card', text: T.station_locked }));
}

window.addEventListener('DOMContentLoaded', boot);
