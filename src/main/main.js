'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./db');
const drive = require('./drive');
const reports = require('./reports');
const paths = require('./paths');
const users = require('./users');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

// Simple in-process auth session so privileged IPC (user management) can be
// guarded server-side, not just hidden in the UI.
let session = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0d6e78',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    title: 'Mexico Clinic - Global Dental Relief',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Headless self-test (CI / sandbox): load the UI, capture any renderer error,
  // then exit. Enabled only via env var, never in production.
  if (process.env.GDR_SMOKE_LAUNCH) {
    let hadError = false;
    mainWindow.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) { hadError = true; console.error('[renderer]', message); }
    });
    mainWindow.webContents.on('render-process-gone', (_e, d) => { hadError = true; console.error('[render-gone]', d.reason); });
    mainWindow.webContents.on('did-finish-load', async () => {
      // Give the renderer a beat to run boot() and render the login screen.
      setTimeout(async () => {
        try {
          const bodyFont = await mainWindow.webContents.executeJavaScript("getComputedStyle(document.body).fontFamily");
          const lockup = await mainWindow.webContents.executeJavaScript("(document.querySelector('.login-lockup')||{}).naturalWidth||0");
          console.log('[smoke] body font:', JSON.stringify(bodyFont));
          console.log('[smoke] login lockup img natural width:', lockup);
          const inputs = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.login-input').length");
          const btnText = await mainWindow.webContents.executeJavaScript("(document.querySelector('.login-btn')||{}).textContent||''");
          const subText = await mainWindow.webContents.executeJavaScript("(document.querySelector('.login-h2')||{}).textContent||''");
          console.log('[smoke] login inputs rendered:', inputs);
          console.log('[smoke] sign-in button:', JSON.stringify(btnText));
          console.log('[smoke] login subtitle:', JSON.stringify(subText));
          if (inputs < 2) hadError = true;

          // Optional: drive a real login (GDR_SMOKE_LOGIN="user:pass").
          if (process.env.GDR_SMOKE_LOGIN) {
            const [u, p] = process.env.GDR_SMOKE_LOGIN.split(':');
            await mainWindow.webContents.executeJavaScript(`(() => {
              const set = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
              set(document.querySelectorAll('.login-input')[0], ${JSON.stringify(u)});
              set(document.querySelectorAll('.login-input')[1], ${JSON.stringify(p)});
              document.querySelector('.login-btn').click();
            })()`);
            await new Promise((r) => setTimeout(r, 900));
            const roleChip = await mainWindow.webContents.executeJavaScript("(document.querySelector('.role-chip')||{}).textContent||''");
            const tabs = await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.tab')).map(t=>t.textContent)");
            const brand = await mainWindow.webContents.executeJavaScript("(document.querySelector('.brand-title')||{}).textContent||''");
            const driveLabel = await mainWindow.webContents.executeJavaScript("(document.querySelector('.drive-label')||{}).textContent||''");
            console.log('[smoke] after login role chip:', JSON.stringify(roleChip));
            console.log('[smoke] brand title:', JSON.stringify(brand));
            console.log('[smoke] drive label:', JSON.stringify(driveLabel));
            console.log('[smoke] tabs:', JSON.stringify(tabs));
            const clearBtns = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.danger-zone .btn-danger').length");
            console.log('[smoke] clear-ledger buttons visible:', clearBtns);
            if (!roleChip) hadError = true;
            // If a Settings tab exists (admin), open it -> Accounts section -> verify seeded accounts.
            const hasSettings = await mainWindow.webContents.executeJavaScript("!!Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Settings'))");
            if (hasSettings) {
              await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.tab')).find(t=>t.textContent.includes('Settings')).click()");
              await new Promise((r) => setTimeout(r, 700));
              const subtabs = await mainWindow.webContents.executeJavaScript("Array.from(document.querySelectorAll('.subtab')).map(t=>t.textContent)");
              const rows = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.accounts-table tbody tr').length");
              console.log('[smoke] settings subtabs:', JSON.stringify(subtabs));
              console.log('[smoke] account rows:', rows);
              if (rows < 6) hadError = true;
              // Open the Clinic section.
              await mainWindow.webContents.executeJavaScript("(Array.from(document.querySelectorAll('.subtab')).find(t=>/Clinic|Cl.nica/.test(t.textContent))||{}).click&&Array.from(document.querySelectorAll('.subtab')).find(t=>/Clinic|Cl.nica/.test(t.textContent)).click()");
              await new Promise((r) => setTimeout(r, 400));
              const hasClinicForm = await mainWindow.webContents.executeJavaScript("!!document.querySelector('.settings-card')");
              console.log('[smoke] clinic settings form present:', hasClinicForm);
            }

            // Drive check-in -> medical-history screen and confirm the patient
            // sees the form in the patient (Spanish) language.
            if (process.env.GDR_SMOKE_MED) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("document.querySelector('.choice-new').click()"); await wait(350);
              await mainWindow.webContents.executeJavaScript(`(() => {
                const set=(el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));};
                const ins=document.querySelectorAll('.view-body .text-input');
                set(ins[0],'Prueba'); set(ins[2],'Escuela'); set(ins[3],'8');
                [...document.querySelectorAll('.seg-btn')].find(b=>b.textContent.trim()==='M').click();
                document.querySelector('.view-foot .btn-primary').click();
              })()`); await wait(350);
              await mainWindow.webContents.executeJavaScript(`(() => {
                const t=document.querySelector('.view-body .text-input'); if(t){t.value='Tutor';t.dispatchEvent(new Event('input',{bubbles:true}));}
                document.querySelector('.view-foot .btn-primary').click();
              })()`); await wait(350);
              const medTitle = await mainWindow.webContents.executeJavaScript("(document.querySelector('.view-head h2')||{}).textContent||''");
              const medLabels = await mainWindow.webContents.executeJavaScript("[...document.querySelectorAll('.med-row .checkbox span')].map(s=>s.textContent)");
              console.log('[smoke] medical screen title:', JSON.stringify(medTitle));
              console.log('[smoke] medical labels:', JSON.stringify(medLabels));
              if (!medLabels.length) hadError = true;
            }

            // Read station: load sim drive, confirm patient-context panels render.
            if (process.env.GDR_SMOKE_LOADSIM) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("var c=document.querySelector('.drive-chip.sim'); if(c) c.click();"); await wait(800);
              const panels = await mainWindow.webContents.executeJavaScript("[...document.querySelectorAll('.panel summary')].map(s=>s.textContent)");
              console.log('[smoke] context panels:', JSON.stringify(panels));
              if (panels.length < 2) hadError = true;
            }

            // Checkout "ending form": load sim drive, confirm the care checklist
            // is interactive (OH / cleaning / fluoride checkboxes) and toggles.
            if (process.env.GDR_SMOKE_CHECKOUT) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("var c=document.querySelector('.drive-chip.sim'); if(c) c.click();"); await wait(800);
              const boxes = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.care-checklist input[type=checkbox]').length");
              await mainWindow.webContents.executeJavaScript("var b=document.querySelector('.care-checklist input[type=checkbox]'); if(b) b.click();"); await wait(150);
              const firstChecked = await mainWindow.webContents.executeJavaScript("(document.querySelector('.care-checklist input[type=checkbox]')||{}).checked");
              console.log('[smoke] care-checklist checkboxes:', boxes);
              console.log('[smoke] first checkbox toggled to:', firstChecked);
              if (boxes < 5) hadError = true;
            }

            // Dentist chart (v1.3.2 item 1): the dentition-layout dropdown is GONE.
            // The chart always renders the hybrid dentition (adult 1-32 + primary
            // a-t = 52 teeth). Assert NO .chart-view-select is present, hybrid=52
            // teeth, and the health-status mode still tints a tooth on click.
            if (process.env.GDR_SMOKE_DENTIST) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              await mainWindow.webContents.executeJavaScript("var c=document.querySelector('.drive-chip.sim'); if(c) c.click();"); await wait(800);
              const selectorPresent = await mainWindow.webContents.executeJavaScript("!!document.querySelector('.chart-view-select')");
              const teeth = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.tooth').length");
              console.log('[smoke] chart selector present:', selectorPresent);
              console.log('[smoke] teeth (hybrid):', teeth);
              await mainWindow.webContents.executeJavaScript("var b=[...document.querySelectorAll('.chart-toolbar .seg-btn')].find(x=>/Health|salud/i.test(x.textContent)); if(b) b.click();"); await wait(200);
              await mainWindow.webContents.executeJavaScript("var t=document.querySelector('.tooth'); if(t){t.click();t.click();}"); await wait(200);
              const tinted = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.tooth.cond-healthy,.tooth.cond-watch,.tooth.cond-urgent').length");
              console.log('[smoke] health-tinted teeth after 2 clicks:', tinted);
              if (teeth !== 52 || selectorPresent) hadError = true;
            }

            // Permission slip (v1.3.3): the check-in consent screen must render
            // the clinic's real paper form — three opt-in care boxes that all
            // start UNTICKED, the child's name + Escuela autopopulated from the
            // registration screen, a phone field, and BOTH signing options (pad
            // + typed name). Also asserts the old draft text is gone.
            if (process.env.GDR_SMOKE_CONSENT_SLIP) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const js = (s) => mainWindow.webContents.executeJavaScript(s);
              // Start -> New patient (screenRegister is async: it awaits the
              // next patient number before rendering) -> registration -> slip.
              await js("(function(){var b=document.querySelector('.choice-btn.choice-new'); if(b) b.click(); return !!b;})()");
              await wait(900);
              const filled = await js(`(function(){
                var v=[...document.querySelectorAll('.text-input')];   // first, last, school, age
                if(v[0]) v[0].value='Juan';
                if(v[1]) v[1].value='Garcia';
                if(v[2]) v[2].value='Escuela Morelos';
                if(v[3]) v[3].value='9';
                v.forEach(function(x){ x.dispatchEvent(new Event('input')); });
                var sx=document.querySelector('.seg .seg-btn'); if(sx) sx.click();  // sex is segmented, not a <select>
                return { inputs: v.length, sex: !!sx };
              })()`);
              console.log('[smoke] consent slip registration:', JSON.stringify(filled));
              await wait(250);
              await js("(function(){var b=[...document.querySelectorAll('.btn-primary')].pop(); if(b) b.click();})()");
              await wait(600);
              const slip = await js(`(function(){
                var boxes=[...document.querySelectorAll('.consent-perms input[type=checkbox]')];
                var inputs=[...document.querySelectorAll('.consent-doc .text-input, .consent-fields .text-input')];
                var body=document.body.textContent||'';
                return {
                  perms: boxes.length,
                  allUnticked: boxes.every(function(b){return !b.checked;}),
                  labels: [...document.querySelectorAll('.consent-perms label')].map(function(l){return l.textContent.trim();}),
                  childAuto: (document.querySelectorAll('.consent-fields .text-input')[0]||{}).value||'',
                  schoolAuto: (document.querySelectorAll('.consent-fields .text-input')[1]||{}).value||'',
                  phone: !!document.querySelector('input[type=tel]'),
                  pad: !!document.querySelector('canvas'),
                  inlineName: !!document.querySelector('.consent-inline-input'),
                  draftGone: !/BORRADOR|pendiente del texto oficial/i.test(body)
                };
              })()`);
              console.log('[smoke] consent slip:', JSON.stringify(slip));
              if (slip.perms !== 3 || !slip.allUnticked || !slip.phone || !slip.pad || !slip.draftGone) hadError = true;
            }

            // Consent restrictions (v1.3.3): a parent who declines care must
            // produce a RED popup the clinician has to acknowledge before
            // charting, and a standing banner afterwards. Legacy records (no
            // per-item boxes) must stay SILENT. GDR_SMOKE_CONSENT_LIMITS is
            // 'none' | 'partial' | 'legacy' | 'all' and is stamped onto the sim
            // drive chart before the station loads it.
            if (process.env.GDR_SMOKE_CONSENT_LIMITS) {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const js = (s) => mainWindow.webContents.executeJavaScript(s);
              const mode = process.env.GDR_SMOKE_CONSENT_LIMITS;
              const simDir = paths.simDrive();
              const rd = drive.readPatient(simDir);
              if (rd.ok) {
                const p = rd.patient;
                p.consent = p.consent || {};
                p.consent.signed = true;
                p.consent.signatory_name = 'Tutor';
                // Legacy records predate the slip, so they carry no phone either.
                if (mode !== 'legacy') p.consent.phone = '555-0143';
                else delete p.consent.phone;
                if (mode === 'legacy') delete p.consent.permissions;
                else if (mode === 'all') p.consent.permissions = { cleaning: true, fillings: true, extractions: true };
                else if (mode === 'partial') p.consent.permissions = { cleaning: true, fillings: false, extractions: false };
                else p.consent.permissions = { cleaning: false, fillings: false, extractions: false };
                drive.writePatient(simDir, p);
              }
              await js("(function(){var c=document.querySelector('.drive-chip.sim'); if(c) c.click();})()");
              await wait(1200);
              const before = await js(`(function(){
                var box=document.querySelector('.modal-box.modal-danger');
                return {
                  modal: !!box,
                  chips: [...document.querySelectorAll('.modal-danger .consent-limit-chip')].map(function(c){return c.textContent.trim();}),
                  hasX: !!document.querySelector('.modal-danger .modal-close'),
                  ack: !!document.querySelector('.modal-danger .modal-actions .btn')
                };
              })()`);
              // A backdrop click must NOT dismiss this one.
              await js("(function(){var o=document.querySelector('.modal-overlay'); if(o) o.click();})()");
              await wait(250);
              const survived = await js("!!document.querySelector('.modal-box.modal-danger')");
              // Acknowledge, then the standing banner must remain on screen.
              await js("(function(){var b=document.querySelector('.modal-danger .modal-actions .btn'); if(b) b.click();})()");
              await wait(350);
              const after = await js(`(function(){
                var ph=document.querySelector('.summary-phone-value');
                return {
                  modal: !!document.querySelector('.modal-box.modal-danger'),
                  banner: !!document.querySelector('.consent-limit-banner'),
                  bannerChips: [...document.querySelectorAll('.consent-limit-banner .consent-limit-chip')].map(function(c){return c.textContent.trim();}),
                  chartable: !!document.querySelector('.tooth'),
                  phone: ph ? ph.textContent.trim() : null
                };
              })()`);
              console.log('[smoke] consent limits mode:', mode);
              console.log('[smoke] consent limits before:', JSON.stringify(before));
              console.log('[smoke] consent limits backdrop-survived:', survived);
              console.log('[smoke] consent limits after:', JSON.stringify(after));
            }

            // ====================================================================
            // E2E multi-station scaffolding (TEST-ONLY, env-gated). These probes
            // drive the REAL renderer UI (same DOM/clicks a clinician makes) so a
            // full station->station->checkout pass can be scripted, one launch per
            // station, with state carried on the sim drive + master DB on disk.
            // None of these alter non-test app behaviour.
            // ====================================================================
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const loadSim = async () => {
              await mainWindow.webContents.executeJavaScript("(function(){var c=document.querySelector('.drive-chip.sim'); if(c) c.click(); return !!c;})()");
              await wait(1100); // drive read + master merge + re-render
            };

            // --- ROOT-CAUSE PROBE (v1.1.6 fix): the stations now resolve the
            //     working visit with the RENDERER-LOCAL lastVisit() from util.js
            //     (no contextBridge crossing), so the returned visit is a LIVE
            //     reference into patient.visits[] and station edits persist. This
            //     probe (a) confirms the old bridge footgun
            //     window.api.model.lastVisit is GONE, and (b) loads the real
            //     util.js the views import and verifies a mutation propagates. ---
            if (process.env.GDR_SMOKE_BRIDGE) {
              const res = await mainWindow.webContents.executeJavaScript(`(async function(){
                var bridgeExposed = !!(window.api && window.api.model && window.api.model.lastVisit);
                var mod = await import('./util.js');                 // the exact module the views use
                var p = { id:'t', patient_number:1, visits:[ { visit_id:'v1', treatment_items:[] } ] };
                var v = mod.lastVisit(p);                            // renderer-local — no bridge
                v.treatment_items.push({ id:'x', tooth:'19' });      // mutate the returned visit
                return { bridgeExposed: bridgeExposed, returnedLen: v.treatment_items.length, patientLen: p.visits[0].treatment_items.length, same: v === p.visits[0] };
              })()`);
              console.log('[smoke] bridge lastVisit identity:', JSON.stringify(res));
              const live = res.patientLen === res.returnedLen && res.same === true;
              console.log('[smoke] bridge VERDICT:', live ? 'LIVE-REFERENCE (edits propagate)' : 'DETACHED-CLONE (edits LOST on write)');
              console.log('[smoke] bridge footgun removed:', res.bridgeExposed === false);
            }

            // --- DENTIST: add a treatment item through the chart modal, optionally
            //     toggle "fluoride recommended" off, then click Save to drive. ----
            // GDR_SMOKE_DENTIST_SAVE="<tooth>:<treatment_type>:<surfacesCSV>"
            //   e.g. "19:restoration:O,B"  (surfaces optional)
            if (process.env.GDR_SMOKE_DENTIST_SAVE) {
              const [tooth, ttype, surfCSV] = process.env.GDR_SMOKE_DENTIST_SAVE.split(':');
              const surfaces = (surfCSV || '').split(',').map((s) => s.trim()).filter(Boolean);
              const noFluoride = process.env.GDR_SMOKE_DENTIST_NOFLUORIDE === '1';
              await loadSim();
              const onEditor = await mainWindow.webContents.executeJavaScript("!!document.querySelector('.dentist-view')");
              console.log('[smoke] dentist editor loaded:', onEditor);
              // 1. exam type E (required to save)
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.dentist-view .seg-btn')].find(x=>/Exam|New|Nuevo|Examen|E\\b/.test(x.textContent)); if(b)b.click(); var e=[...document.querySelectorAll('.dentist-view .seg-btn')]; if(e[0])e[0].click();})()");
              await wait(200);
              // 2. open the target tooth -> modal
              const toothFound = await mainWindow.webContents.executeJavaScript(`(function(){var t=[...document.querySelectorAll('.tooth')].find(function(el){var id=el.querySelector('.tooth-id'); return id && id.textContent===${JSON.stringify(String(tooth))};}); if(t){t.click(); return true;} return false;})()`);
              await wait(450);
              console.log('[smoke] dentist tooth ' + JSON.stringify(String(tooth)) + ' opened:', toothFound, 'modal:', await mainWindow.webContents.executeJavaScript("!!document.querySelector('.modal-overlay')"));
              // 3. pick treatment type in the modal (match by data via T['tx_'+key]) — fall back to first seg
              await mainWindow.webContents.executeJavaScript(`(function(){
                var segs=[...document.querySelectorAll('.modal-overlay .tooth-editor .seg .seg-btn')];
                var map={restoration:/Restor|Amalgama|Restaur/i,extraction:/Extract|Extracc/i,sealant:/Sealant|Sellador/i,composite:/Composite|Resina|Compuesto/i,sdf:/SDF|Plata|Diamino/i};
                var re=map[${JSON.stringify(ttype)}];
                var b=re?segs.find(function(s){return re.test(s.textContent);}):null;
                (b||segs[0]||{click:function(){}}).click();
              })()`);
              await wait(200);
              // 4. surfaces
              for (const s of surfaces) {
                await mainWindow.webContents.executeJavaScript(`(function(){var b=[...document.querySelectorAll('.modal-overlay .surf-btn')].find(function(x){return x.textContent.trim()===${JSON.stringify(s)};}); if(b)b.click();})()`);
                await wait(80);
              }
              // 5. tick "mark complete" (last checkbox in the editor)
              await mainWindow.webContents.executeJavaScript("(function(){var boxes=[...document.querySelectorAll('.modal-overlay .editor-checks input[type=checkbox]')]; var c=boxes[boxes.length-1]; if(c && !c.checked){c.click();}})()");
              await wait(120);
              // 6. save the modal
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.modal-overlay .modal-actions .btn')].find(function(x){return /Save|Guardar/i.test(x.textContent);}); (b||{click:function(){}}).click();})()");
              await wait(350);
              const itemsAfter = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.today-list .today-item').length");
              const chartChips = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.tooth.tooth-has').length");
              console.log('[smoke] dentist items after chart edit:', itemsAfter, 'teeth-with-tx:', chartChips);
              if (noFluoride) {
                // untick the "Fluoride recommended" checkbox in the chart card
                const before = await mainWindow.webContents.executeJavaScript("(function(){var lab=[...document.querySelectorAll('.dentist-view .care-rec-row .checkbox, .dentist-view .checkbox')].find(function(l){return /Fluoride recommended|Fl.or recomendado/i.test(l.textContent);}); if(!lab)return 'no-label'; var cb=lab.querySelector('input[type=checkbox]'); var was=cb.checked; if(cb.checked){cb.click();} return String(was)+'->'+String(cb.checked);})()");
                console.log('[smoke] dentist fluoride_recommended toggle:', before);
                await wait(120);
              }
              // exam-state diagnostic: confirm an exam segment is active (save() bails without it)
              const examActive = await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.dentist-view .seg-btn.active')].map(function(x){return x.textContent.trim();}); return JSON.stringify(b);})()");
              console.log('[smoke] dentist active seg-btns before save:', examActive);
              // 7. Save to drive (real button)
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.dentist-view .view-foot .btn-primary')].find(function(x){return /Save to drive|Guardar/i.test(x.textContent);}); (b||{click:function(){}}).click();})()");
              await wait(1100); // write + merge + alert dialog
              const dlg = await mainWindow.webContents.executeJavaScript("(function(){var t=document.querySelector('.modal-overlay .modal-title'); var b=document.querySelector('.modal-overlay .modal-body'); return JSON.stringify({title:t?t.textContent:null, body:b?b.textContent:null});})()");
              console.log('[smoke] dentist post-save dialog:', dlg);
              // dismiss the "saved" alert if present
              await mainWindow.webContents.executeJavaScript("(function(){var b=document.querySelector('.modal-overlay .modal-actions .btn-primary'); if(b)b.click();})()");
              await wait(400);
              if (!itemsAfter) hadError = true;
              console.log('[smoke] DENTIST_SAVE done (items=' + itemsAfter + ')');
            }

            // --- DOWNSTREAM PANEL: at cleaning/fluoride/checkout, load sim drive
            //     and read the "Treatment this visit (N)" panel the dentist fed. -
            if (process.env.GDR_SMOKE_PANEL) {
              await loadSim();
              // cleaning/fluoride show a collapsible "Treatment this visit (N)" panel;
              // checkout shows the same treatment under a "Treatment plan" card. Capture
              // both so any downstream station can be asserted N>0.
              const panelTxt = await mainWindow.webContents.executeJavaScript("(function(){var s=[...document.querySelectorAll('.panel summary')].find(function(x){return /Treatment this visit|Tratamiento de esta visita/i.test(x.textContent);}); return s?s.textContent:'';})()");
              const panelN = await mainWindow.webContents.executeJavaScript("(function(){var s=[...document.querySelectorAll('.panel summary')].find(function(x){return /Treatment this visit|Tratamiento de esta visita/i.test(x.textContent);}); if(!s)return -1; var m=s.textContent.match(/\\((\\d+)\\)/); return m?Number(m[1]):-1;})()");
              // total treatment code chips visible anywhere in the view (panel or card)
              const chips = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.code-chip').length");
              const txTotal = await mainWindow.webContents.executeJavaScript("(function(){var r=document.querySelector('.tx-sum-total .tx-sum-n'); return r?r.textContent:'';})()");
              // unified count: panel N if present, else parse the tx-summary total's denominator
              const effectiveN = await mainWindow.webContents.executeJavaScript("(function(){var s=[...document.querySelectorAll('.panel summary')].find(function(x){return /Treatment this visit|Tratamiento de esta visita/i.test(x.textContent);}); if(s){var m=s.textContent.match(/\\((\\d+)\\)/); if(m)return Number(m[1]);} var r=document.querySelector('.tx-sum-total .tx-sum-n'); if(r){var mm=r.textContent.match(/\\/(\\d+)/); if(mm)return Number(mm[1]);} return -1;})()");
              console.log('[smoke] panel summary:', JSON.stringify(panelTxt));
              console.log('[smoke] panel treatment count N:', panelN);
              console.log('[smoke] panel code chips:', chips);
              console.log('[smoke] panel tx-summary total (done/total):', JSON.stringify(txTotal));
              console.log('[smoke] panel effective treatment N:', effectiveN);
              if (effectiveN <= 0) hadError = true;
            }

            // --- CLEANING station: load sim drive, click "mark cleaning complete",
            //     then Save to drive. ---------------------------------------------
            if (process.env.GDR_SMOKE_CLEANING_SAVE) {
              await loadSim();
              const onView = await mainWindow.webContents.executeJavaScript("!!document.querySelector('.cleaning-view')");
              console.log('[smoke] cleaning view loaded:', onView);
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.cleaning-view .btn-primary')].find(function(x){return /complete|Completa|Marcar/i.test(x.textContent) && !/drive|Guardar/i.test(x.textContent);}); if(b)b.click();})()");
              await wait(300);
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.cleaning-view .view-foot .btn-primary')].find(function(x){return /Save to drive|Guardar/i.test(x.textContent);}); if(b)b.click();})()");
              await wait(1000);
              await mainWindow.webContents.executeJavaScript("(function(){var b=document.querySelector('.modal-overlay .modal-actions .btn-primary'); if(b)b.click();})()");
              await wait(400);
              console.log('[smoke] CLEANING_SAVE done');
            }

            // --- FLUORIDE station: load sim drive, tick OH3 + fluoride done,
            //     then Save to drive. ---------------------------------------------
            if (process.env.GDR_SMOKE_FLUORIDE_SAVE) {
              await loadSim();
              const onView = await mainWindow.webContents.executeJavaScript("!!document.querySelector('.fluoride-view')");
              console.log('[smoke] fluoride view loaded:', onView);
              const boxes = await mainWindow.webContents.executeJavaScript("(function(){[...document.querySelectorAll('.fluoride-view .big-checks input[type=checkbox]')].forEach(function(c){if(!c.checked)c.click();}); return document.querySelectorAll('.fluoride-view .big-checks input[type=checkbox]').length;})()");
              console.log('[smoke] fluoride checkboxes ticked:', boxes);
              await wait(200);
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.fluoride-view .view-foot .btn-primary')].find(function(x){return /Save to drive|Guardar/i.test(x.textContent);}); if(b)b.click();})()");
              await wait(1000);
              await mainWindow.webContents.executeJavaScript("(function(){var b=document.querySelector('.modal-overlay .modal-actions .btn-primary'); if(b)b.click();})()");
              await wait(400);
              console.log('[smoke] FLUORIDE_SAVE done');
            }

            // --- CHECKOUT MARKS: load sim drive, tick care-checklist boxes
            //     (cleaning/fluoride/OH), choose outcome, click Upload to master. -
            // GDR_SMOKE_CHECKOUT_MARKS="cleaning,fluoride,oh"  (any subset)
            // GDR_SMOKE_CHECKOUT_OUTCOME="F" | "NV"  (default F)
            if (process.env.GDR_SMOKE_CHECKOUT_MARKS) {
              const want = process.env.GDR_SMOKE_CHECKOUT_MARKS.split(',').map((s) => s.trim()).filter(Boolean);
              const outcome = process.env.GDR_SMOKE_CHECKOUT_OUTCOME || 'F';
              await loadSim();
              const boxes0 = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.care-checklist input[type=checkbox]').length");
              console.log('[smoke] checkout care-checklist checkboxes:', boxes0);
              // Tick cleaning "Completed" (row labelled Cleaning) / fluoride "Completed" / all OH boxes.
              if (want.includes('cleaning')) {
                await mainWindow.webContents.executeJavaScript("(function(){var rows=[...document.querySelectorAll('.care-checklist .cc-row')]; var r=rows.find(function(x){return /Cleaning|Limpieza/i.test(x.textContent);}); if(r){var cb=r.querySelector('input[type=checkbox]'); if(cb && !cb.checked)cb.click();}})()");
                await wait(120);
              }
              if (want.includes('fluoride')) {
                await mainWindow.webContents.executeJavaScript("(function(){var rows=[...document.querySelectorAll('.care-checklist .cc-row')]; var r=rows.find(function(x){return /Fluoride|Fl.or/i.test(x.textContent);}); if(r){var cb=r.querySelector('input[type=checkbox]'); if(cb && !cb.checked)cb.click();}})()");
                await wait(120);
              }
              if (want.includes('oh')) {
                await mainWindow.webContents.executeJavaScript("(function(){var rows=[...document.querySelectorAll('.care-checklist .cc-row')]; var r=rows.find(function(x){return /OH/.test(x.textContent) && !/Cleaning|Fluoride|Limpieza|Fl.or/i.test(x.textContent);}); if(r){[...r.querySelectorAll('input[type=checkbox]')].forEach(function(cb){if(!cb.checked)cb.click();});}})()");
                await wait(150);
              }
              const checkedNow = await mainWindow.webContents.executeJavaScript("[...document.querySelectorAll('.care-checklist input[type=checkbox]')].map(function(c){return c.checked;})");
              console.log('[smoke] checkout checkbox states after ticking:', JSON.stringify(checkedNow));
              // choose outcome
              await mainWindow.webContents.executeJavaScript(`(function(){var b=[...document.querySelectorAll('.checkout-process .seg-lg .seg-btn')].find(function(x){return ${outcome === 'NV' ? '/Next|NV|próxima|proxima/i' : '/Finished|Terminado|Finalizado|F\\b/i'}.test(x.textContent);}); if(!b){var all=[...document.querySelectorAll('.checkout-process .seg-lg .seg-btn')]; b=${outcome === 'NV' ? 'all[1]' : 'all[0]'};} if(b)b.click();})()`);
              await wait(150);
              // click Upload to master
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.checkout-process .upload-card .btn-primary')].find(function(x){return /Upload|Subir|master|maestra/i.test(x.textContent);}); (b||{click:function(){}}).click();})()");
              await wait(900);
              const statusTxt = await mainWindow.webContents.executeJavaScript("(function(){var s=document.querySelector('.process-status'); return s?s.textContent:'';})()");
              const clearEnabled = await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.checkout-process .btn-danger')].find(function(x){return /Clear|Limpiar|Vaciar/i.test(x.textContent);}); return b? !b.hasAttribute('disabled'):false;})()");
              console.log('[smoke] checkout upload status:', JSON.stringify(statusTxt));
              console.log('[smoke] checkout clear-drive enabled after upload:', clearEnabled);
              if (!statusTxt) hadError = true;
              console.log('[smoke] CHECKOUT_MARKS done');
            }

            // --- REPORTS: open the Reports tab (admin/checkout), click "All time",
            //     and read the treatment summary table straight from the running UI
            //     (this reads the REAL master DB via IPC, not a node tmpdir copy). -
            if (process.env.GDR_SMOKE_REPORTS) {
              await mainWindow.webContents.executeJavaScript("(function(){var t=[...document.querySelectorAll('.tab')].find(function(x){return /Reports|Reportes|Informes/i.test(x.textContent);}); if(t)t.click();})()");
              await wait(500);
              await mainWindow.webContents.executeJavaScript("(function(){var b=[...document.querySelectorAll('.preset-row .btn')].find(function(x){return /All time|Todo|Siempre/i.test(x.textContent);}); if(b)b.click();})()");
              await wait(700);
              const table = await mainWindow.webContents.executeJavaScript("(function(){var rows=[...document.querySelectorAll('.report-table tbody tr')]; return JSON.stringify(rows.map(function(r){var c=r.querySelectorAll('td'); return [c[0]?c[0].textContent:'', c[1]?c[1].textContent:''];}));})()");
              const dbCount = await mainWindow.webContents.executeJavaScript("(function(){var b=document.querySelector('.count-badge'); return b?b.textContent:'';})()");
              console.log('[smoke] reports table:', table);
              console.log('[smoke] reports db patient count badge:', JSON.stringify(dbCount));
              const nonzero = await mainWindow.webContents.executeJavaScript("document.querySelectorAll('.report-table tbody tr:not(.row-zero)').length");
              console.log('[smoke] reports non-zero rows:', nonzero);
            }
          }
        } catch (e) { hadError = true; console.error('[smoke] eval failed', e); }
        console.log(hadError ? '[smoke] LAUNCH FAILED' : '[smoke] LAUNCH OK');
        app.exit(hadError ? 1 : 0);
      }, 1500);
    });
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  setupAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---- Auto-update (electron-updater + GitHub Releases) -------------------
// Checks the public GitHub repo's releases for a newer version, downloads it,
// and (via the admin Settings page) lets the user install + restart. Status is
// forwarded to the renderer. Only active in the packaged, installed app.
let autoUpdater = null;
let updateState = { status: 'idle', version: null, percent: 0, error: null, current: null, portable: false };
const RELEASES_URL = 'https://github.com/oofski/Global-Dental-Relief-/releases/latest';

