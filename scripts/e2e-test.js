'use strict';
/*
 * GDR END-TO-END UI PROOF RUNNER (TEST-ONLY)
 * ===========================================================================
 * Drives the REAL Electron app (renderer + preload/contextBridge + IPC + main
 * process + on-disk master DB + simulated flash drive) to PROVE — or disprove —
 * that the recent fixes/features actually work end-to-end in the running app.
 *
 * It launches the app once per "station" (headless, via xvfb-run), each launch
 * gated by GDR_SMOKE_* env probes that live in src/main/main.js (test-only,
 * env-gated; they never alter non-test behaviour). State persists on disk
 * between launches via the sim-drive file + master DB, mirroring the real
 * multi-laptop clinic flow.
 *
 * This runner does NOT modify app/business logic. It only orchestrates launches
 * and asserts on the [smoke]/[seed] evidence lines.
 *
 * Run:  node scripts/e2e-test.js
 * (Requires: xvfb + electron; headless Linux.)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), require('../package.json').name);
const MASTER_FILE = path.join(DATA_DIR, 'master', 'master_db.json');
const SIM_FILE = path.join(DATA_DIR, 'sim-drive', 'patient_00147.json');

const model = require('../src/shared/model');

// ---------------------------------------------------------------------------
// Tiny harness
// ---------------------------------------------------------------------------
const results = [];
function record(id, name, passed, evidence) {
  results.push({ id, name, passed: !!passed, evidence: evidence || '' });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  [${id}] ${name}`);
  if (evidence) console.log(`        evidence: ${evidence}`);
}

// Run the app for a single station; return all captured [smoke]/[seed] lines.
function launch(envExtra, label) {
  const env = Object.assign({}, process.env, {
    GDR_SMOKE_LAUNCH: '1'
  }, envExtra);
  // xvfb-run -a npx electron . --no-sandbox  (grep [smoke] ourselves)
  const r = spawnSync('xvfb-run', ['-a', 'npx', 'electron', '.', '--no-sandbox'], {
    cwd: ROOT, env, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024
  });
  const out = (r.stdout || '') + '\n' + (r.stderr || '');
  const lines = out.split('\n').filter((l) => /\[smoke\]|\[seed\]/.test(l));
  if (process.env.E2E_VERBOSE) { console.log(`\n----- ${label} -----`); lines.forEach((l) => console.log(l)); }
  return { lines, raw: out, code: r.status };
}
function find(lines, re) { return lines.find((l) => re.test(l)) || ''; }
function num(line) { const m = (line || '').match(/(-?\d+)/g); return m ? Number(m[m.length - 1]) : NaN; }

function seed(args, label) {
  const r = spawnSync('node', ['scripts/e2e-seed.js'].concat(args || []), { cwd: ROOT, encoding: 'utf8' });
  if (process.env.E2E_VERBOSE) console.log(`[seed ${label || ''}]`, (r.stdout || '').trim());
  return r.stdout || '';
}

// Read the REAL Electron master DB straight off disk (NOT via require('db'),
// which outside Electron points at os.tmpdir()).
function readMaster() {
  try { return JSON.parse(fs.readFileSync(MASTER_FILE, 'utf8')); } catch (_) { return { patients: {} }; }
}
function readDriveVisit() {
  try {
    const env = JSON.parse(fs.readFileSync(SIM_FILE, 'utf8'));
    const p = env.payload || env;
    return model.lastVisit(p);
  } catch (_) { return null; }
}
function masterVisit() {
  const m = readMaster();
  const p = Object.values(m.patients || {})[0];
  return p ? model.lastVisit(p) : null;
}

// ===========================================================================
console.log('GDR END-TO-END UI PROOF RUNNER');
console.log('data dir:', DATA_DIR);
console.log('');

// ---------------------------------------------------------------------------
// CHECK 1 — headless module tests must pass.
// ---------------------------------------------------------------------------
console.log('=== 1. npm run smoke / npm run flow (headless core) ===');
{
  const smoke = spawnSync('npm', ['run', 'smoke'], { cwd: ROOT, encoding: 'utf8' });
  const flow = spawnSync('npm', ['run', 'flow'], { cwd: ROOT, encoding: 'utf8' });
  const smokeOut = (smoke.stdout || '') + (smoke.stderr || '');
  const flowOut = (flow.stdout || '') + (flow.stderr || '');
  const smokeLine = (smokeOut.match(/All \d+ checks passed.*/) || [''])[0].trim();
  const flowLine = (flowOut.match(/RESULT: \d+ passed, \d+ failed/) || [''])[0].trim();
  record('1a', 'npm run smoke → all 16 checks pass', /All 16 checks passed/.test(smokeOut), smokeLine);
  record('1b', 'npm run flow → 198 passed, 0 failed', /198 passed, 0 failed/.test(flowOut), flowLine);
}

