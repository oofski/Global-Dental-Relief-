'use strict';
/*
 * PRODUCT SCREENSHOT CAPTURE (TEST-ONLY).
 *
 * Launches the REAL Electron app once per screen (headless, via xvfb) and
 * captures a PNG of each, so product imagery is genuine software rather than a
 * mockup. Output lands in docs/screenshots/.
 *
 * Rendered at 2x device scale for print/retina use. All demo data is invented
 * (see scripts/shots-seed.js) — no real patient information appears.
 *
 * Run:  node scripts/screenshots.js
 * (Requires: xvfb + electron; headless Linux.)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });

const PASS = 'welcome123';

// screen key -> { login, file, caption, seed }
const SHOTS = [
  { key: 'login', login: null, file: '01-login.png',
    caption: 'Sign-in — one account per station role' },
  { key: 'checkin', login: `frontdesk:${PASS}`, file: '02-checkin.png',
    caption: 'Front desk — new or returning patient' },
  { key: 'slip', login: `frontdesk:${PASS}`, file: '03-permission-slip.png',
    caption: "Permission slip — the clinic's paper form, on screen" },
  { key: 'dentist', login: `doctor:${PASS}`, file: '04-dentist-chart.png',
    caption: 'Dentist — full mixed-dentition charting' },
  { key: 'consent-popup', login: `doctor:${PASS}`, file: '05-consent-warning.png',
    caption: 'Consent enforcement — declined care must be acknowledged',
    seed: ['--consent-denied'] },
  { key: 'cleaning', login: `hygienist:${PASS}`, file: '06-hygienist.png',
    caption: 'Hygienist — cleaning, sealants and status' },
  { key: 'fluoride', login: `fluoride:${PASS}`, file: '07-fluoride.png',
    caption: 'Fluoride station' },
  { key: 'checkout', login: `checkout:${PASS}`, file: '08-checkout.png',
    caption: 'Checkout — visit outcome and care summary' },
  { key: 'reports', login: `admin:${PASS}`, file: '09-reports.png',
    caption: 'Reports — clinic summary statistics' }
];

function seed(args) {
  const r = spawnSync('node', ['scripts/shots-seed.js'].concat(args || []), { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) console.error('[seed failed]', (r.stderr || '').trim());
}

function capture(shot) {
  seed(shot.seed);
  const out = path.join(OUT, shot.file);
  try { fs.unlinkSync(out); } catch (_) { /* first run */ }
  const env = Object.assign({}, process.env, {
    GDR_SMOKE_LAUNCH: '1',
    GDR_SHOTS: shot.key,
    GDR_SHOTS_OUT: out
  });
  // Capture the whole page except where a centred modal is the subject.
  if (shot.key !== 'consent-popup') env.GDR_SHOTS_FULL = '1';
  if (shot.login) env.GDR_SMOKE_LOGIN = shot.login;
  const r = spawnSync('xvfb-run', [
    '-a', '--server-args=-screen 0 1600x4400x24',
    'npx', 'electron', '.', '--no-sandbox', '--force-device-scale-factor=2'
  ], { cwd: ROOT, env, encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
  const log = ((r.stdout || '') + (r.stderr || '')).split('\n').filter((l) => /\[shot\]/.test(l));
  const ok = fs.existsSync(out) && fs.statSync(out).size > 5000;
  const size = ok ? `${Math.round(fs.statSync(out).size / 1024)} KB` : '—';
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${shot.file.padEnd(26)} ${size.padStart(8)}  ${log[0] ? log[0].replace(/^.*\(/, '(') : ''}`);
  return ok;
}

console.log('GDR PRODUCT SCREENSHOTS');
console.log('output:', OUT);
console.log('');
let okCount = 0;
for (const s of SHOTS) { if (capture(s)) okCount++; }

// A small manifest so the captions travel with the images.
fs.writeFileSync(path.join(OUT, 'captions.md'),
  '# GDR Clinic — product screenshots\n\n' +
  'Captured from the running application. All patient data shown is invented for\n' +
  'demonstration; no real patient information appears in these images.\n\n' +
  SHOTS.map((s) => `- **${s.file}** — ${s.caption}`).join('\n') + '\n', 'utf8');

console.log('');
console.log(`${okCount}/${SHOTS.length} screenshots captured`);
process.exit(okCount === SHOTS.length ? 0 : 1);
