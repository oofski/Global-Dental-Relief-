/* Reusable clinical UI pieces shared across stations. */
import { h, fmtDate, fmtDateTime, toast, spinner, mount, checkbox, modal } from '../util.js';
import { T } from '../i18n/index.js';

const C = window.api.codes;

// ---- High-priority medical alert banner (spec 4.2 / 5.2) ----
const ALERT_LABELS = {
  allergies: T.alert_allergies,
  bleeding_problems: T.alert_bleeding,
  infectious_disease: T.alert_infectious,
  heart_problems: T.alert_heart,
  diabetes: T.alert_diabetes
};

export function alertBanner(patient) {
  const med = patient && patient.medical_history;
  const alerts = window.api.model.activeAlerts(med);
  if (!alerts.length) return null;
  return h('div', { class: 'alert-banner' }, [
    h('div', { class: 'alert-title', text: T.alert_title }),
    h('div', { class: 'alert-items' }, alerts.map((a) =>
      h('span', { class: 'alert-chip' }, [
        h('strong', { text: ALERT_LABELS[a.key] || a.key }),
        a.text ? h('span', { text: `: ${a.text}` }) : null
      ])
    ))
  ]);
}

// ---- Consent restrictions (v1.3.3) ----
// The parent ticks each care option on the permission slip; anything left
// unticked must never be performed. Both the acknowledge-first modal and the
// standing banner below read from the SAME resolver so the clinical stations
// cannot drift apart.
//
// Legacy records (consent written before the slip had per-item boxes) come back
// from consentPermissions() as legacy:true with denied:[] — that was a blanket
// authorization, so returning patients from earlier versions stay silent.
const PERMISSION_LABELS = {
  cleaning: T.consent_perm_cleaning,
  fillings: T.consent_perm_fillings,
  extractions: T.consent_perm_extractions
};

function consentLimits(patient) {
  const perms = window.api.model.consentPermissions(patient);
  if (perms.legacy) return null;
  const denied = perms.denied || [];
  const unsigned = !(patient && patient.consent && patient.consent.signed);
  if (!denied.length && !unsigned) return null;
  return { denied, unsigned, allDenied: denied.length === 3 };
}

function deniedChips(info) {
  return h('div', { class: 'consent-limit-items' }, info.denied.map((k) =>
    h('span', { class: 'consent-limit-chip', text: PERMISSION_LABELS[k] || k })));
}

// Modal the clinician must actively dismiss (X or "I understand") before
// charting — a backdrop click does NOT close it. Never blocks charting itself.
// Returns a promise; resolves immediately when there is nothing to warn about.
export function consentLimitsAlert(patient) {
  const info = consentLimits(patient);
  if (!info) return Promise.resolve(false);
  const body = h('div', { class: 'consent-limit-body' }, [
    info.unsigned ? h('p', { class: 'consent-limit-unsigned', text: T.consent_unsigned }) : null,
    info.denied.length ? h('p', { text: T.consent_limits_intro }) : null,
    info.denied.length ? deniedChips(info) : null,
    info.allDenied ? h('p', { class: 'consent-limit-none', text: T.consent_limits_none }) : null
  ]);
  return modal({
    title: T.consent_limits_title,
    body,
    className: 'modal-danger',
    dismissOnBackdrop: false,
    closeButton: true,
    actions: [{ label: T.consent_limits_ack, value: true, danger: true }]
  });
}

// Standing banner for the station patient header — keeps the restriction on
// screen after the modal is acknowledged. Renders nothing when unrestricted.
export function consentLimitsBanner(patient) {
  const info = consentLimits(patient);
  if (!info) return null;
  return h('div', { class: 'consent-limit-banner' }, [
    h('div', { class: 'consent-limit-title', text: '⛔ ' + T.consent_limits_banner }),
    info.unsigned ? h('div', { class: 'consent-limit-line', text: T.consent_unsigned }) : null,
    info.denied.length ? h('div', { class: 'consent-limit-line' }, [
      h('span', { text: T.consent_limits_intro + ' ' }),
      deniedChips(info)
    ]) : null,
    info.allDenied ? h('div', { class: 'consent-limit-line', text: T.consent_limits_none }) : null
  ]);
}

// ---- Patient summary card ----
export function patientSummary(patient) {
  return h('div', { class: 'summary-card' }, [
    h('div', { class: 'summary-num', text: `#${patient.patient_number}` }),
    h('div', { class: 'summary-main' }, [
      h('div', { class: 'summary-name', text: window.api.model.fullName(patient) || '—' }),
      h('div', { class: 'summary-meta' }, [
        `${T.age}: ${patient.age_at_first_visit ?? '—'}`,
        `   ${T.sex}: ${patient.sex || '—'}`,
        `   ${T.school_group}: ${patient.school_group || '—'}`
      ].join('  '))
    ])
  ]);
}