// ---------------------------------------------------------------------------
// CHECK 8 — v1.3.3 permission slip: the check-in screen renders the clinic's
//           real paper form (three opt-in boxes, autopopulated child/Escuela,
//           phone, both signing options) and the old draft text is gone.
// ---------------------------------------------------------------------------
console.log('\n=== 8. v1.3.3 permission slip (CHECK-IN launch) ===');
seed([], 'fresh check-in');
{
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'frontdesk:welcome123', GDR_SMOKE_CONSENT_SLIP: '1' }, 'consent slip');
  const slipLine = find(lines, /consent slip:/);
  let s = {};
  try { s = JSON.parse(slipLine.replace(/^.*consent slip:\s*/, '')); } catch (_) { s = {}; }
  record('8a', 'v1.3.3 slip shows exactly 3 opt-in care boxes (Cleaning/Fillings/Extractions)',
    s.perms === 3, `perms=${s.perms} labels=${JSON.stringify(s.labels || [])}`);
  record('8b', 'v1.3.3 every care box starts UNTICKED (parent must opt in)',
    s.allUnticked === true, `allUnticked=${s.allUnticked}`);
  record('8c', "v1.3.3 child's name + Escuela autopopulate from registration",
    /Juan/.test(s.childAuto || '') && /Morelos/.test(s.schoolAuto || ''),
    `child="${s.childAuto}" escuela="${s.schoolAuto}"`);
  record('8d', 'v1.3.3 signature pad AND typed-name blank both present, plus phone field',
    s.pad === true && s.inlineName === true && s.phone === true,
    `pad=${s.pad} typedBlank=${s.inlineName} phone=${s.phone}`);
  record('8e', 'v1.3.3 old DRAFT consent text is gone from the running app',
    s.draftGone === true, `draftGone=${s.draftGone}`);
}