// The portable target runs as a single self-extracting .exe and CANNOT apply an
// in-place update (electron-updater needs the NSIS-installed app). Detect it so
// we can tell the user clearly instead of failing silently. electron-builder
// sets PORTABLE_EXECUTABLE_DIR/FILE in the portable runtime environment.
function isPortable() {
  return !!(process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE);
}

function updaterAvailable() {
  return !!(app.isPackaged && !isDev && !process.env.GDR_SMOKE_LAUNCH && !isPortable());
}

// Persist updater activity to a log file (userData/update.log) so a clinic can
// send it to us if an update ever fails — there is no other way to see why.
function updateLog(level, msg) {
  const line = `[${new Date().toISOString()}] ${level} ${msg}`;
  try { console.log('[updater]', level, msg); } catch (_) {}
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), line + '\n'); } catch (_) {}
}
const updaterLogger = {
  info: (m) => updateLog('INFO', m),
  warn: (m) => updateLog('WARN', m),
  error: (m) => updateLog('ERROR', m),
  debug: () => {}
};

function pushUpdateStatus(patch) {
  updateState = Object.assign({}, updateState, patch);
  if (!updateState.current) { try { updateState.current = app.getVersion(); } catch (_) {} }
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send('update:status', updateState); } catch (_) {}
  }
}

