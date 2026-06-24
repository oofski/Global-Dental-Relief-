'use strict';
const fs = require('fs');
const crypto = require('crypto');
const paths = require('./paths');
const model = require('../shared/model');

/*
 * User accounts (username + password login, replacing station PINs).
 *
 * Accounts are stored in users.json in the app's protected userData dir.
 * Passwords are salted + hashed with scrypt — never stored in plain text.
 * An admin account can create/edit accounts and change passwords (admin portal).
 *
 * Default password for every seeded account: welcome123
 */

const DEFAULT_PASSWORD = 'welcome123';

// Account roles. `station` = which clinical screen the account operates.
// `manage_users` = access to the admin portal. `reports` = reports + NV access.
const ROLES = {
  admin:    { key: 'admin',    station: 'admin',    manage_users: true,  reports: true,  access: 'admin' },
  checkout: { key: 'checkout', station: 'checkout', manage_users: false, reports: true,  access: 'admin' },
  check_in: { key: 'check_in', station: 'check_in', manage_users: false, reports: false, access: 'station' },
  dentist:  { key: 'dentist',  station: 'dentist',  manage_users: false, reports: false, access: 'station' },
  cleaning: { key: 'cleaning', station: 'cleaning', manage_users: false, reports: false, access: 'station' },
  fluoride: { key: 'fluoride', station: 'fluoride', manage_users: false, reports: false, access: 'station' }
};

// Seeded on first run — one account per role, password welcome123.
const DEFAULT_ACCOUNTS = [
  { username: 'admin',     role: 'admin',    display_name: 'Administrator' },
  { username: 'frontdesk', role: 'check_in', display_name: 'Front Desk' },
  { username: 'doctor',    role: 'dentist',  display_name: 'Doctor' },
  { username: 'hygienist', role: 'cleaning', display_name: 'Hygienist' },
  { username: 'fluoride',  role: 'fluoride', display_name: 'Fluoride Station' },
  { username: 'checkout',  role: 'checkout', display_name: 'Checkout' }
];

let store = null;

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { algo: 'scrypt', salt: s, hash };
}

function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const h = crypto.scryptSync(String(password), rec.salt, 64).toString('hex');
  // constant-time compare
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(rec.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function blank() {
  return { schema_version: 1, created_at: model.nowISO(), users: [] };
}

function load() {
  if (store) return store;
  const file = paths.usersFile();
  try {
    if (fs.existsSync(file)) {
      store = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(store.users)) store.users = [];
    } else {
      store = blank();
      seedDefaults();
    }
  } catch (e) {
    store = blank();
    seedDefaults();
  }
  // Always ensure at least one admin exists (self-heal).
  if (!store.users.some((u) => u.role === 'admin' && u.active !== false)) {
    seedDefaults();
  }
  return store;
}

function persist() {
  const dir = paths.master(); // userData/master sibling; ensure base dir exists
  paths.ensure(paths.base());
  const file = paths.usersFile();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function seedDefaults() {
  for (const acc of DEFAULT_ACCOUNTS) {
    if (store.users.some((u) => u.username.toLowerCase() === acc.username.toLowerCase())) continue;
    store.users.push(makeUser(acc.username, DEFAULT_PASSWORD, acc.role, acc.display_name));
  }
  persist();
}

function makeUser(username, password, role, displayName, email, firstName, lastName) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  const display = String(displayName || '').trim() || `${first} ${last}`.trim() || username;
  return {
    id: model.uuid(),
    username: String(username).trim(),
    first_name: first,
    last_name: last,
    display_name: display,
    email: email || '',
    role,
    password: hashPassword(password),
    active: true,
    must_change_password: false,
    created_at: model.nowISO(),
    updated_at: model.nowISO()
  };
}

function publicUser(u) {
  if (!u) return null;
  const r = ROLES[u.role] || {};
  const first = u.first_name || '';
  const last = u.last_name || '';
  const display = u.display_name || `${first} ${last}`.trim() || u.username;
  return {
    id: u.id,
    username: u.username,
    first_name: first,
    last_name: last,
    display_name: display,
    email: u.email || '',
    role: u.role,
    active: u.active !== false,
    must_change_password: !!u.must_change_password,
    access: r.access || 'station',
    station: r.station || u.role,
    manage_users: !!r.manage_users,
    reports: !!r.reports,
    created_at: u.created_at
  };
}