// ---------------------------------------------------------------------------
// CHECK 9 — v1.3.3 consent restrictions: a declined care option raises a RED
//           popup the clinician must acknowledge (backdrop click will NOT
//           dismiss it), leaves a standing banner, never blocks charting — and
//           stays SILENT for legacy records.
// ---------------------------------------------------------------------------
console.log('\n=== 9. v1.3.3 consent restrictions (DOCTOR + HYGIENIST launches) ===');
{
  const parse = (lines, re) => { try { return JSON.parse(find(lines, re).replace(/^.*?:\s*(?=\{)/, '')); } catch (_) { return {}; } };

  // 9a-9d: parent ticked ONLY cleaning -> fillings + extractions denied.
  seed([], 'consent partial');
  const partial = launch({ GDR_SMOKE_LOGIN: 'doctor:welcome123', GDR_SMOKE_CONSENT_LIMITS: 'partial' }, 'consent partial').lines;
  const pBefore = parse(partial, /consent limits before:/);
  const pAfter = parse(partial, /consent limits after:/);
  const pSurvived = /survived:\s*true/.test(find(partial, /backdrop-survived/));
  record('9a', 'v1.3.3 declined care raises the RED consent popup at the dentist',
    pBefore.modal === true, `modal=${pBefore.modal} denied=${JSON.stringify(pBefore.chips || [])}`);
  record('9b', 'v1.3.3 popup names exactly the declined care and offers X + acknowledge',
    (pBefore.chips || []).length === 2 && pBefore.hasX === true && pBefore.ack === true,
    `chips=${JSON.stringify(pBefore.chips || [])} X=${pBefore.hasX} ack=${pBefore.ack}`);
  record('9c', 'v1.3.3 a backdrop click does NOT dismiss it (must be deliberate)',
    pSurvived === true, `survivedBackdropClick=${pSurvived}`);
  record('9d', 'v1.3.3 after acknowledging, the red banner stands and charting still works',
    pAfter.modal === false && pAfter.banner === true && pAfter.chartable === true,
    `modalGone=${pAfter.modal === false} banner=${pAfter.banner} chartable=${pAfter.chartable}`);

  // 9e: LEGACY record (pre-slip consent, no per-item boxes) must stay silent.
  seed([], 'consent legacy');
  const legacy = launch({ GDR_SMOKE_LOGIN: 'doctor:welcome123', GDR_SMOKE_CONSENT_LIMITS: 'legacy' }, 'consent legacy').lines;
  const lBefore = parse(legacy, /consent limits before:/);
  const lAfter = parse(legacy, /consent limits after:/);
  record('9e', 'v1.3.3 LEGACY consent stays silent (no false alarm on returning patients)',
    lBefore.modal === false && lAfter.banner === false,
    `modal=${lBefore.modal} banner=${lAfter.banner}`);

  // 9f: parent ticked everything -> no warning at all.
  seed([], 'consent all granted');
  const all = launch({ GDR_SMOKE_LOGIN: 'doctor:welcome123', GDR_SMOKE_CONSENT_LIMITS: 'all' }, 'consent all').lines;
  const aBefore = parse(all, /consent limits before:/);
  const aAfter = parse(all, /consent limits after:/);
  record('9f', 'v1.3.3 fully-granted slip raises no popup and no banner',
    aBefore.modal === false && aAfter.banner === false,
    `modal=${aBefore.modal} banner=${aAfter.banner}`);

  // 9g: the SAME warning must appear at the hygienist station.
  seed([], 'consent none (hygienist)');
  const hyg = launch({ GDR_SMOKE_LOGIN: 'hygienist:welcome123', GDR_SMOKE_CONSENT_LIMITS: 'none' }, 'consent hygienist').lines;
  const hBefore = parse(hyg, /consent limits before:/);
  const hAfter = parse(hyg, /consent limits after:/);
  record('9g', 'v1.3.3 the hygienist station raises the identical warning (all 3 declined)',
    hBefore.modal === true && (hBefore.chips || []).length === 3 && hAfter.banner === true,
    `modal=${hBefore.modal} chips=${JSON.stringify(hBefore.chips || [])} banner=${hAfter.banner}`);
}

// ---------------------------------------------------------------------------
// CHECK 6 — brand (v1.1.4): runs on the login screen of any launch.
// CHECK 5 — chart: v1.3.2 removes the dentition-layout dropdown (hybrid-only,
//           52 teeth); v1.1.1 health-status mode + context panels still stand.
// (Combine into a single dentist launch over a fresh check-in patient.)
// ---------------------------------------------------------------------------
console.log('\n=== 5/6. v1.1.1 chart + v1.1.4 brand (DOCTOR launch) ===');
seed([], 'fresh check-in');
{
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'doctor:welcome123', GDR_SMOKE_DENTIST: '1' }, 'doctor chart');
  // v1.1.4 brand
  const fontLine = find(lines, /body font/);
  const lockupLine = find(lines, /login lockup img natural width/);
  record('6a', 'v1.1.4 body font includes "Source Sans 3"', /Source Sans 3/.test(fontLine), fontLine.replace('[smoke] ', '').trim());
  record('6b', 'v1.1.4 login lockup image naturalWidth > 0', num(lockupLine) > 0, lockupLine.replace('[smoke] ', '').trim());
  // header brand-logo presence is checked separately below (admin launch shows header)
  // v1.3.2 item 1 — the dentition-layout dropdown was REMOVED. The chart always
  // renders the hybrid dentition (adult 1-32 + primary a-t = 52 teeth). 5c health.
  const selectorLine = find(lines, /chart selector present/);
  const hybridLine = find(lines, /teeth \(hybrid\)/);
  const tintedLine = find(lines, /health-tinted teeth/);
  const noSelector = /present:\s*false/.test(selectorLine);
  record('5a', 'v1.3.2 no dentition-layout selector present (.chart-view-select removed)', noSelector, selectorLine.replace('[smoke] ', '').trim());
  record('5b', 'v1.3.2 hybrid chart shows 52 teeth (adult 32 + primary 20)', num(hybridLine) === 52, hybridLine.replace('[smoke] ', '').trim());
  record('5c', 'v1.1.1 Health-status mode tints a tooth on click', num(tintedLine) >= 1, tintedLine.replace('[smoke] ', '').trim());
}

