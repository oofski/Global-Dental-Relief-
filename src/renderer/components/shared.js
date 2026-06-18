/* Reusable clinical UI pieces shared across stations. */
import { h, fmtDate, fmtDateTime, toast, spinner, mount, checkbox } from '../util.js';
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
        h('span', { class: 'code-chip' + (t.complete ? ' done' : ''), text: C.formatItem(t) }))));
    } else {
      body.appendChild(h('div', { class: 'muted', text: visit.nt_status ? 'NT' : '—' }));
    }
    if (visit.treatment_notes) body.appendChild(h('div', { class: 'visit-notes', text: visit.treatment_notes }));
  }
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

// ---- Drive selector ----
// onLoaded(patient, drivePath) for read stations; onSelected(drivePath) for write.
export function driveSelector({ mode = 'read', onLoaded, onSelected } = {}) {
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
      if (onLoaded) onLoaded(r.patient, selected);
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
      mode === 'read' ? h('div', { class: 'drive-hint', text: T.insert_drive } ) : null
    );
  }

  refresh();
  return { node: host, getSelected: () => selected, refresh };
}