// ---- Medical history read-only panel (collapsible) ----
const MED_FIELDS = [
  ['asthma', T.med_asthma],
  ['medications', T.med_medications, 'medications_text'],
  ['recent_hospital', T.med_recent_hospital, 'recent_hospital_text'],
  ['allergies', T.med_allergies, 'allergies_text'],
  ['bleeding_problems', T.med_bleeding, 'bleeding_problems_text'],
  ['infectious_disease', T.med_infectious, 'infectious_disease_text'],
  ['epilepsy_fainting', T.med_epilepsy],
  ['heart_problems', T.med_heart],
  ['diabetes', T.med_diabetes]
];

export function medicalPanel(patient, { open = false } = {}) {
  const med = patient.medical_history || {};
  const positives = MED_FIELDS.filter(([k]) => med[k]);
  const details = h('details', { class: 'panel' });
  if (open) details.setAttribute('open', '');
  details.appendChild(h('summary', { text: `${T.medical_panel} (${positives.length})` }));
  const list = h('div', { class: 'panel-body' });
  if (!positives.length) {
    list.appendChild(h('div', { class: 'muted', text: '—' }));
  } else {
    positives.forEach(([k, label, textKey]) => {
      list.appendChild(h('div', { class: 'med-line' }, [
        h('span', { class: 'med-yes', text: '✓' }),
        h('span', { text: label + (textKey && med[textKey] ? `: ${med[textKey]}` : '') })
      ]));
    });
  }
  details.appendChild(list);
  return details;
}

// ---- Visit history panel ----
export function visitHistoryPanel(patient) {
  const visits = (patient.visits || []).slice().reverse();
  const details = h('details', { class: 'panel' });
  details.appendChild(h('summary', { text: `${T.visit_history} (${visits.length})` }));
  const body = h('div', { class: 'panel-body' });
  if (!visits.length) {
    body.appendChild(h('div', { class: 'muted', text: T.no_prior_visits }));
  } else {
    visits.forEach((v) => {
      const codesStr = (v.treatment_items || []).map((t) => C.formatItem(t) + (t.complete ? '/' : '')).join('  ');
      const flags = [];
      if (v.cleaning_type && v.cleaning_type !== 'None') flags.push(`${T.cl_word} ${v.cleaning_type}${v.cleaning_done ? ' ✓' : ''}`);
      if (v.fluoride_done) flags.push('FL ✓');
      if (v.oh1_done) flags.push('OH1 ✓');
      if (v.oh2_done) flags.push('OH2 ✓');
      if (v.oh3_done) flags.push('OH3 ✓');
      body.appendChild(h('div', { class: 'visit-line' }, [
        h('div', { class: 'visit-line-head' }, [
          h('strong', { text: fmtDate(v.visit_date) }),
          h('span', { class: 'tag', text: v.exam_type || '?' }),
          v.visit_outcome ? h('span', { class: `tag tag-${v.visit_outcome}`, text: v.visit_outcome }) : null,
          v.clinician_initials ? h('span', { class: 'muted', text: `${v.clinician_type || ''} ${v.clinician_initials}` }) : null
        ]),
        codesStr ? h('div', { class: 'visit-codes', text: codesStr }) : null,
        flags.length ? h('div', { class: 'visit-flags' }, flags.map((f) => h('span', { class: 'tag', text: f }))) : null,
        v.treatment_notes ? h('div', { class: 'visit-notes', text: v.treatment_notes }) : null
      ]));
    });
  }
  details.appendChild(body);
  return details;
}

// ---- Chip color: the SINGLE source of truth for treatment code chips ----
// Priority: done (green, struck through) > not-done (muted red, struck) >
// planned (blue). Every station and panel routes its chip class through here so
// colors never drift (v1.3.2). '.nd' is the canonical not-done class.
export function treatmentChipClass(item) {
  return 'code-chip' + (item && item.complete ? ' done' : (item && item.not_done ? ' nd' : ''));
}

// ---- Provider label: map a stamped role to its display name ----
// Roles are 'dentist' | 'cleaning' | 'fluoride'; anything else (null/unknown)
// returns '' so callers can omit the tag entirely.
export function providerLabel(role) {
  if (role === 'dentist') return T.provider_dentist;
  if (role === 'cleaning') return T.provider_cleaning;
  if (role === 'fluoride') return T.provider_fluoride;
  return '';
}