// cleaning/fluoride panels (v1.1.1 last clause: med history + tx-this-visit + visit history)
console.log('\n=== 5d. v1.1.1 cleaning/fluoride context panels ===');
seed(['--with-dentist'], 'post-dentist');
{
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'hygienist:welcome123', GDR_SMOKE_LOADSIM: '1' }, 'cleaning panels');
  const p = find(lines, /context panels/);
  const ok = /Medical history/.test(p) && /Treatment this visit/.test(p) && /Visit history/.test(p);
  record('5d', 'v1.1.1 cleaning shows Medical history + Treatment this visit + Visit history', ok, p.replace('[smoke] ', '').trim());
}

// header brand-logo via an admin launch (header rendered after login)
console.log('\n=== 6c. v1.1.4 header brand-logo + role chip ===');
{
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'admin:welcome123' }, 'admin header');
  const brand = find(lines, /brand title/);
  const role = find(lines, /role chip/);
  record('6c', 'v1.1.4 header brand title present after login', /Global Dental Relief/.test(brand), `${brand.trim()} | ${role.trim()}`);
}

// ---------------------------------------------------------------------------
// CHECK B0 — ROOT-CAUSE FIX (v1.1.6): the stations resolve the working visit via
//            the renderer-local lastVisit() (util.js), NOT the contextBridge, so
//            the visit is a LIVE reference and edits propagate. Also confirm the
//            old bridge function is gone so the footgun can't return. Underpins 2/3.
// ---------------------------------------------------------------------------
console.log('\n=== B0. renderer-local lastVisit() is a live reference (root-cause fix) ===');
{
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'doctor:welcome123', GDR_SMOKE_BRIDGE: '1' }, 'bridge');
  const idLine = find(lines, /bridge lastVisit identity/);
  const verdict = find(lines, /bridge VERDICT/);
  const footgun = find(lines, /bridge footgun removed/);
  const isLive = /LIVE-REFERENCE/.test(verdict);
  const removed = /removed:\s*true/.test(footgun);
  record('B0', 'renderer-local lastVisit() returns a LIVE reference + bridge footgun removed', isLive && removed,
    `${idLine.trim()} | ${verdict.replace('[smoke] ', '').trim()} | ${footgun.replace('[smoke] ', '').trim()}`);
}

// ---------------------------------------------------------------------------
// CHECK 2 — v1.1.3 data flow IN THE UI: DOCTOR adds treatment via the chart and
//           Saves to drive; the work must reach the drive + master and show
//           downstream. We assert on what the renderer actually persists.
// ---------------------------------------------------------------------------
console.log('\n=== 2. v1.1.3 dentist→downstream data flow (FULL UI) ===');
seed([], 'fresh check-in');
{
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'doctor:welcome123', GDR_SMOKE_DENTIST_SAVE: '19:restoration:O,B' }, 'doctor save');
  const itemsUi = num(find(lines, /dentist items after chart edit/)); // in-memory (DOM today-list)
  const ipcLine = find(lines, /IPC drive:write last-visit items=/);
  const ipcItems = num((ipcLine.match(/items=(\d+)/) || [])[0] || 'items=NaN');
  const savedDlg = /Saved/.test(find(lines, /post-save dialog/));
  // What actually landed on disk after the doctor's UI save:
  const dv = readDriveVisit();
  const mv = masterVisit();
  const driveItems = dv ? (dv.treatment_items || []).length : -1;
  const masterItems = mv ? (mv.treatment_items || []).length : -1;
  const ev = `UI today-list=${itemsUi}, IPC drive:write items=${ipcItems}, saved-dialog=${savedDlg}; DRIVE items=${driveItems}, MASTER items=${masterItems}`;
  // The feature is correct ONLY if the charted item reaches BOTH stores.
  record('2a', 'v1.1.3 doctor charts a treatment and it reaches the DRIVE on Save', driveItems >= 1, ev);
  record('2b', 'v1.1.3 doctor charted treatment reaches the MASTER DB on Save', masterItems >= 1, `MASTER items=${masterItems}`);

  // Downstream visibility: launch hygienist/fluoride/checkout and read N.
  const downstream = [];
  for (const role of ['hygienist:welcome123', 'fluoride:welcome123', 'checkout:welcome123']) {
    const res = launch({ GDR_SMOKE_LOGIN: role, GDR_SMOKE_PANEL: '1' }, 'panel ' + role);
    const n = num(find(res.lines, /panel effective treatment N/));
    downstream.push(`${role.split(':')[0]}:N=${n}`);
  }
  const allN0 = downstream.every((d) => /N=0\b/.test(d) || /N=-1/.test(d));
  record('2c', 'v1.1.3 dentist work visible downstream (N>0 at hygienist/fluoride/checkout)', !allN0, downstream.join('  '));
}

