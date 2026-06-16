/* App bootstrap, login, and role-based routing. */
import { h, mount, toast, confirmDialog } from './util.js';
import { T } from './i18n/index.js';

import { renderLogin } from './views/login.js';
import { renderCheckin } from './views/checkin.js';
import { renderDentist } from './views/dentist.js';
import { renderCleaning } from './views/cleaning.js';
import { renderFluoride } from './views/fluoride.js';
import { renderCheckout } from './views/checkout.js';

const ROLE_LABELS = {
  admin: T.role_admin,
  check_in: T.role_check_in,
  dentist: T.role_dentist,
  cleaning: T.role_cleaning,
  fluoride: T.role_fluoride,
  checkout: T.role_checkout
};

// admin reuses the checkout view (process + reports + NV) plus the Accounts tab.
const VIEWS = {
  check_in: renderCheckin,
  dentist: renderDentist,
  cleaning: renderCleaning,
  fluoride: renderFluoride,
  checkout: renderCheckout,
  admin: renderCheckout
};

const state = {
  auth: null,                 // { role, access, display_name, manage_users, reports, station, id }
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
  state.auth = null;
  document.body.classList.remove('logged-in');
  mount(root(), renderLogin({
    config: state.config,
    onLogin: (user) => { state.auth = user; showStation(); }
  }));
}

async function doLogout() {
  const okToGo = await confirmDialog(T.logout, T.confirm_logout);
  if (!okToGo) return;
  try { await window.api.auth.logout(); } catch (_) {}
  showLogin();
}

function header() {
  const a = state.auth || {};
  return h('header', { class: 'app-header' }, [
    h('div', { class: 'brand' }, [
      h('img', { class: 'brand-logo', src: '../../assets/icon.png', alt: '' }),
      h('div', {}, [
        h('div', { class: 'brand-title', text: state.config.clinic_name || T.app_title }),
        h('div', { class: 'brand-sub', text: T.by })
      ])
    ]),
    h('div', { class: 'header-right' }, [
      h('div', { class: 'user-chip' }, [
        h('span', { class: 'user-name', text: a.display_name || a.username || '' }),
        h('span', { class: 'role-chip', text: ROLE_LABELS[a.role] || a.role || '' })
      ]),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: doLogout }, '⎋ ' + T.logout)
    ])
  ]);
}

function showStation() {
  document.body.classList.add('logged-in');
  const main = h('main', { class: 'app-main' });
  mount(root(), header(), main);
  const a = state.auth || {};
  const view = VIEWS[a.role];
  const ctx = {
    role: a.role,
    access: a.access,
    manage_users: !!a.manage_users,
    reports: !!a.reports,
    display_name: a.display_name,
    user_id: a.id,
    config: state.config,
    appInfo: state.appInfo,
    toast,
    logout: showLogin
  };
  if (view) view(main, ctx);
  else mount(main, h('div', { class: 'card', text: T.station_locked }));
}

window.addEventListener('DOMContentLoaded', boot);