function getUpdater() {
  if (autoUpdater) return autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); }
  catch (e) { updateLog('ERROR', 'electron-updater not loadable: ' + e); return null; }
  autoUpdater.logger = updaterLogger;
  autoUpdater.autoDownload = true;            // download as soon as one is found
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => pushUpdateStatus({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => pushUpdateStatus({ status: 'available', version: info && info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => pushUpdateStatus({ status: 'up-to-date' }));
  autoUpdater.on('download-progress', (p) => pushUpdateStatus({ status: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => pushUpdateStatus({ status: 'downloaded', version: info && info.version, percent: 100 }));
  autoUpdater.on('error', (err) => pushUpdateStatus({ status: 'error', error: String(err && err.message ? err.message : err) }));
  return autoUpdater;
}

function setupAutoUpdate() {
  try { updateState.current = app.getVersion(); } catch (_) {}
  // Portable build: surface a clear "use the installer" state rather than erroring.
  if (app.isPackaged && !isDev && !process.env.GDR_SMOKE_LAUNCH && isPortable()) {
    updateLog('WARN', 'running portable build — auto-update unavailable');
    pushUpdateStatus({ status: 'portable', portable: true });
    return;
  }
  if (!updaterAvailable()) return;
  const u = getUpdater();
  if (!u) { pushUpdateStatus({ status: 'error', error: 'updater_unavailable' }); return; }
  try {
    // Give the network a moment after launch, then check; re-check periodically.
    setTimeout(() => { u.checkForUpdates().catch((err) => pushUpdateStatus({ status: 'error', error: String(err && err.message || err) })); }, 4000);
    setInterval(() => { u.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
  } catch (e) { updateLog('ERROR', 'setupAutoUpdate ' + e); }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC contract -------------------------------------------------------
function ok(data) { return { ok: true, data }; }
function fail(error, detail) { return { ok: false, error, detail }; }

// Localized strings for native dialogs (titles shown by the OS file picker).
function uiText(key) {
  const lang = (config.load().ui_language) || 'en';
  const M = {
    en: { pick_folder: 'Select drive / folder', import_master: 'Import master database' },
    es: { pick_folder: 'Seleccionar dispositivo / carpeta', import_master: 'Importar base de datos maestra' }
  };
  return (M[lang] || M.en)[key];
}

// Non-secret config exposed to the renderer (no PINs).
function publicConfig() {
  const c = config.load();
  return {
    clinic_name: c.clinic_name,
    deployment_label: c.deployment_label,
    patient_number_start: c.patient_number_start,
    ui_language: c.ui_language || 'en',
    report_language: c.report_language || 'es',
    consent_language: c.consent_language || 'es'
  };
}

function requireAdmin() { return !!(session && session.manage_users); }
// Roles that manage the patient ledger (front desk, checkout, admin).
function requireRecordsAccess() { return !!(session && ['check_in', 'checkout', 'admin'].includes(session.role)); }

function registerIpc() {
  // --- Auth / session ---
  ipcMain.handle('auth:login', (_e, { username, password }) => {
    const res = users.authenticate(username, password);
    if (res.ok) session = res.user;
    return res;
  });
  ipcMain.handle('auth:logout', () => { session = null; return ok(true); });

  // --- User accounts (admin portal) ---
  ipcMain.handle('users:roles', () => ok(users.roles()));
  ipcMain.handle('users:list', () => (requireAdmin() ? ok(users.list()) : fail('forbidden')));
  ipcMain.handle('users:create', (_e, payload) => (requireAdmin() ? users.create(payload || {}) : fail('forbidden')));
  ipcMain.handle('users:update', (_e, { id, changes }) => (requireAdmin() ? users.update(id, changes || {}) : fail('forbidden')));
  ipcMain.handle('users:changePassword', (_e, { id, password }) => (requireAdmin() ? users.changePassword(id, password) : fail('forbidden')));
  ipcMain.handle('users:remove', (_e, id) => (requireAdmin() ? users.remove(id) : fail('forbidden')));

  // --- Config ---
  ipcMain.handle('config:get', () => publicConfig());
  // Synchronous channel: the preload reads this during page load so the renderer
  // can pick its UI language before any module evaluates (no flash, no async).
  ipcMain.on('config:get-sync', (e) => { e.returnValue = publicConfig(); });
  ipcMain.handle('config:save', (_e, patch) => {
    if (!requireAdmin()) return fail('forbidden');
    try {
      const c = config.load();
      const allowed = ['clinic_name', 'deployment_label', 'patient_number_start', 'ui_language', 'report_language', 'consent_language'];
      for (const k of allowed) { if (patch && patch[k] != null && patch[k] !== '') c[k] = patch[k]; }
      if (patch && patch.deployment_label != null) c.deployment_label = patch.deployment_label; // allow clearing
      config.save(c);
      return ok(publicConfig());
    } catch (e) { return fail('save_failed', String(e.message || e)); }
  });

  // --- Software updates (admin Settings) ---
  ipcMain.handle('update:available', () => ok(updaterAvailable()));
  ipcMain.handle('update:state', () => ok(updateState));
  ipcMain.handle('update:check', () => {
    if (!updaterAvailable()) return fail('updates_unavailable');
    const u = getUpdater();
    if (!u) return fail('updates_unavailable');
    pushUpdateStatus({ status: 'checking', error: null });
    u.checkForUpdates().catch((err) => pushUpdateStatus({ status: 'error', error: String(err && err.message || err) }));
    return ok(true);
  });
  ipcMain.handle('update:install', () => {
    if (!updaterAvailable() || !autoUpdater) return fail('updates_unavailable');
    updateLog('INFO', 'user requested install & restart');
    // isSilent=false (show the NSIS step), isForceRunAfter=true (relaunch the app).
    setImmediate(() => { try { autoUpdater.quitAndInstall(false, true); } catch (e) { updateLog('ERROR', 'quitAndInstall ' + e); } });
    return ok(true);
  });
  // Open the GitHub Releases page (used by the portable build, which can't self-update).
  ipcMain.handle('update:openReleases', () => {
    try { shell.openExternal(RELEASES_URL); return ok(true); } catch (e) { return fail('open_failed', String(e.message || e)); }
  });

  // --- Master DB ---
  ipcMain.handle('db:nextNumber', () => ok(db.peekNextNumber()));
  ipcMain.handle('db:createPatient', (_e, fields) => {
    try { return ok(db.createPatient(fields)); }
    catch (e) { return fail('create_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:savePatient', (_e, patient) => {
    try { return ok(db.savePatient(patient)); }
    catch (e) { return fail('save_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:uploadPatient', (_e, patient) => {
    try { return ok(db.uploadPatient(patient)); }
    catch (e) { return fail('upload_failed', String(e.message || e)); }
  });
  // Stations merge their work into the master record (no checkout stamp) so it
  // accumulates + shows in reports/checkout immediately. Any logged-in role.
  ipcMain.handle('db:mergeFromDrive', (_e, patient) => {
    if (!session) return fail('forbidden');
    try { return ok(db.mergeFromDrive(patient)); }
    catch (e) { return fail('merge_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:getPatient', (_e, id) => ok(db.getPatient(id)));
  ipcMain.handle('db:getPatientByNumber', (_e, num) => ok(db.getPatientByNumber(num)));
  ipcMain.handle('db:search', (_e, q) => ok(db.searchPatients(q)));
  ipcMain.handle('db:listNV', () => ok(db.listNV()));
  ipcMain.handle('db:listDrives', () => ok(db.listDrives()));
  ipcMain.handle('db:logDrive', (_e, { num, status, patientId }) => ok(db.logDrive(num, status, patientId)));
  ipcMain.handle('db:count', () => ok(db.allPatients().length));
  // Clear the patient ledger (front desk / checkout / admin). Auto-backs up first.
  ipcMain.handle('db:clearAll', (_e, opts) => {
    if (!requireRecordsAccess()) return fail('forbidden');
    try {
      const before = db.allPatients().length;
      let backupFile = null;
      if (before > 0) { try { backupFile = reports.exportMasterJSON(); } catch (_) { /* best-effort */ } }
      const res = db.clearAllPatients(opts || {});
      return ok({ removed: res.removed, counter: res.counter, backupFile });
    } catch (e) { return fail('clear_failed', String(e.message || e)); }
  });

  // --- Flash drive ---
  ipcMain.handle('drive:list', async () => ok(await drive.listDrives()));
  ipcMain.handle('drive:status', (_e, p) => ok(drive.driveStatus(p)));
  ipcMain.handle('drive:read', (_e, p) => drive.readPatient(p));
  ipcMain.handle('drive:write', (_e, { drivePath, patient }) => {
    // TEST-ONLY diagnostic (env-gated): log what the renderer is actually asking
    // to persist, so an E2E run can prove the in-memory edits reach the drive.
    if (process.env.GDR_SMOKE_LAUNCH) {
      try {
        const vs = (patient && patient.visits) || [];
        const lv = vs[vs.length - 1] || {};
        console.log('[smoke] IPC drive:write last-visit items=' + ((lv.treatment_items || []).length) + ' exam=' + lv.exam_type + ' dentist=' + (lv.station_status && lv.station_status.dentist));
      } catch (_) {}
    }
    return drive.writePatient(drivePath, patient);
  });
  ipcMain.handle('drive:clear', (_e, p) => drive.clearDrive(p));
  ipcMain.handle('drive:pickFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: uiText('pick_folder'),
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return ok(null);
    return ok(res.filePaths[0]);
  });

  // --- Reports / export ---
  ipcMain.handle('report:stats', (_e, range) => ok(reports.computeStats(range || {})));
  ipcMain.handle('report:exportSummary', async (_e, { format, range }) => {
    try {
      const stats = reports.computeStats(range || {});
      let file;
      if (format === 'xlsx') {
        const r = await reports.exportSummaryXLSX(stats);
        if (r && r.error) return fail(r.error);
        file = r;
      } else {
        file = reports.exportSummaryCSV(stats);
      }
      return ok({ file, stats });
    } catch (e) { return fail('export_failed', String(e.message || e)); }
  });
  ipcMain.handle('report:exportMaster', (_e, { format }) => {
    if (!requireRecordsAccess()) return fail('forbidden');
    try {
      const file = format === 'csv' ? reports.exportMasterCSV() : reports.exportMasterJSON();
      return ok({ file });
    } catch (e) { return fail('export_failed', String(e.message || e)); }
  });
  ipcMain.handle('db:importMaster', async () => {
    if (!requireRecordsAccess()) return fail('forbidden');
    const res = await dialog.showOpenDialog(mainWindow, {
      title: uiText('import_master'),
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePaths.length) return ok(null);
    try {
      const text = fs.readFileSync(res.filePaths[0], 'utf8');
      return ok(db.importMaster(text));
    } catch (e) { return fail('import_failed', String(e.message || e)); }
  });

  // --- Shell helpers ---
  ipcMain.handle('shell:openPath', (_e, p) => { shell.showItemInFolder(p); return ok(true); });
  ipcMain.handle('shell:exportsDir', () => ok(paths.exports()));
  ipcMain.handle('app:info', () => ok({ version: app.getVersion(), platform: process.platform, dataDir: paths.base() }));
}