// ---- "Treatment this visit" panel (what the doctor charted) ----
export function treatmentDonePanel(visit, { open = false } = {}) {
  const details = h('details', { class: 'panel' });
  if (open) details.setAttribute('open', '');
  const items = (visit && visit.treatment_items) || [];
  details.appendChild(h('summary', { text: `${T.tx_this_visit} (${items.length})` }));
  const body = h('div', { class: 'panel-body' });
  if (!visit) {
    body.appendChild(h('div', { class: 'muted', text: '—' }));
  } else {
    body.appendChild(h('div', { class: 'muted', text: `${T.exam_type}: ${visit.exam_type || '—'} · ${visit.clinician_type || ''} ${visit.clinician_initials || ''}`.trim() }));
    if (items.length) {
      body.appendChild(h('div', { class: 'pending-list' }, items.map((t) =>
        h('span', { class: treatmentChipClass(t), text: C.formatItem(t) }))));
    } else {
      body.appendChild(h('div', { class: 'muted', text: visit.nt_status ? 'NT' : '—' }));
    }
    if (visit.treatment_notes) body.appendChild(h('div', { class: 'visit-notes', text: visit.treatment_notes }));
    body.appendChild(visitTreatmentSummary(visit));
  }
  details.appendChild(body);
  return details;
}

// ---- Per-patient treatment summary (counts of work done this visit) ----
const RPT_LABELS = {
  fill_single: 'rpt_fill_single', fill_double: 'rpt_fill_double', fill_multi: 'rpt_fill_multi',
  composite: 'rpt_composite', ext_permanent: 'rpt_ext_permanent', ext_primary: 'rpt_ext_primary',
  ext_surgical: 'rpt_ext_surgical', sealant: 'rpt_sealant', sdf: 'rpt_sdf'
};
export function visitTreatmentSummary(visit) {
  const items = (visit && visit.treatment_items) || [];
  const counts = {};
  items.forEach((t) => { const k = window.api.codes.classifyItem(t); if (k) counts[k] = (counts[k] || 0) + 1; });
  const done = items.filter((t) => t.complete).length;
  const rows = Object.keys(RPT_LABELS).filter((k) => counts[k]).map((k) =>
    h('div', { class: 'tx-sum-row' }, [h('span', { text: T[RPT_LABELS[k]] }), h('span', { class: 'tx-sum-n', text: String(counts[k]) })]));
  if (!rows.length) rows.push(h('div', { class: 'muted', text: visit && visit.nt_status ? 'NT' : '—' }));
  rows.push(h('div', { class: 'tx-sum-row tx-sum-total' }, [
    h('span', { text: `${T.tx_this_visit}` }),
    h('span', { class: 'tx-sum-n', text: `${done}/${items.length}` })
  ]));
  return h('div', { class: 'tx-summary' }, rows);
}

// ---- Standardized completed / not-completed treatment status box (v1.3.2) ----
// IDENTICAL markup across dentist, hygienist (cleaning) and fluoride so the
// summary reads the same provider-to-provider. One row per treatment item:
// a color-coded code chip + a small provider tag (who planned/performed it),
// and — when editable — a Finished / Not done toggle.
//   editable:true  → the toggle mutates the item and stamps performed_by=provider
//                    on Finished (only if provider set and not already stamped).
//   editable:false → read-only (fluoride): chips + tags only, never mutates.
// The panel updates its own rows/header in place on every toggle — callers do
// not need to rebuild it.
export function treatmentStatusPanel(visit, { editable = false, provider = null, open = true, title } = {}) {
  const items = (visit && visit.treatment_items) || [];
  const total = items.length;
  const countDone = () => items.filter((t) => t.complete).length;
  const titleText = () => `${title || T.tx_status_title} (${countDone()}/${total})`;

  const details = h('details', { class: 'panel' });
  if (open) details.setAttribute('open', '');
  const summaryEl = h('summary', { text: titleText() });
  details.appendChild(summaryEl);

  const body = h('div', { class: 'panel-body' });
  const panel = h('div', { class: 'tx-status-panel' });

  if (!items.length) {
    panel.appendChild(h('div', { class: 'muted', text: visit && visit.nt_status ? 'NT' : '—' }));
  } else {
    items.forEach((item) => {
      const row = h('div', { class: 'tx-status-row' });
      const chip = h('span', { class: treatmentChipClass(item), text: C.formatItem(item) });
      row.appendChild(chip);

      const tag = h('span', { class: 'provider-tag' });
      const initLabel = providerLabel(item.performed_by || item.planned_by);
      if (initLabel) { tag.textContent = initLabel; row.appendChild(tag); }

      if (editable) {
        const finBtn = h('button', { type: 'button', class: 'seg-btn' + (item.complete ? ' is-finished' : '') }, T.status_finished);
        const ndBtn = h('button', { type: 'button', class: 'seg-btn' + (item.not_done ? ' is-nd' : '') }, T.status_not_done);
        const seg = h('div', { class: 'tx-status-seg' }, [finBtn, ndBtn]);

        const sync = () => {
          chip.className = treatmentChipClass(item);
          finBtn.classList.toggle('is-finished', !!item.complete);
          ndBtn.classList.toggle('is-nd', !!item.not_done);
          const lbl = providerLabel(item.performed_by || item.planned_by);
          if (lbl) { tag.textContent = lbl; if (!tag.parentNode) row.insertBefore(tag, seg); }
          else if (tag.parentNode) row.removeChild(tag);
          summaryEl.textContent = titleText();
        };

        finBtn.addEventListener('click', () => {
          item.complete = true; item.not_done = false;
          if (provider && !item.performed_by) item.performed_by = provider;
          sync();
        });
        ndBtn.addEventListener('click', () => {
          item.not_done = true; item.complete = false; item.performed_by = null;
          sync();
        });
        row.appendChild(seg);
      }

      panel.appendChild(row);
    });
  }

  body.appendChild(panel);
  details.appendChild(body);
  return details;
}

