'use strict';
/*
 * WEB TEST BUILD — proof harness (TEST-ONLY).
 *
 * Proves the browser-hosted copy of the app (src/server + src/web) is the same
 * application as the desktop build and is safe to put on the internet:
 *
 *   A. PARITY  — the browser shim exposes exactly the window.api the desktop
 *                preload exposes (same keys, same types, same IPC channels), and
 *                every channel has a handler. Fails if either side drifts.
 *   B. SERVER  — site password required, refuses to boot without one, only UI
 *                files served, no traversal, forged drive paths refused, CSRF-
 *                style form posts refused, downloads confined to exports.
 *   C. BROWSER — a full clinic visit in real Chromium against a live server:
 *                front desk registers a child (permission slip: cleaning only)
 *                onto virtual drive 5 -> dentist (consent warning fires) ->
 *                hygienist -> checkout uploads + clears the drive -> admin
 *                exports a report (download) and imports a master DB (upload).
 *                Plus: two testers logged in as different roles at once keep
 *                independent sessions; brand font loads; no page errors.
 *
 * Run:  node scripts/web-test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const results = [];
function record(id, name, passed, evidence) {
  results.push({ id, name, passed: !!passed });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  [${id}] ${name}`);
  if (evidence) console.log(`        evidence: ${evidence}`);
}

// ---------------------------------------------------------------------------
// A. Parity between the desktop bridge and the browser shim
// ---------------------------------------------------------------------------
function shapeOf(obj, prefix = '') {
  const out = [];
  for (const k of Object.keys(obj).sort()) {
    const v = obj[k];
    const p = prefix ? prefix + '.' + k : k;
    if (k === 'bootConfig') { out.push(p + ':config'); continue; } // value differs by host by design
    if (typeof v === 'function') out.push(p + ':fn');
    else if (Array.isArray(v)) out.push(p + ':array');
    else if (v && typeof v === 'object') out.push(...shapeOf(v, p));
    else out.push(p + ':' + typeof v);
  }
  return out;
}

function loadPreloadApi() {
  const exposed = {};
  const fakeElectron = {
    contextBridge: { exposeInMainWorld: (k, v) => { exposed[k] = v; } },
    ipcRenderer: { invoke() {}, sendSync() { return {}; }, on() {}, removeListener() {} }
  };
  const src = fs.readFileSync(path.join(ROOT, 'src/main/preload.js'), 'utf8');
  const req = (m) => (m === 'electron' ? fakeElectron : require(path.join(ROOT, 'src/main', m)));
  vm.runInNewContext(src, { require: req, module: {}, console });
  return exposed.api;
}

function loadShimApi() {
  const win = {
    __GDR_SHARED__: { codes: require(path.join(ROOT, 'src/shared/codes')), model: require(path.join(ROOT, 'src/shared/model')) },
    location: { reload() {} }
  };
  const doc = { readyState: 'complete', addEventListener() {}, createElement: () => ({ style: {}, setAttribute() {} }), body: { appendChild() {}, style: {} } };
  const src = fs.readFileSync(path.join(ROOT, 'src/web/shim.js'), 'utf8');
  vm.runInNewContext(src, { window: win, document: doc, fetch: () => Promise.resolve(), JSON, Promise, console });
  return win.api;
}

function partA() {
  console.log('=== A. Desktop bridge <-> browser shim parity ===');
  const pre = loadPreloadApi();
  const shim = loadShimApi();
  const a = shapeOf(pre); const b = shapeOf(shim);
  const onlyPre = a.filter((x) => !b.includes(x));
  const onlyShim = b.filter((x) => !a.includes(x));
  record('A1', 'browser shim exposes exactly the desktop window.api (keys + types)',
    onlyPre.length === 0 && onlyShim.length === 0,
    `${a.length} members; desktop-only=${JSON.stringify(onlyPre)} shim-only=${JSON.stringify(onlyShim)}`);

  const chans = (file) => [...fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/invoke\('([^']+)'/g)].map((m) => m[1]).sort();
  const pc = [...new Set(chans('src/main/preload.js'))];
  const sc = [...new Set(chans('src/web/shim.js'))];
  // Deliberate, documented exceptions: calls the browser answers itself.
  //   shell:openPath — "open folder" on the desktop; the browser re-downloads.
  const BROWSER_LOCAL = ['shell:openPath'];
  const expected = pc.filter((c) => !BROWSER_LOCAL.includes(c));
  record('A2', 'shim calls the same IPC channels as the desktop preload (minus declared browser-local ones)',
    JSON.stringify(expected) === JSON.stringify(sc),
    `desktop=${pc.length} shim=${sc.length} browser-local=${JSON.stringify(BROWSER_LOCAL)} missing=${JSON.stringify(expected.filter((c) => !sc.includes(c)))} extra=${JSON.stringify(sc.filter((c) => !expected.includes(c)))}`);

  const handlers = Object.keys(require(path.join(ROOT, 'src/main/api')).createHandlers({ resolveDrive: () => null, updater: {} }));
  const missing = pc.filter((c) => !handlers.includes(c));
  record('A3', 'every channel the UI calls has a shared handler (desktop + web use one table)',
    missing.length === 0, `handlers=${handlers.length} missing=${JSON.stringify(missing)}`);
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------
const PASS = 'web-test-pw-' + Date.now();
const AUTH = 'Basic ' + Buffer.from('gdr:' + PASS).toString('base64');

function stopServer(srv) {
  return new Promise((resolve) => {
    if (srv.child.exitCode !== null) return resolve();
    srv.child.once('exit', () => resolve());
    srv.child.kill('SIGTERM');
    setTimeout(() => { try { srv.child.kill('SIGKILL'); } catch (_) {} resolve(); }, 12000);
  });
}

function startServer(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/server/server.js'], { cwd: ROOT, env: Object.assign({}, process.env, env) });
    let out = '';
    const onData = (d) => {
      out += d;
      const m = out.match(/listening on :(\d+)/);
      if (m) resolve({ child, port: Number(m[1]), log: () => out });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(Object.assign(new Error('server exited ' + code), { code, out })));
    setTimeout(() => reject(new Error('server did not start: ' + out)), 15000);
  });
}

async function req(port, pathname, { method = 'GET', headers = {}, body, auth = true } = {}) {
  const h = Object.assign({}, headers);
  if (auth) h.Authorization = AUTH;
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: h, body, redirect: 'manual' });
  return { status: res.status, text: await res.text(), headers: res.headers };
}
const call = (port, channel, p) => req(port, '/api/' + channel, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p })
});

// A tester's browser over raw HTTP: keeps its session cookie, optionally signed
// in as a station. Lets the role checks be tested exactly as a browser hits them.
async function asStation(port, user) {
  let cookie = '';
  const headers = (extra) => Object.assign({ Authorization: AUTH }, cookie ? { Cookie: cookie } : {}, extra || {});
  const callAs = async (channel, p) => {
    const res = await fetch(`http://127.0.0.1:${port}/api/${channel}`, {
      method: 'POST', redirect: 'manual', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ p })
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let r = null; try { r = JSON.parse(text).r; } catch (_) {}
    return { status: res.status, text, r };
  };
  const download = async (name) => {
    const res = await fetch(`http://127.0.0.1:${port}/web/download?f=${encodeURIComponent(name)}`, { headers: headers() });
    return { status: res.status, text: await res.text() };
  };
  if (user) {
    const li = await callAs('auth:login', { username: user, password: 'welcome123' });
    if (!li.r || !li.r.ok) throw new Error('sign-in failed for ' + user);
  } else {
    await callAs('config:get'); // obtain a session cookie without signing in
  }
  return { call: callAs, download };
}
const err = (res) => (res.r && res.r.error) || (res.r && res.r.ok ? 'ok' : 'status_' + res.status);

// ---------------------------------------------------------------------------
// B. Server security
// ---------------------------------------------------------------------------
async function partB() {
  console.log('\n=== B. Server security ===');
  // Refuses to boot without a site password.
  const noPw = await new Promise((resolve) => {
    const env = Object.assign({}, process.env, { GDR_WEB_PASSWORD: '', GDR_WEB_INSECURE_NO_AUTH: '', PORT: '0',
      GDR_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gdr-webtest-nopw-')) });
    const c = spawn(process.execPath, ['src/server/server.js'], { cwd: ROOT, env });
    let out = ''; c.stderr.on('data', (d) => { out += d; });
    c.on('exit', (code) => resolve({ code, out }));
    setTimeout(() => { c.kill(); resolve({ code: 'still running', out }); }, 8000);
  });
  record('B1', 'server refuses to start without GDR_WEB_PASSWORD', noPw.code === 1, `exit=${noPw.code}`);

  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gdr-webtest-b-'));
  const srv = await startServer({ GDR_WEB_PASSWORD: PASS, GDR_DATA_DIR: data, PORT: '0', GDR_SEED_DEMO: '1' });
  const P = srv.port;
  try {
    record('B2', 'health check is reachable without the password (for the host)', (await req(P, '/healthz', { auth: false })).status === 200);
    record('B3', 'everything else requires the site password',
      (await req(P, '/', { auth: false })).status === 401 && (await req(P, '/src/renderer/index.html', { auth: false })).status === 401
      && (await call(P, 'db:count').then(() => req(P, '/api/db:count', { method: 'POST', auth: false, headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status === 401);
    const wrong = await fetch(`http://127.0.0.1:${P}/`, { headers: { Authorization: 'Basic ' + Buffer.from('gdr:nope').toString('base64') } });
    record('B4', 'a wrong password is refused', wrong.status === 401);

    const leaks = ['/src/main/main.js', '/src/main/api.js', '/package.json', '/src/renderer/%2e%2e/main/main.js',
      '/assets/..%2fsrc%2fmain%2fmain.js', '/src/server/server.js'];
    const leakStatus = [];
    for (const u of leaks) leakStatus.push((await req(P, u)).status);
    record('B5', 'server source / config / traversal paths are not served', leakStatus.every((s) => s === 404 || s === 400),
      leaks.map((u, i) => `${u}=${leakStatus[i]}`).join(' '));

    // Signed in as roles that MAY read/write/clear drives, so a refusal here
    // comes from the drive-path check itself, not from the role or login gate.
    const fd = await asStation(P, 'frontdesk');
    const co = await asStation(P, 'checkout');
    const goodRead = err(await fd.call('drive:read', 'vdrive:1'));
    const evil = [];
    for (const ref of ['/etc', '../master', 'vdrive:0', 'vdrive:99', 'vdrive:1/../../master', { a: 1 }]) {
      evil.push(err(await fd.call('drive:read', ref)));
    }
    const clr = err(await co.call('drive:clear', path.join(data, 'master')));
    const wr = err(await fd.call('drive:write', { drivePath: path.join(data, 'master'), patient: { patient_number: 1 } }));
    record('B6', 'drive access is limited to the virtual drives (forged paths refused, even for permitted roles)',
      goodRead === 'ok' && evil.every((e) => e === 'forbidden') && clr === 'forbidden' && wr === 'forbidden',
      `vdrive:1=${goodRead} forged=${JSON.stringify(evil)} clear=${clr} write=${wr}`);

    const form = await req(P, '/api/auth:logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'p=1' });
    const xorigin = await req(P, '/api/db:count', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    record('B7', 'cross-site style requests refused (non-JSON form post, foreign Origin)',
      form.status === 415 && xorigin.status === 403, `form=${form.status} foreignOrigin=${xorigin.status}`);

    const dl = [];
    for (const f of ['../master/master_db.json', '..%2Fmaster%2Fmaster_db.json', '.hidden', '']) {
      dl.push((await req(P, '/web/download?f=' + f)).status);
    }
    record('B8', 'downloads confined to the exports folder', dl.every((s) => s === 400 || s === 404), JSON.stringify(dl));

    const proto = JSON.parse((await call(P, '__proto__')).text).r.error;
    const ctor = (await call(P, 'constructor')).status;
    record('B9', 'unknown / prototype channel names are refused', proto === 'unknown_channel' && ctor === 404, `__proto__=${proto} constructor=${ctor}`);

    const info = await fd.call('app:info');
    const st = await fd.call('shell:exportsDir');
    const rd = await fd.call('drive:read', 'vdrive:1');
    record('B10', 'server folder paths never appear in replies',
      st.r && st.r.ok && rd.r && rd.r.ok && ![info, st, rd].some((x) => x.text.includes(data)),
      `exportsDir=${st.r && st.r.data} driveFile=${rd.r && rd.r.file}`);

    const head = await req(P, '/src/renderer/index.html');
    record('B11', 'pages are kept out of search engines', head.headers.get('x-robots-tag') === 'noindex, nofollow');

    // B12 — the site password alone is not enough: patient data needs a station sign-in.
    const anon = await asStation(P, null);
    const anonTries = [['db:search', ''], ['db:getPatient', 'x'], ['db:count'], ['db:listNV'], ['drive:list'],
      ['drive:read', 'vdrive:1'], ['drive:write', { drivePath: 'vdrive:3', patient: {} }], ['drive:clear', 'vdrive:1'],
      ['report:stats', {}], ['db:savePatient', { id: 'x' }], ['db:createPatient', { first_name: 'x' }]];
    const anonRes = [];
    for (const [c, p] of anonTries) anonRes.push(err(await anon.call(c, p)));
    record('B12', 'without a station sign-in, no patient or drive request is answered',
      anonRes.every((e) => e === 'forbidden'), anonTries.map((t, i) => `${t[0]}=${anonRes[i]}`).join(' '));

    // B13 — a station can do only what its own screens do.
    const doc = await asStation(P, 'doctor');
    const docRead = err(await doc.call('drive:read', 'vdrive:1'));
    const docDenied = [['db:search', ''], ['db:getPatient', 'x'], ['db:createPatient', { first_name: 'x' }],
      ['db:savePatient', { id: 'x' }], ['db:uploadPatient', { id: 'x' }], ['drive:clear', 'vdrive:1'],
      ['report:stats', {}], ['db:count'], ['report:exportMaster', { format: 'json' }]];
    const docRes = [];
    for (const [c, p] of docDenied) docRes.push(err(await doc.call(c, p)));
    record('B13', 'role separation: the dentist reads drives but cannot touch the ledger, uploads, drive clearing or reports',
      docRead === 'ok' && docRes.every((e) => e === 'forbidden'), `read=${docRead} ` + docDenied.map((t, i) => `${t[0]}=${docRes[i]}`).join(' '));

    const coWrite = err(await co.call('drive:write', { drivePath: 'vdrive:3', patient: { patient_number: 5 } }));
    const coClear = err(await co.call('drive:clear', 'vdrive:3'));
    record('B14', 'role separation: checkout clears drives but cannot write to them', coWrite === 'forbidden' && coClear === 'ok',
      `write=${coWrite} clear=${coClear}`);

    // B15 — an export can be downloaded only by the browser that made it.
    const adminA = await asStation(P, 'admin');
    const adminB = await asStation(P, 'admin');
    const ex = await adminA.call('report:exportMaster', { format: 'json' });
    const exName = ex.r && ex.r.ok ? String(ex.r.data.file).split('/').pop() : '';
    const own = await adminA.download(exName);
    const other = await adminB.download(exName);
    const anonDl = await (await asStation(P, null)).download(exName);
    record('B15', 'exports download only to the browser that made them (others get 404, even another admin)',
      !!exName && own.status === 200 && /"patients"/.test(own.text) && other.status === 404 && anonDl.status === 404,
      `${exName}: maker=${own.status} otherAdmin=${other.status} signedOut=${anonDl.status}`);

    // B17 — wrong site passwords are answered slowly; the right one is not.
    let t0 = Date.now();
    await fetch(`http://127.0.0.1:${P}/src/renderer/index.html`, { headers: { Authorization: 'Basic ' + Buffer.from('gdr:wrong-guess').toString('base64') } });
    const slow = Date.now() - t0;
    t0 = Date.now();
    await req(P, '/src/renderer/index.html');
    const fast = Date.now() - t0;
    record('B17', 'each wrong site-password guess is delayed (~1 s); the right password is not', slow >= 900 && fast < 500,
      `wrong=${slow}ms right=${fast}ms`);

    // B18 — only the master-DB import may send a large body.
    const big = JSON.stringify({ p: 'x'.repeat(6 * 1024 * 1024) });
    const post = async (channel, cookieFrom) => {
      try {
        const r = await fetch(`http://127.0.0.1:${P}/api/${channel}`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: big });
        await r.text();
        return r.status;
      } catch (_) { return 'connection-closed'; }
    };
    const smallChan = await post('drive:read');
    const importChan = await post('db:importMaster');
    record('B18', '6 MB request refused on ordinary channels, accepted for the master-DB import',
      (smallChan === 413 || smallChan === 'connection-closed') && importChan === 200, `drive:read=${smallChan} db:importMaster=${importChan}`);
  } finally { await stopServer(srv); }

  // B16 — too-short site password refused at boot.
  const shortPw = await new Promise((resolve) => {
    const env = Object.assign({}, process.env, { GDR_WEB_PASSWORD: 'short-pw', GDR_WEB_INSECURE_NO_AUTH: '', PORT: '0',
      GDR_DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gdr-webtest-short-')) });
    const c = spawn(process.execPath, ['src/server/server.js'], { cwd: ROOT, env });
    let out = ''; c.stderr.on('data', (d) => { out += d; });
    c.on('exit', (code) => resolve({ code, out }));
    setTimeout(() => { c.kill(); resolve({ code: 'still running', out }); }, 8000);
  });
  record('B16', 'server refuses a site password shorter than 12 characters', shortPw.code === 1 && /at least 12/.test(shortPw.out),
    `exit=${shortPw.code}`);
}

// ---------------------------------------------------------------------------
// C. Real browser, full clinic visit
// ---------------------------------------------------------------------------
async function partC() {
  console.log('\n=== C. Full clinic visit in a real browser ===');
  const { chromium } = require('playwright');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'gdr-webtest-c-'));
  const srv = await startServer({ GDR_WEB_PASSWORD: PASS, GDR_DATA_DIR: data, PORT: '0', GDR_SEED_DEMO: '1' });
  const BASE = `http://127.0.0.1:${srv.port}`;
  const browser = await chromium.launch();
  const pageErrors = [];
  const drive5 = path.join(data, 'virtual-drives', 'drive-5');
  const readDrive = () => {
    const f = fs.readdirSync(drive5).find((x) => /^patient_\d+\.json$/.test(x));
    if (!f) return null;
    const env = JSON.parse(fs.readFileSync(path.join(drive5, f), 'utf8'));
    return env.payload || env;
  };
  const lastVisit = (p) => p.visits[p.visits.length - 1];

  // The login screen focuses the username box 50 ms after it renders. Typing
  // before that lets the focus jump land mid-password, so the password ends up
  // in the username box (observed: user="hygienistwelcome123", pass=""). No
  // person types that fast, but a script does — wait for the autofocus first.
  async function typeCredentials(page, user) {
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('login-input'));
    await page.locator('.login-input').nth(0).fill(user);
    await page.locator('.login-input').nth(1).fill('welcome123');
    await page.locator('.login-btn').click();
  }

  async function station(user, label) {
    const ctx = await browser.newContext({ httpCredentials: { username: 'gdr', password: PASS }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(`${label}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) pageErrors.push(`${label}: ${m.text()}`); });
    await page.goto(BASE + '/');
    await typeCredentials(page, user);
    try {
      await page.waitForSelector('.role-chip', { timeout: 10000 });
    } catch (e) {
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`${label} sign-in did not complete. Page shows: "${body}". Errors so far: ${JSON.stringify(pageErrors)}`);
    }
    return { ctx, page };
  }
  async function okDialog(page) {
    await page.locator('.modal-overlay .modal-actions .btn-primary').click({ timeout: 10000 });
  }
  async function loadDrive(page, n) {
    await page.locator('.drive-chip', { hasText: `Virtual drive ${n}` }).first().click();
  }
  async function ackConsent(page) {
    const modal = page.locator('.modal-box.modal-danger');
    await modal.waitFor({ timeout: 10000 });
    const chips = await modal.locator('.consent-limit-chip').allTextContents();
    await modal.locator('.modal-actions .btn').click();
    return chips;
  }

  try {
    // C1: two testers, two roles, at the same time — sessions must not collide.
    const admin = await station('admin', 'admin');
    const doctor = await station('doctor', 'doctor');
    const adminList = await admin.page.evaluate(() => window.api.users.list());
    const doctorList = await doctor.page.evaluate(() => window.api.users.list());
    record('C1', 'concurrent testers keep separate logins (admin stays admin after a doctor signs in)',
      adminList.ok === true && doctorList.ok === false && doctorList.error === 'forbidden',
      `admin users:list ok=${adminList.ok}; doctor users:list=${doctorList.error}`);

    // C2: banner + brand font over HTTP.
    const banner = await admin.page.locator('#gdr-test-env-banner').textContent();
    const faces = await admin.page.evaluate(async () => {
      for (const w of ['400', '600', '700']) { try { await document.fonts.load(w + ' 16px "Source Sans 3"'); } catch (_) {} }
      return [...document.fonts].filter((f) => /Source Sans 3/.test(f.family)).map((f) => f.status);
    });
    record('C2', 'test-environment banner shown; brand font loads in the browser',
      /TEST ENVIRONMENT/.test(banner || '') && faces.length === 3 && faces.every((s) => s === 'loaded'), `banner="${banner}" fonts=${faces}`);

    // C3: front desk registers a child onto virtual drive 5, slip = cleaning only.
    const front = await station('frontdesk', 'frontdesk');
    const fp = front.page;
    await fp.locator('.choice-btn.choice-new').click();
    await fp.locator('.text-input').nth(3).waitFor();
    await fp.locator('.text-input').nth(0).fill('Lucía');
    await fp.locator('.text-input').nth(1).fill('Prueba');
    await fp.locator('.text-input').nth(2).fill('Escuela Web');
    await fp.locator('.text-input').nth(3).fill('8');
    await fp.locator('.seg .seg-btn').first().click();
    await fp.locator('.view-foot .btn-primary').click();
    await fp.locator('.consent-perms input[type=checkbox]').first().waitFor();
    const childAuto = await fp.locator('.consent-fields .text-input').nth(0).inputValue();
    await fp.locator('.consent-perms input[type=checkbox]').nth(0).check();
    await fp.locator('.consent-inline-input').fill('Ana Prueba');
    await fp.locator('input[type=tel]').fill('555 000 1111');
    await fp.locator('.view-foot .btn-primary').click();
    await fp.locator('.view-foot .btn-primary').click(); // medical history -> next
    await fp.locator('input[type=number]').fill('5');
    await fp.locator('.drive-chip', { hasText: 'Virtual drive 5' }).click();
    await fp.locator('.view-foot .btn-primary').click();
    await fp.locator('.confirm-box').waitFor({ timeout: 10000 });
    const onDrive = readDrive();
    record('C3', 'front desk registers a patient onto virtual drive 5 with the permission slip',
      !!onDrive && onDrive.first_name === 'Lucía' && childAuto === 'Lucía Prueba'
      && JSON.stringify(onDrive.consent.permissions) === JSON.stringify({ cleaning: true, fillings: false, extractions: false })
      && onDrive.consent.phone === '555 000 1111',
      onDrive ? `#${onDrive.patient_number} perms=${JSON.stringify(onDrive.consent.permissions)} childAuto="${childAuto}"` : 'nothing on drive 5');

    // C4: dentist loads drive 5 -> consent warning for the declined care; saves.
    const dp = doctor.page;
    await loadDrive(dp, 5);
    const chipsDoc = await ackConsent(dp);
    const bannerDoc = await dp.locator('.consent-limit-banner').isVisible();
    await dp.locator('.dentist-view .seg-btn', { hasText: 'R —' }).click();
    await dp.locator('.dentist-view .seg-btn', { hasText: 'P —' }).click();
    await dp.locator('.view-foot .btn-primary').click();
    await okDialog(dp);
    const afterDoc = lastVisit(readDrive());
    record('C4', 'dentist: red consent warning names the declined care; save reaches the drive',
      JSON.stringify(chipsDoc) === JSON.stringify(['Fillings', 'Extractions']) && bannerDoc
      && afterDoc.station_status.dentist === true && afterDoc.exam_type === 'R' && afterDoc.cleaning_type === 'P',
      `chips=${JSON.stringify(chipsDoc)} banner=${bannerDoc} exam=${afterDoc.exam_type} cleaning=${afterDoc.cleaning_type}`);

    // C5: hygienist completes the cleaning.
    const hyg = await station('hygienist', 'hygienist');
    const hp = hyg.page;
    await loadDrive(hp, 5);
    await ackConsent(hp);
    await hp.locator('.cleaning-view .btn-primary.btn-lg').click();
    await hp.locator('.view-foot .btn-primary').click();
    await okDialog(hp);
    const afterHyg = lastVisit(readDrive());
    record('C5', 'hygienist: completes the cleaning and saves to the drive',
      afterHyg.cleaning_done === true && afterHyg.station_status.cleaning === true, `cleaning_done=${afterHyg.cleaning_done}`);

    // C6: checkout uploads to the master DB and clears the drive.
    const co = await station('checkout', 'checkout');
    const cp = co.page;
    await loadDrive(cp, 5);
    await cp.locator('.seg-lg .seg-btn').first().click();
    await cp.locator('.upload-card .btn-primary').click();
    await cp.locator('.btn-danger.btn-lg:not([disabled])').click({ timeout: 10000 });
    await cp.locator('.modal-actions .btn-danger').click();
    await okDialog(cp);
    const master = JSON.parse(fs.readFileSync(path.join(data, 'master', 'master_db.json'), 'utf8'));
    const mp = Object.values(master.patients).find((p) => p.first_name === 'Lucía' && p.last_name === 'Prueba');
    const mv = mp && lastVisit(mp);
    record('C6', 'checkout: visit uploaded to the master DB and the drive cleared for reuse',
      !!mv && mv.visit_outcome === 'F' && !!mv.checkout_timestamp && mv.cleaning_done === true && readDrive() === null,
      mv ? `outcome=${mv.visit_outcome} checkout=${!!mv.checkout_timestamp} driveEmpty=${readDrive() === null}` : 'not in master');

    // C7: admin exports a report -> real browser download.
    const ap = admin.page;
    await ap.locator('.tab', { hasText: 'Reports' }).click();
    await ap.locator('.preset-row .btn').filter({ hasText: /^All$/ }).click();
    const [download] = await Promise.all([
      ap.waitForEvent('download', { timeout: 15000 }),
      ap.locator('button', { hasText: 'Export CSV' }).first().click()
    ]);
    const dlFile = await download.path();
    const csv = fs.readFileSync(dlFile, 'utf8');
    record('C7', 'report export downloads to the tester\'s browser',
      /\.csv$/.test(download.suggestedFilename()) && csv.length > 50, `${download.suggestedFilename()} (${csv.length} bytes)`);

    // C8: front desk imports a master DB file through the browser file picker.
    const importFile = path.join(data, 'import-me.json');
    const model = require(path.join(ROOT, 'src/shared/model'));
    const extra = model.newPatient({ patient_number: 9001, first_name: 'Importado', last_name: 'Desde Archivo', school_group: 'Escuela Web', age_at_first_visit: 7, sex: 'F' });
    fs.writeFileSync(importFile, JSON.stringify({ patients: [extra] }));
    await fp.goto(BASE + '/');
    await typeCredentials(fp, 'frontdesk');
    await fp.locator('.db-sync-zone').waitFor();
    const [chooser] = await Promise.all([
      fp.waitForEvent('filechooser'),
      fp.locator('.db-sync-zone .btn', { hasText: 'Import' }).click()
    ]);
    await chooser.setFiles(importFile);
    await fp.waitForTimeout(800);
    const master2 = JSON.parse(fs.readFileSync(path.join(data, 'master', 'master_db.json'), 'utf8'));
    record('C8', 'master DB import works through the browser file picker',
      Object.values(master2.patients).some((p) => p.first_name === 'Importado'), `patients now ${Object.keys(master2.patients).length}`);

    // C9: the seeded demo patient on drive 2 raises the warning too.
    const dp2 = doctor.page;
    await dp2.goto(BASE + '/');
    await typeCredentials(dp2, 'doctor');
    await loadDrive(dp2, 2);
    const chipsSeed = await ackConsent(dp2);
    await dp2.screenshot({ path: path.join(os.tmpdir(), 'gdr-web-dentist.png'), fullPage: true });
    record('C9', 'demo seed: patient on virtual drive 2 carries a restricted slip',
      JSON.stringify(chipsSeed) === JSON.stringify(['Fillings', 'Extractions']), JSON.stringify(chipsSeed));

    record('C10', 'no JavaScript errors in any station during the whole visit', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 5)));
  } finally {
    await browser.close();
    await stopServer(srv);
  }
}

(async () => {
  console.log('GDR WEB TEST BUILD — PROOF HARNESS\n');
  try { partA(); } catch (e) { record('A!', 'parity harness crashed', false, e.stack); }
  try { await partB(); } catch (e) { record('B!', 'server harness crashed', false, e.stack); }
  try { await partC(); } catch (e) { record('C!', 'browser harness crashed', false, e.stack); }
  const failed = results.filter((r) => !r.passed).length;
  console.log('\n---------------------------------------------------------');
  console.log(`TOTAL: ${results.length - failed} passed, ${failed} failed (of ${results.length})`);
  process.exit(failed ? 1 : 0);
})();
