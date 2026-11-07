'use strict';
/*
 * GDR Clinic — WEB TEST BUILD.
 *
 * Runs the exact same application in a browser, for remote/agile testing (e.g.
 * on Render). Nothing about the screens or the business logic is reimplemented:
 *
 *   browser:  src/renderer/**      the unchanged desktop UI
 *             src/web/shim.js      window.api over HTTP instead of Electron IPC
 *   server:   src/main/api.js      the SAME request handlers the desktop uses
 *             src/server/platform  virtual drives instead of USB, no dialogs
 *
 * Security (this is reachable from the internet):
 *  - Every request needs the site password (HTTP Basic auth) — GDR_WEB_PASSWORD.
 *    The server refuses to start without one. Repeated wrong guesses from one
 *    address are throttled.
 *  - Each browser gets its own login session (cookie), so testers at different
 *    stations never share or overwrite each other's login.
 *  - Only the UI folders are served; drive access is limited to the server's own
 *    virtual drives; downloads only from the exports folder.
 *  - Never put real patient information on a test server. A banner says so on
 *    every screen.
 *
 * Environment:
 *   PORT                 port to listen on (Render sets this)
 *   GDR_WEB_PASSWORD     site password (required)
 *   GDR_WEB_USER         site username (default "gdr")
 *   GDR_DATA_DIR         where the database + virtual drives live
 *                        (default: a temp folder — erased on restart)
 *   GDR_VIRTUAL_DRIVES   how many virtual flash drives to offer (default 8)
 *   GDR_SEED_DEMO        "1" = load the invented demo clinic when the DB is empty
 *   GDR_WEB_BANNER       override the test-environment banner text
 *   GDR_WEB_INSECURE_NO_AUTH  "1" = skip the site password (local use ONLY)
 */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const VERSION = require(path.join(ROOT, 'package.json')).version;

// The data dir must be fixed before any module touches the database.
if (!process.env.GDR_DATA_DIR) process.env.GDR_DATA_DIR = path.join(os.tmpdir(), 'gdr-web-data');

const paths = require('../main/paths');
const db = require('../main/db');
const drive = require('../main/drive');
const api = require('../main/api');
const { createWebPlatform } = require('./platform');

// PORT=0 means "any free port" (used by the tests), so test for presence, not truthiness.
const PORT = process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : 10000;
const SITE_USER = process.env.GDR_WEB_USER || 'gdr';
const SITE_PASS = process.env.GDR_WEB_PASSWORD || '';
const NO_AUTH = process.env.GDR_WEB_INSECURE_NO_AUTH === '1';
const BANNER = process.env.GDR_WEB_BANNER
  || 'TEST ENVIRONMENT — demo data only. Never enter real patient information.';
const MAX_BODY = 30 * 1024 * 1024; // a large clinic's master DB import fits comfortably
const DATA_DIR = paths.base();

if (!SITE_PASS && !NO_AUTH) {
  console.error('[web] Refusing to start: set GDR_WEB_PASSWORD (the site password testers will use).');
  console.error('[web] For a private local run only, GDR_WEB_INSECURE_NO_AUTH=1 skips it.');
  process.exit(1);
}

const platform = createWebPlatform({ driveCount: process.env.GDR_VIRTUAL_DRIVES, version: VERSION });
const handlers = api.createHandlers(platform);

// ---------------------------------------------------------------------------
// Sessions: one auth context per browser, keyed by an unguessable cookie.
// ---------------------------------------------------------------------------
const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const sessions = new Map(); // sid -> { ctx: { session }, seen }