// ---- Care checklist: recommended vs completed (cleaning / fluoride / OH) ----
// editable:true (checkout "ending form") shows checkboxes the operator can mark;
// otherwise read-only pills. Marks mutate the visit (uploaded to the master DB).
export function careChecklist(visit, { editable = false } = {}) {
  const v = visit || {};
  const pill = (label, on, kind) => h('span', { class: 'cc-pill ' + (on ? (kind || 'cc-on') : 'cc-off'), text: `${label}: ${on ? '✓' : '—'}` });
  const cleaningRec = v.cleaning_type === 'P' || v.cleaning_type === 'D';
  const clLabel = T.cl_word + (cleaningRec ? ` (${v.cleaning_type})` : '');
  const now = () => window.api.model.nowISO();

  if (!editable) {
    const ohPill = (label, done) => h('span', { class: 'cc-pill ' + (done ? 'cc-done' : 'cc-off'), text: `${label} ${done ? '✓' : '—'}` });
    return h('div', { class: 'care-checklist' }, [
      h('div', { class: 'cc-row' }, [
        h('span', { class: 'cc-label', text: clLabel }),
        pill(T.recommended, cleaningRec),
        pill(T.completed_label, !!v.cleaning_done, 'cc-done')
      ]),
      h('div', { class: 'cc-row' }, [
        h('span', { class: 'cc-label', text: T.fl_word }),
        pill(T.recommended, v.fluoride_recommended !== false),
        pill(T.completed_label, !!v.fluoride_done, 'cc-done')
      ]),
      h('div', { class: 'cc-row' }, [
        h('span', { class: 'cc-label', text: 'OH' }),
        ohPill('OH1', !!v.oh1_done), ohPill('OH2', !!v.oh2_done), ohPill('OH3', !!v.oh3_done)
      ])
    ]);
  }

  // Editable (checkout): tick off anything missed upstream.
  const cleaningDone = checkbox(T.completed_label, !!v.cleaning_done, (val) => {
    v.cleaning_done = val;
    if (val) { v.cleaning_done_at = v.cleaning_done_at || now(); if (v.station_status) v.station_status.cleaning = true; }
  });
  const fluorideDone = checkbox(T.completed_label, !!v.fluoride_done, (val) => {
    v.fluoride_done = val;
    v.fluoride_done_at = val ? (v.fluoride_done_at || now()) : null;
    if (val && v.station_status) v.station_status.fluoride = true;
  });
  const oh = (label, key) => checkbox(label, !!v[key], (val) => { v[key] = val; });

  return h('div', { class: 'care-checklist care-checklist-edit' }, [
    h('div', { class: 'cc-row' }, [
      h('span', { class: 'cc-label', text: clLabel }),
      pill(T.recommended, cleaningRec),
      cleaningDone
    ]),
    h('div', { class: 'cc-row' }, [
      h('span', { class: 'cc-label', text: T.fl_word }),
      pill(T.recommended, v.fluoride_recommended !== false),
      fluorideDone
    ]),
    h('div', { class: 'cc-row' }, [
      h('span', { class: 'cc-label', text: 'OH' }),
      oh('OH1', 'oh1_done'), oh('OH2', 'oh2_done'), oh('OH3', 'oh3_done')
    ])
  ]);
}

