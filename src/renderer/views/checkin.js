/* Check-In station (spec 5.1, 7.1, 7.2). */
import { h, mount, field, checkbox, toast, alertDialog, fmtDate, spinner } from '../util.js';
import { T } from '../i18n/es.js';
import { medForm } from '../components/medform.js';
import { signaturePad } from '../components/signature.js';
import { tts } from '../components/tts.js';
import { CONSENT_TITLE, CONSENT_DRAFT_NOTICE, CONSENT_PARAGRAPHS, consentSpeechText } from '../consent.js';

export function renderCheckin(container, ctx) {
  const W = {
    mode: null,            // 'new' | 'returning'
    draft: { school_group: '', first_name: '', last_name: '', age: '', sex: '' },
    consent: { signed: false, signatory_name: '', signature_image: null },
    med: window.api.model.newMedicalHistory(),
    oh1: false,
    drive_number: '',
    drivePath: null,
    existing: null,        // loaded returning patient
    medChanged: false,
    nextNumber: null
  };

  function shell(title, bodyNodes, footer) {
    mount(container,
      h('div', { class: 'view checkin-view' }, [
        h('div', { class: 'view-head' }, [h('h2', { text: title })]),
        h('div', { class: 'view-body' }, bodyNodes),
        footer ? h('div', { class: 'view-foot' }, footer) : null
      ])
    );
  }

  // ---- Screen A: New vs Returning ----
  function screenStart() {
    W.mode = null;
    shell(T.checkin_title, [
      h('div', { class: 'big-choice' }, [
        h('button', { class: 'choice-btn choice-new', onClick: screenRegister }, [
          h('span', { class: 'choice-icon', text: '➕' }),
          h('span', { text: T.new_patient })
        ]),
        h('button', { class: 'choice-btn choice-ret', onClick: screenSearch }, [
          h('span', { class: 'choice-icon', text: '🔍' }),
          h('span', { text: T.existing_patient })
        ])
      ])
    ]);
  }

  // ---- Screen B: Registration (new) ----
  async function screenRegister() {
    W.mode = 'new';
    const nn = await window.api.db.nextNumber();
    W.nextNumber = nn.ok ? nn.data : null;

    const fName = h('input', { class: 'text-input', value: W.draft.first_name });
    const lName = h('input', { class: 'text-input', value: W.draft.last_name });
    const school = h('input', { class: 'text-input', value: W.draft.school_group });
    const age = h('input', { class: 'text-input', type: 'number', min: '0', max: '120', value: W.draft.age });
    const sexSel = segmented([{ v: 'M', label: T.male }, { v: 'F', label: T.female }], W.draft.sex, (v) => { W.draft.sex = v; });

    function commit() {
      W.draft.first_name = fName.value.trim();
      W.draft.last_name = lName.value.trim();
      W.draft.school_group = school.value.trim();
      W.draft.age = age.value;
      if (!W.draft.first_name) { toast(T.first_name + ' — ' + T.required, 'warn'); return false; }
      if (!W.draft.school_group) { toast(T.school_group + ' — ' + T.required, 'warn'); return false; }
      if (!W.draft.age) { toast(T.age + ' — ' + T.required, 'warn'); return false; }
      if (!W.draft.sex) { toast(T.sex + ' — ' + T.required, 'warn'); return false; }
      return true;
    }

    shell(T.registration, [
      h('div', { class: 'assigned-banner' }, [
        h('span', { text: T.assigned_number + ': ' }),
        h('strong', { class: 'big-number', text: `#${W.nextNumber ?? '—'}` })
      ]),
      h('div', { class: 'form-grid' }, [
        field(T.first_name, fName, { required: true }),
        field(T.last_name, lName, { hint: T.optional }),
        field(T.school_group, school, { required: true }),
        field(T.age, age, { required: true }),
        field(T.sex, sexSel, { required: true })
      ])
    ], [
      h('button', { class: 'btn btn-ghost', onClick: screenStart }, T.back),
      h('button', { class: 'btn btn-primary', onClick: () => { if (commit()) screenConsent(); } }, T.next)
    ]);
  }

  // ---- Screen C: Consent (new) ----
  function screenConsent() {
    let reading = false;
    const sig = signaturePad((dataURL) => { W.consent.signature_image = dataURL; });
    const typedName = h('input', { class: 'text-input', placeholder: T.typed_name, value: W.consent.signatory_name });
    typedName.addEventListener('input', () => { W.consent.signatory_name = typedName.value.trim(); });

    const readBtn = h('button', { class: 'btn btn-secondary' });
    function setReadLabel() { readBtn.textContent = reading ? T.stop_reading : T.read_aloud; }
    setReadLabel();
    readBtn.addEventListener('click', () => {
      if (reading) { tts.stop(); reading = false; setReadLabel(); return; }
      const ok = tts.speak(consentSpeechText(), { onend: () => { reading = false; setReadLabel(); } });
      if (!ok) { toast('TTS no disponible', 'warn'); return; }
      reading = true; setReadLabel();
    });

    const consentBody = h('div', { class: 'consent-doc' }, [
      h('div', { class: 'consent-draft-notice', text: CONSENT_DRAFT_NOTICE }),
      h('h3', { text: CONSENT_TITLE }),
      ...CONSENT_PARAGRAPHS.map((p) => h('p', { text: p }))
    ]);

    function commit() {
      const hasSig = !!W.consent.signature_image;
      const hasName = !!(typedName.value && typedName.value.trim());
      if (!hasSig && !hasName) { toast(T.consent_required, 'warn'); return false; }
      W.consent.signed = true;
      W.consent.signatory_name = typedName.value.trim();
      W.consent.signed_date = window.api.model.nowISO();
      return true;
    }

    shell(T.consent_title, [
      h('div', { class: 'consent-toolbar' }, [readBtn]),
      consentBody,
      h('div', { class: 'consent-sign' }, [
        h('div', { class: 'field-label', text: T.signature }),
        sig.node,
        field(T.typed_name, typedName)
      ])
    ], [
      h('button', { class: 'btn btn-ghost', onClick: () => { tts.stop(); screenRegister(); } }, T.back),
      h('button', { class: 'btn btn-primary', onClick: () => { if (commit()) { tts.stop(); screenMedical(); } } }, T.next)
    ]);
  }

  // ---- Screen D: Medical history ----
  function screenMedical() {
    const form = medForm(W.med);
    shell(T.medical_history, [
      W.mode === 'returning' ? h('div', { class: 'info-banner', text: T.med_anything_changed }) : null,
      form
    ], [
      h('button', { class: 'btn btn-ghost', onClick: () => W.mode === 'new' ? screenConsent() : screenSearch() }, T.back),
      h('button', { class: 'btn btn-primary', onClick: screenDrive }, T.next)
    ]);
  }

  // ---- Screen E: Drive assignment + write ----
  function screenDrive() {
    const driveNum = h('input', { class: 'text-input', type: 'number', min: '1', placeholder: T.drive_number, value: W.drive_number });
    driveNum.addEventListener('input', () => { W.drive_number = driveNum.value; });
    const oh1 = checkbox(T.oh1_label, W.oh1, (v) => { W.oh1 = v; });

    const driveStatusEl = h('div', { class: 'drive-pick-status muted', text: T.insert_drive });
    let drivePath = W.drivePath;

    async function loadDrives() {
      const res = await window.api.drive.list();
      const drives = (res.ok ? res.data : []) || [];
      mount(driveListEl, ...drives.map((d) =>
        h('button', {
          class: 'drive-chip' + (drivePath === d.path ? ' active' : '') + (d.simulated ? ' sim' : ''),
          onClick: () => { drivePath = d.path; W.drivePath = d.path; loadDrives(); driveStatusEl.textContent = d.path; }
        }, [
          h('span', { class: 'drive-icon', text: d.simulated ? '🧪' : '💾' }),
          h('span', { class: 'drive-label', text: d.label }),
          h('span', { class: 'drive-path', text: d.path })
        ])
      ));
      if (!drives.length) mount(driveListEl, h('div', { class: 'muted', text: T.no_drives }));
    }
    const driveListEl = h('div', { class: 'drive-list' });

    async function pickFolder() {
      const r = await window.api.drive.pickFolder();
      if (r.ok && r.data) { drivePath = r.data; W.drivePath = r.data; driveStatusEl.textContent = r.data; loadDrives(); }
    }

    async function finalize() {
      const dnum = parseInt(driveNum.value, 10);
      if (!dnum) { toast(T.drive_number + ' — ' + T.required, 'warn'); return; }
      if (!drivePath) { toast(T.select_drive, 'warn'); return; }

      mount(container, h('div', { class: 'view' }, [spinner(T.loading)]));
      try {
        let patient;
        if (W.mode === 'new') {
          const created = await window.api.db.createPatient({
            school_group: W.draft.school_group,
            first_name: W.draft.first_name,
            last_name: W.draft.last_name,
            age_at_first_visit: parseInt(W.draft.age, 10),
            sex: W.draft.sex,
            drive_number: dnum
          });
          if (!created.ok) { toast(T.error, 'error'); screenDrive(); return; }
          patient = created.data;
          patient.consent = {
            signed: W.consent.signed,
            signatory_name: W.consent.signatory_name,
            signature_image: W.consent.signature_image,
            signed_date: W.consent.signed_date
          };
          patient.medical_history = W.med;
        } else {
          patient = W.existing;
          patient.drive_number = dnum;
          if (W.medChanged) stampMedUpdate(patient.medical_history);
          patient.medical_history = W.med;
        }

        // Create the blank visit shell (dentist fills exam/treatment later).
        const visit = window.api.model.newVisit(patient);
        visit.oh1_done = W.oh1;
        visit.station_status.checkin = true;
        patient.visits = patient.visits || [];
        patient.visits.push(visit);

        const saved = await window.api.db.savePatient(patient);
        if (!saved.ok) { toast(T.error, 'error'); return; }
        patient = saved.data;

        const write = await window.api.drive.write(drivePath, patient);
        if (!write.ok) {
          await alertDialog(T.error, `${T.error}: ${write.reason}${write.detail ? ' — ' + write.detail : ''}`);
          screenDrive();
          return;
        }
        await window.api.db.logDrive(dnum, 'in_use', patient.id);
        screenConfirm(patient, dnum);
      } catch (e) {
        await alertDialog(T.error, String(e.message || e));
        screenStart();
      }
    }

    shell(T.drive_assign_title, [
      W.mode === 'returning' ? patientMiniCard(W.existing) : h('div', { class: 'assigned-banner' }, [
        h('span', { text: T.assigned_number + ': ' }),
        h('strong', { class: 'big-number', text: `#${W.nextNumber ?? '—'}` })
      ]),
      h('div', { class: 'card' }, [
        field(T.drive_assign_hint, driveNum, { required: true }),
        h('div', { class: 'drive-head' }, [
          h('strong', { text: T.select_drive }),
          h('div', { class: 'drive-actions' }, [
            h('button', { class: 'btn btn-ghost btn-sm', onClick: loadDrives }, '↻ ' + T.refresh),
            h('button', { class: 'btn btn-ghost btn-sm', onClick: pickFolder }, T.pick_folder)
          ])
        ]),
        driveListEl,
        driveStatusEl
      ]),
      h('div', { class: 'card' }, [oh1])
    ], [
      h('button', { class: 'btn btn-ghost', onClick: screenMedical }, T.back),
      h('button', { class: 'btn btn-primary btn-lg', onClick: finalize }, T.create_and_write)
    ]);
    loadDrives();
  }

  // ---- Confirmation ----
  function screenConfirm(patient, dnum) {
    shell(T.checkin_title, [
      h('div', { class: 'confirm-box' }, [
        h('div', { class: 'confirm-check', text: '✅' }),
        h('div', { class: 'confirm-msg', text: T.patient_created.replace('{n}', dnum) }),
        patientMiniCard(patient)
      ])
    ], [
      h('button', { class: 'btn btn-primary btn-lg', onClick: () => { resetWizard(); screenStart(); } }, T.new_patient + ' / ' + T.existing_patient)
    ]);
  }

  // ---- Returning patient search (Screen A returning) ----
  function screenSearch() {
    W.mode = 'returning';
    const input = h('input', { class: 'text-input search-input', placeholder: T.search_by, autofocus: true });
    const results = h('div', { class: 'search-results' });

    let timer = null;
    async function run() {
      const q = input.value.trim();
      const res = await window.api.db.search(q);
      const list = res.ok ? res.data : [];
      mount(results, ...renderResults(list));
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 200); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

    function renderResults(list) {
      if (!list.length) return [h('div', { class: 'muted', text: T.no_results })];
      return list.map((p) => h('button', {
        class: 'result-card' + (p.has_pending ? ' result-pending' : ''),
        onClick: () => selectReturning(p.id)
      }, [
        h('div', { class: 'result-num', text: `#${p.patient_number}` }),
        h('div', { class: 'result-main' }, [
          h('div', { class: 'result-name', text: p.name || '—' }),
          h('div', { class: 'result-meta', text: `${T.age}: ${p.age_at_first_visit ?? '—'} · ${p.school_group || '—'}` }),
          h('div', { class: 'result-meta', text: `${T.last_visit}: ${fmtDate(p.last_visit_date)} · ${T.last_outcome}: ${p.last_outcome || '—'}` }),
          p.has_pending ? h('div', { class: 'result-pending-tag', text: '⚠ ' + T.pending_treatment }) : null
        ])
      ]));
    }

    shell(T.returning_search, [
      h('div', { class: 'card' }, [
        field(T.search, input),
        results
      ])
    ], [
      h('button', { class: 'btn btn-ghost', onClick: screenStart }, T.back)
    ]);
    run();
  }

  async function selectReturning(id) {
    mount(container, h('div', { class: 'view' }, [spinner(T.loading)]));
    const res = await window.api.db.getPatient(id);
    if (!res.ok || !res.data) { toast(T.no_results, 'error'); screenSearch(); return; }
    W.existing = res.data;
    W.med = JSON.parse(JSON.stringify(res.data.medical_history || window.api.model.newMedicalHistory()));
    screenReturningConfirm();
  }

  function screenReturningConfirm() {
    const p = W.existing;
    const lastV = window.api.model.lastVisit(p);
    const pending = lastV && lastV.visit_outcome === 'NV'
      ? (lastV.treatment_items || []).filter((t) => !t.complete)
      : [];
    shell(T.confirm_identity, [
      patientMiniCard(p),
      pending.length ? h('div', { class: 'pending-box' }, [
        h('div', { class: 'pending-title', text: '⚠ ' + T.pending_treatment }),
        h('div', { class: 'pending-list' }, pending.map((t) => h('span', { class: 'code-chip', text: window.api.codes.formatItem(t) })))
      ]) : null,
      h('div', { class: 'prior-history' }, [
        priorHistoryField(p)
      ])
    ], [
      h('button', { class: 'btn btn-ghost', onClick: screenSearch }, T.back),
      h('button', { class: 'btn btn-secondary', onClick: () => { W.medChanged = true; screenMedical(); } }, T.proceed_medical),
      h('button', { class: 'btn btn-primary', onClick: () => { W.medChanged = false; screenDrive(); } }, T.confirm_identity)
    ]);
  }

  function priorHistoryField(p) {
    const ta = h('textarea', { class: 'textarea', rows: '3', placeholder: T.prior_paper_hint }, p.prior_paper_history || '');
    ta.value = p.prior_paper_history || '';
    ta.addEventListener('input', () => { p.prior_paper_history = ta.value; });
    return field(T.prior_paper_history, ta, { hint: T.prior_paper_hint });
  }

  function stampMedUpdate(med) {
    const today = window.api.model.todayISO();
    if (!med.med_date_updated_1) med.med_date_updated_1 = today;
    else if (!med.med_date_updated_2) med.med_date_updated_2 = today;
    else if (!med.med_date_updated_3) med.med_date_updated_3 = today;
    med.last_modified = window.api.model.nowISO();
  }

  function resetWizard() {
    W.mode = null;
    W.draft = { school_group: '', first_name: '', last_name: '', age: '', sex: '' };
    W.consent = { signed: false, signatory_name: '', signature_image: null };
    W.med = window.api.model.newMedicalHistory();
    W.oh1 = false; W.drive_number = ''; W.drivePath = null;
    W.existing = null; W.medChanged = false; W.nextNumber = null;
  }

  screenStart();
}

// ---- helpers ----
function segmented(opts, value, onChange) {
  const row = h('div', { class: 'seg' });
  opts.forEach((o) => {
    const b = h('button', { class: 'seg-btn' + (value === o.v ? ' active' : ''), type: 'button',
      onClick: () => { [...row.children].forEach((c) => c.classList.remove('active')); b.classList.add('active'); onChange(o.v); } }, o.label);
    row.appendChild(b);
  });
  return row;
}

function patientMiniCard(p) {
  return h('div', { class: 'summary-card' }, [
    h('div', { class: 'summary-num', text: `#${p.patient_number}` }),
    h('div', { class: 'summary-main' }, [
      h('div', { class: 'summary-name', text: window.api.model.fullName(p) || '—' }),
      h('div', { class: 'summary-meta', text: `${T.age}: ${p.age_at_first_visit ?? '—'} · ${T.sex}: ${p.sex || '—'} · ${p.school_group || '—'}` })
    ])
  ]);
}