function getSession(req, res) {
  const sid = parseCookies(req).gdr_sid;
  if (sid && sessions.has(sid)) {
    const s = sessions.get(sid);
    s.seen = Date.now();
    return s.ctx;
  }
  const fresh = crypto.randomBytes(32).toString('hex');
  const s = { ctx: { session: null }, seen: Date.now() };
  sessions.set(fresh, s);
  const secure = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  res.setHeader('Set-Cookie', `gdr_sid=${fresh}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
  return s.ctx;
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [sid, s] of sessions) if (s.seen < cutoff) sessions.delete(sid);
}, 60 * 60 * 1000).unref();

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Site password (HTTP Basic auth) with per-address throttling.
// ---------------------------------------------------------------------------
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 20;
const failures = new Map(); // ip -> { count, since }

// Best effort. Behind Render's proxy the client address arrives in
// X-Forwarded-For; a client may be able to prepend its own entries, which would
// let it dodge this throttle — so the real defence is a strong site password.
// Keying on a later hop instead risks every tester sharing one proxy address,
// letting one bad actor lock everybody out; dodgeable is the safer failure.
function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Returns true when the request may proceed; otherwise has already responded.
function checkSitePassword(req, res) {
  if (NO_AUTH) return true;
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && Date.now() - f.since < FAIL_WINDOW_MS && f.count >= FAIL_LIMIT) {
    send(res, 429, 'Too many failed sign-in attempts. Try again in 15 minutes.', 'text/plain; charset=utf-8');
    return false;
  }
  const hdr = String(req.headers.authorization || '');
  if (hdr.startsWith('Basic ')) {
    const decoded = Buffer.from(hdr.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i >= 0 && safeEqual(decoded.slice(0, i), SITE_USER) && safeEqual(decoded.slice(i + 1), SITE_PASS)) {
      failures.delete(ip);
      return true;
    }
    const rec = f && Date.now() - f.since < FAIL_WINDOW_MS ? f : { count: 0, since: Date.now() };
    rec.count++;
    failures.set(ip, rec);
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="GDR Clinic test", charset="UTF-8"');
  send(res, 401, 'Authentication required.', 'text/plain; charset=utf-8');
  return false;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.csv': 'text/csv; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
};

function send(res, status, body, type) {
  res.statusCode = status;
  if (type) res.setHeader('Content-Type', type);
  res.end(body);
}

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // A test copy must never show up in search results.
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
}

// Resolve a request path under one of the allowed roots, or null. Blocks
// traversal ("..", encoded or not) and anything outside the UI folders.
function underRoot(root, rel) {
  if (rel.includes('\0')) return null;
  const full = path.resolve(root, '.' + path.sep + rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function serveFile(req, res, file, extraHeaders) {
  let st;
  try { st = fs.statSync(file); } catch (_) { return send(res, 404, 'Not found', 'text/plain'); }
  if (!st.isFile()) return send(res, 404, 'Not found', 'text/plain');
  const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
  // Revalidate every time, so a fresh deploy is picked up on the next load.
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  if (req.headers['if-none-match'] === etag) return send(res, 304, '');
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

// index.html with the web shim placed ahead of the renderer's module script.
const SCRIPT_MARKER = '<script type="module" src="app.js"></script>';
function serveIndex(res) {
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  if (!html.includes(SCRIPT_MARKER)) {
    // Fail loudly rather than serve a page that silently can't reach the server.
    console.error('[web] index.html no longer contains the app.js module script tag');
    return send(res, 500, 'index.html changed: web shim could not be injected.', 'text/plain');
  }
  const inject = [
    '<script src="/web/boot.js"></script>',
    '<script src="/web/shared/codes.js"></script>',
    '<script src="/web/shared/model.js"></script>',
    '<script src="/web/shim.js"></script>'
  ].join('\n  ');
  res.setHeader('Cache-Control', 'no-store');
  send(res, 200, html.replace(SCRIPT_MARKER, inject + '\n  ' + SCRIPT_MARKER), MIME['.html']);
}

// The two pure shared modules, wrapped from CommonJS for the browser.
const SHARED = { 'codes.js': 'codes', 'model.js': 'model' };
function serveShared(res, name) {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'shared', name), 'utf8');
  const key = SHARED[name];
  const body = '(function(){var module={exports:{}};var exports=module.exports;\n' + src
    + `\n;(window.__GDR_SHARED__=window.__GDR_SHARED__||{})[${JSON.stringify(key)}]=module.exports;})();\n`;
  res.setHeader('Cache-Control', 'no-cache');
  send(res, 200, body, MIME['.js']);
}

// Replaces the desktop's synchronous config read (config:get-sync).
function serveBoot(res) {
  const body = `window.__GDR_BOOT__=${JSON.stringify(api.publicConfig())};\n`
    + `window.__GDR_WEB__=${JSON.stringify({ banner: BANNER, version: VERSION })};\n`;
  res.setHeader('Cache-Control', 'no-store');
  send(res, 200, body, MIME['.js']);
}

// Server paths are an implementation detail; keep them out of replies.
function scrub(json) { return json.split(DATA_DIR).join('~'); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveApi(req, res, channel) {
  if (req.method !== 'POST') return send(res, 405, 'Method not allowed', 'text/plain');
  // Only JSON. A cross-site HTML form cannot send application/json, so this —
  // with the SameSite=Strict cookie — shuts out cross-site request forgery.
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    return send(res, 415, 'Expected application/json', 'text/plain');
  }
  const origin = req.headers.origin;
  if (origin && origin.replace(/^https?:\/\//, '') !== req.headers.host) {
    return send(res, 403, 'Cross-origin request refused', 'text/plain');
  }
  if (!Object.prototype.hasOwnProperty.call(handlers, channel)) {
    return send(res, 404, JSON.stringify({ r: { ok: false, error: 'unknown_channel' } }), MIME['.json']);
  }
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); }
  catch (e) { return send(res, e.status || 400, 'Bad request', 'text/plain'); }
  const ctx = getSession(req, res);
  try {
    const result = await handlers[channel](body ? body.p : undefined, ctx);
    res.setHeader('Cache-Control', 'no-store');
    send(res, 200, scrub(JSON.stringify({ r: result === undefined ? null : result })), MIME['.json']);
  } catch (e) {
    console.error(`[web] ${channel} failed:`, e && e.stack ? e.stack : e);
    send(res, 500, JSON.stringify({ r: { ok: false, error: 'server_error' } }), MIME['.json']);
  }
}

function serveDownload(req, res, url) {
  const name = url.searchParams.get('f') || '';
  // A bare file name from the exports folder — nothing else.
  if (!name || name !== path.basename(name) || name.startsWith('.')) return send(res, 400, 'Bad file name', 'text/plain');
  const file = underRoot(paths.exports(), name);
  if (!file) return send(res, 400, 'Bad file name', 'text/plain');
  serveFile(req, res, file, { 'Content-Disposition': `attachment; filename="${name.replace(/"/g, '')}"` });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const STATIC_ROOTS = {
  '/src/renderer/': path.join(ROOT, 'src', 'renderer'),
  '/assets/': path.join(ROOT, 'assets')
};