function findByUsername(username) {
  const q = String(username || '').trim().toLowerCase();
  return load().users.find((u) => u.username.toLowerCase() === q) || null;
}

// ---- Public API ---------------------------------------------------------
function authenticate(username, password) {
  const u = findByUsername(username);
  if (!u || u.active === false) return { ok: false };
  if (!verifyPassword(password, u.password)) return { ok: false };
  return { ok: true, user: publicUser(u) };
}

function list() {
  return load().users
    .slice()
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(publicUser);
}

function roles() {
  return Object.values(ROLES).map((r) => ({ key: r.key, manage_users: r.manage_users, reports: r.reports }));
}

function validRole(role) { return !!ROLES[role]; }

function create({ username, password, role, display_name, email, first_name, last_name }) {
  load();
  const uname = String(username || '').trim();
  if (!uname) return { ok: false, error: 'username_required' };
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(uname)) return { ok: false, error: 'username_invalid' };
  if (findByUsername(uname)) return { ok: false, error: 'username_taken' };
  if (!validRole(role)) return { ok: false, error: 'role_invalid' };
  const pw = String(password || '');
  if (pw.length < 6) return { ok: false, error: 'password_too_short' };
  const u = makeUser(uname, pw, role, display_name, email, first_name, last_name);
  store.users.push(u);
  persist();
  return { ok: true, user: publicUser(u) };
}

function update(id, changes) {
  load();
  const u = store.users.find((x) => x.id === id);
  if (!u) return { ok: false, error: 'not_found' };
  if (changes.first_name != null) u.first_name = String(changes.first_name).trim();
  if (changes.last_name != null) u.last_name = String(changes.last_name).trim();
  if (changes.display_name != null) u.display_name = String(changes.display_name).trim();
  // Keep display_name coherent: if blank, derive from first/last, else keep username.
  if (!u.display_name) u.display_name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username;
  if (changes.email != null) u.email = String(changes.email).trim();
  if (changes.role != null) {
    if (!validRole(changes.role)) return { ok: false, error: 'role_invalid' };
    // Don't allow demoting the last active admin.
    if (u.role === 'admin' && changes.role !== 'admin' && lastAdmin(u.id)) return { ok: false, error: 'last_admin' };
    u.role = changes.role;
  }
  if (changes.active != null) {
    if (u.role === 'admin' && changes.active === false && lastAdmin(u.id)) return { ok: false, error: 'last_admin' };
    u.active = !!changes.active;
  }
  u.updated_at = model.nowISO();
  persist();
  return { ok: true, user: publicUser(u) };
}

function changePassword(id, newPassword) {
  load();
  const u = store.users.find((x) => x.id === id);
  if (!u) return { ok: false, error: 'not_found' };
  const pw = String(newPassword || '');
  if (pw.length < 6) return { ok: false, error: 'password_too_short' };
  u.password = hashPassword(pw);
  u.must_change_password = false;
  u.updated_at = model.nowISO();
  persist();
  return { ok: true };
}

function remove(id) {
  load();
  const u = store.users.find((x) => x.id === id);
  if (!u) return { ok: false, error: 'not_found' };
  if (u.role === 'admin' && lastAdmin(u.id)) return { ok: false, error: 'last_admin' };
  store.users = store.users.filter((x) => x.id !== id);
  persist();
  return { ok: true };
}

function lastAdmin(excludeId) {
  const admins = load().users.filter((u) => u.role === 'admin' && u.active !== false && u.id !== excludeId);
  return admins.length === 0;
}

function _reset() { store = blank(); seedDefaults(); }

module.exports = {
  ROLES,
  DEFAULT_PASSWORD,
  authenticate,
  list,
  roles,
  create,
  update,
  changePassword,
  remove,
  publicUser,
  _reset
};