// ---------------------------------------------------------------------------
// CHECK 2' — Downstream display mechanism, independent of the doctor-save path:
//            seed a dentist plan ON the drive, then assert each downstream
//            station's "Treatment this visit (N)" shows N>0. This isolates the
//            DISPLAY feature from the save bug.
// ---------------------------------------------------------------------------
console.log('\n=== 2d. Downstream "Treatment this visit (N)" with plan pre-loaded on drive ===');
{
  const ds = [];
  let allPos = true;
  for (const role of ['hygienist:welcome123', 'fluoride:welcome123', 'checkout:welcome123']) {
    seed(['--with-dentist'], 'post-dentist ' + role);
    const res = launch({ GDR_SMOKE_LOGIN: role, GDR_SMOKE_PANEL: '1' }, 'panel ' + role);
    const n = num(find(res.lines, /panel effective treatment N/));
    ds.push(`${role.split(':')[0]}:N=${n}`);
    if (!(n >= 1)) allPos = false;
  }
  record('2d', 'Downstream panel shows N>0 when the dentist plan is on the drive', allPos, ds.join('  '));
}

// ---------------------------------------------------------------------------
// CHECK 3 — v1.1.2 interactive checkout: care checklist has clickable
//           checkboxes; ticking them must persist to the master DB after upload.
// ---------------------------------------------------------------------------
console.log('\n=== 3. v1.1.2 interactive checkout care checklist ===');
seed(['--with-dentist'], 'post-dentist');
{
  const { lines } = launch({
    GDR_SMOKE_LOGIN: 'checkout:welcome123',
    GDR_SMOKE_CHECKOUT_MARKS: 'cleaning,fluoride,oh',
    GDR_SMOKE_CHECKOUT_OUTCOME: 'F'
  }, 'checkout marks');
  const boxesLine = find(lines, /care-checklist checkboxes/);
  const boxes = num(boxesLine);
  const states = find(lines, /checkbox states after ticking/);
  const allTicked = /\[true,true,true,true,true\]/.test(states);
  record('3a', 'v1.1.2 care checklist has clickable checkboxes (>=5) and they toggle on', boxes >= 5 && allTicked, `${boxesLine.trim()} | ${states.replace('[smoke] ', '').trim()}`);

  // Persistence: re-read the REAL master DB.
  const mv = masterVisit();
  const persisted = mv && mv.cleaning_done === true && mv.fluoride_done === true && mv.oh3_done === true && mv.visit_outcome === 'F';
  const ev = mv
    ? `master: cleaning_done=${mv.cleaning_done}, fluoride_done=${mv.fluoride_done}, oh3_done=${mv.oh3_done}, visit_outcome=${mv.visit_outcome}, checkout_ts=${!!mv.checkout_timestamp}`
    : 'no patient in master';
  record('3b', 'v1.1.2 ticked OH/cleaning/fluoride + outcome PERSIST to master after upload', persisted, ev);
}