async function route(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://local');
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch (_) { return send(res, 400, 'Bad request', 'text/plain'); }

  // Unauthenticated, so the host can check the service is alive.
  if (pathname === '/healthz') return send(res, 200, 'ok', 'text/plain');

  if (!checkSitePassword(req, res)) return;

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Location', '/src/renderer/index.html');
    return send(res, 302, '');
  }
  if (pathname.startsWith('/api/')) return serveApi(req, res, pathname.slice(5));
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');

  if (pathname === '/src/renderer/index.html') return serveIndex(res);
  if (pathname === '/web/boot.js') return serveBoot(res);
  if (pathname === '/web/shim.js') return serveFile(req, res, path.join(ROOT, 'src', 'web', 'shim.js'));
  if (pathname.startsWith('/web/shared/')) {
    const name = pathname.slice('/web/shared/'.length);
    return SHARED[name] ? serveShared(res, name) : send(res, 404, 'Not found', 'text/plain');
  }
  if (pathname === '/web/download') return serveDownload(req, res, url);

  for (const [prefix, root] of Object.entries(STATIC_ROOTS)) {
    if (pathname.startsWith(prefix)) {
      const file = underRoot(root, pathname.slice(prefix.length));
      return file ? serveFile(req, res, file) : send(res, 404, 'Not found', 'text/plain');
    }
  }
  send(res, 404, 'Not found', 'text/plain');
}

// ---------------------------------------------------------------------------
// First boot: optionally load the invented demo clinic so testers have data.
// ---------------------------------------------------------------------------
function seedDemoIfEmpty() {
  if (process.env.GDR_SEED_DEMO !== '1') return;
  if (db.allPatients().length > 0) return;
  const demo = require('./demo-data');
  const { patients } = demo.ledger({ startNumber: 147 });
  db.importMaster(JSON.stringify({ patients }));
  // Two patients already "on" drives, ready to walk through the stations:
  // #146 on drive 1 (everything authorized), #145 on drive 2 (parent declined
  // fillings + extractions, so the clinical stations raise the consent warning).
  drive.writePatient(platform._folderFor(1), demo.chartPatient({ number: 146 }));
  drive.writePatient(platform._folderFor(2), demo.chartPatient({
    number: 145, consentDenied: true, first: 'Mateo', last: 'Ramírez',
    guardian: 'Rosa Ramírez', phone: '555 302 9918', sex: 'M', age: 8, drive: 2
  }));
  console.log(`[web] seeded demo clinic: ${patients.length} patients + 2 patients on virtual drives 1-2`);
}

function start() {
  seedDemoIfEmpty();
  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      console.error('[web] request failed:', e && e.stack ? e.stack : e);
      if (!res.headersSent) send(res, 500, 'Server error', 'text/plain');
    });
  });
  server.listen(PORT, () => {
    console.log(`[web] GDR Clinic ${VERSION} (web test build) listening on :${server.address().port}`);
    console.log(`[web] data: ${DATA_DIR}`);
    console.log(`[web] site password: ${NO_AUTH ? 'DISABLED (local use only)' : 'required (user "' + SITE_USER + '")'}`);
  });
  // The host stops the old instance on every deploy: finish in-flight requests,
  // drop idle keep-alive connections (they would otherwise hold the process
  // open), and give up waiting after 10 s.
  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 10000).unref();
  });
  return server;
}

if (require.main === module) start();
module.exports = { start };