// ---- Cleaning type control (shared doctor / hygienist) ----
// Single-select segmented control (Prophy / Debridement / None) that writes
// visit.cleaning_type as 'P' | 'D' | 'None' (mutually exclusive). Reuses the
// SAME label keys the dentist station uses (cleaning_prophy / cleaning_debride /
// cleaning_none) so the doctor and hygienist read identically.
// opts.editable (default true): when false, render the current selection read-only.
export function cleaningTypeControl(visit, opts = {}) {
  const { editable = true } = opts;
  const v = visit || {};
  const OPTS = [
    ['P', T.cleaning_prophy],
    ['D', T.cleaning_debride],
    ['None', T.cleaning_none]
  ];
  const current = (v.cleaning_type === 'P' || v.cleaning_type === 'D') ? v.cleaning_type : 'None';

  if (!editable) {
    const label = (OPTS.find(([val]) => val === current) || OPTS[2])[1];
    return h('div', { class: 'seg seg-readonly' }, [
      h('span', { class: 'seg-btn active', text: label })
    ]);
  }

  const seg = h('div', { class: 'seg' });
  OPTS.forEach(([val, label]) => {
    const btn = h('button', {
      type: 'button',
      class: 'seg-btn' + (current === val ? ' active' : ''),
      onClick: (e) => {
        v.cleaning_type = val;
        [...seg.children].forEach((c) => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
      }
    }, label);
    seg.appendChild(btn);
  });
  return seg;
}

// ---- Drive selector ----
// onLoaded(patient, drivePath) for read stations; onSelected(drivePath) for write.
export function driveSelector({ mode = 'read', onLoaded, onSelected, mergeMaster = false } = {}) {
  const host = h('div', { class: 'drive-selector card' });
  let drives = [];
  let selected = null;

  async function refresh() {
    mount(host, spinner(T.loading));
    const res = await window.api.drive.list();
    drives = (res.ok ? res.data : []) || [];
    render();
  }

  async function pick() {
    const res = await window.api.drive.pickFolder();
    if (res.ok && res.data) { selected = res.data; await afterSelect(); }
  }

  async function afterSelect() {
    if (!selected) return;
    if (mode === 'read') {
      const r = await window.api.drive.read(selected);
      if (!r.ok) {
        if (r.reason === 'checksum_mismatch' || r.reason === 'corrupt_json' || r.reason === 'unknown_format') {
          toast(T.corrupt_file, 'error', 6000);
        } else {
          toast(T.no_file_on_drive, 'warn');
        }
        return;
      }
      let patient = r.patient;
      // Merge with the master record so the station sees work accumulated by
      // other stations (and persists this load into the master ledger).
      if (mergeMaster) {
        try { const m = await window.api.db.mergeFromDrive(patient); if (m && m.ok && m.data) patient = m.data; } catch (_) { /* keep drive copy */ }
      }
      if (onLoaded) onLoaded(patient, selected);
    } else {
      if (onSelected) onSelected(selected);
    }
  }

  function render() {
    const list = h('div', { class: 'drive-list' });
    if (!drives.length) {
      list.appendChild(h('div', { class: 'muted', text: T.no_drives }));
    } else {
      drives.forEach((d) => {
        const btn = h('button', {
          class: 'drive-chip' + (selected === d.path ? ' active' : '') + (d.simulated ? ' sim' : ''),
          type: 'button',
          onClick: async () => { selected = d.path; render(); await afterSelect(); }
        }, [
          h('span', { class: 'drive-icon', text: d.simulated ? '🧪' : '💾' }),
          h('span', { class: 'drive-label', text: d.simulated ? T.sim_drive : d.label }),
          h('span', { class: 'drive-path', text: d.path })
        ]);
        list.appendChild(btn);
      });
    }
    mount(host,
      h('div', { class: 'drive-head' }, [
        h('strong', { text: mode === 'read' ? T.load_from_drive : T.select_drive }),
        h('div', { class: 'drive-actions' }, [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: refresh }, '↻ ' + T.refresh),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: pick }, T.pick_folder)
        ])
      ]),
      list,
      mode === 'read' ? h('div', { class: 'drive-hint', text: T.insert_drive } ) : null,
      // Non-blocking identity reminder (item 8) — no modal, no gate.
      mode === 'read' ? h('div', { class: 'drive-hint drive-hint-confirm', text: T.confirm_name_hint }) : null
    );
  }

  refresh();
  return { node: host, getSelected: () => selected, refresh };
}