// ---------------------------------------------------------------------------
// CHECK 4 — v1.1.5 fluoride (data layer): a dentist "no fluoride" is preserved
//           through a downstream save and NOT counted; a check-in-only patient
//           is not counted as fluoride-recommended.
//           (Verified at the real data layer — the UI dentist-save path is
//            impractical here due to B0; see report.)
// ---------------------------------------------------------------------------
console.log('\n=== 4. v1.1.5 fluoride_recommended logic (data layer) ===');
{
  const script = `
    const db=require('${path.join(ROOT, 'src/main/db')}');
    const drive=require('${path.join(ROOT, 'src/main/drive')}');
    const reports=require('${path.join(ROOT, 'src/main/reports')}');
    const model=require('${path.join(ROOT, 'src/shared/model')}');
    const os=require('os'),path=require('path'),fs=require('fs');
    db._reset();
    const DIR=path.join(os.tmpdir(),'gdr-e2e-item4-'+Date.now());fs.mkdirSync(DIR,{recursive:true});
    const fr=()=>reports.computeStats({}).rows.find(r=>r.key==='fluoride_recommended').count;
    const p=db.createPatient({first_name:'C',school_group:'E',age_at_first_visit:7,sex:'F',drive_number:1});
    const v0=model.newVisit(p);v0.oh1_done=true;v0.station_status.checkin=true;p.visits=[v0];db.savePatient(p);
    const a=fr();
    const d=JSON.parse(JSON.stringify(db.getPatient(p.id)));const dv=model.lastVisit(d);
    dv.exam_type='E';dv.fluoride_recommended=false;dv.station_status.dentist=true;dv.last_modified=model.nowISO();
    drive.writePatient(DIR,d);db.mergeFromDrive(d);
    const bStored=model.lastVisit(db.getPatient(p.id)).fluoride_recommended;const b=fr();
    const fl=drive.readPatient(DIR).patient;const fv=model.lastVisit(fl);
    fv.fluoride_recommended=true;fv.oh3_done=true;fv.fluoride_done=true;fv.station_status.fluoride=true;fv.last_modified=model.nowISO();
    drive.writePatient(DIR,fl);db.mergeFromDrive(fl);
    const cStored=model.lastVisit(db.getPatient(p.id)).fluoride_recommended;const c=fr();const fdone=model.lastVisit(db.getPatient(p.id)).fluoride_done;
    console.log(JSON.stringify({a,bStored,b,cStored,c,fdone}));
  `;
  const r = spawnSync('node', ['-e', script], { cwd: ROOT, encoding: 'utf8' });
  let d = {};
  try { d = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch (_) {}
  record('4a', 'v1.1.5 check-in-only patient NOT counted as fluoride-recommended', d.a === 0, `count(check-in only)=${d.a}`);
  record('4b', 'v1.1.5 dentist "no fluoride" preserved + not counted', d.bStored === false && d.b === 0, `stored=${d.bStored}, count=${d.b}`);
  record('4c', 'v1.1.5 stale downstream "true" does NOT restore recommendation; still not counted', d.cStored === false && d.c === 0 && d.fdone === true, `stored=${d.cStored}, count=${d.c}, fluoride_done=${d.fdone}`);
}

// ---------------------------------------------------------------------------
// CHECK 7 — Reports: the treatment summary table reflects work in the master.
//           Seed a dentist plan on the drive, do a checkout upload (server stamps
//           checkout), then read the Reports table from the running UI.
// ---------------------------------------------------------------------------
console.log('\n=== 7. Reports table reflects the work (UI) ===');
seed(['--with-dentist'], 'post-dentist');
{
  // Checkout upload (puts the visit, with the dentist plan from the drive, into
  // master and stamps checkout_timestamp server-side).
  launch({ GDR_SMOKE_LOGIN: 'checkout:welcome123', GDR_SMOKE_CHECKOUT_MARKS: 'oh', GDR_SMOKE_CHECKOUT_OUTCOME: 'F' }, 'checkout for reports');
  const { lines } = launch({ GDR_SMOKE_LOGIN: 'checkout:welcome123', GDR_SMOKE_REPORTS: '1' }, 'reports');
  const tableLine = find(lines, /reports table:/);
  let table = [];
  try { table = JSON.parse(tableLine.replace(/^.*reports table:\s*/, '')); } catch (_) {}
  const get = (label) => { const row = table.find((r) => r[0] === label); return row ? Number(row[1]) : NaN; };
  const fillDouble = get('Double-surface fillings');
  const extPerm = get('Permanent tooth extractions');
  const total = get('Total patients seen');
  const ok = fillDouble === 1 && extPerm === 1 && total === 1;
  record('7', 'Reports treatment summary reflects dentist work (fillings/extractions/total)', ok,
    `Double-surface fillings=${fillDouble}, Permanent extractions=${extPerm}, Total patients=${total}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=========================================================');
console.log('E2E UI PROOF — RESULTS');
console.log('=========================================================');
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
console.log(pad('ID', 6) + pad('RESULT', 8) + 'CHECK');
results.forEach((r) => console.log(pad(r.id, 6) + pad(r.passed ? 'PASS' : 'FAIL', 8) + r.name));
const passed = results.filter((r) => r.passed).length;
const failed = results.length - passed;
console.log('---------------------------------------------------------');
console.log(`TOTAL: ${passed} passed, ${failed} failed (of ${results.length})`);
console.log(failed === 0
  ? '\nVERDICT: every check demonstrated PASS in the running app.'
  : '\nVERDICT: some checks FAILED in the running app (see table + evidence above).');
process.exit(failed === 0 ? 0 : 1);
