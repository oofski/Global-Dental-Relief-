/* Checkout / Master station (spec 5.5, 7.3). Admin role. */
import { h, mount, toast, alertDialog, confirmDialog, fmtDate, fmtDateTime, timeSince, spinner, lastVisit } from '../util.js';
import { T } from '../i18n/index.js';
import { alertBanner, patientSummary, visitHistoryPanel, driveSelector, careChecklist, visitTreatmentSummary } from '../components/shared.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';

export function renderCheckout(container, ctx) {
  const canManage = !!(ctx && ctx.manage_users);
  let activeTab = 'process';

  function tabs() {
    const t = [
      tabBtn('process', '🧾 ' + T.checkout_title),
      tabBtn('nv', '🔁 ' + T.nv_title),
      tabBtn('reports', '📊 ' + T.reports_title)
    ];
    if (canManage) t.push(tabBtn('settings', '⚙ ' + T.tab_settings));
    return h('div', { class: 'tabs' }, t);
  }
  function tabBtn(key, label) {
    return h('button', { class: 'tab' + (activeTab === key ? ' active' : ''), onClick: () => { activeTab = key; route(); } }, label);
  }

  function route() {
    const body = h('div', { class: 'tab-body' });
    mount(container, h('div', { class: 'view checkout-view' }, [tabs(), body]));
    if (activeTab === 'process') screenLoad(body);
    else if (activeTab === 'nv') screenNV(body);
    else if (activeTab === 'settings' && canManage) renderSettings(body, ctx);
    else renderReports(body, ctx);
  }

  // ---- Process patient from drive ----
  function screenLoad(host) {
    const selector = driveSelector({ mode: 'read', mergeMaster: true, onLoaded: (patient, drivePath) => screenProcess(host, patient, drivePath) });
    mount(host, h('div', { class: 'view-head', }, [h('h2', { text: T.final_review })]), selector.node);
  }

  function screenProcess(host, patient, drivePath) {
    const visit = lastVisit(patient);
    const st = { uploaded: false };

    const outcomeSeg = h('div', { class: 'seg seg-lg' }, [
      h('button', { class: 'seg-btn' + (visit && visit.visit_outcome === 'F' ? ' active' : ''), onClick: (e) => setOutcome('F', e) }, T.outcome_finished_full),
      h('button', { class: 'seg-btn seg-nv' + (visit && visit.visit_outcome === 'NV' ? ' active' : ''), onClick: (e) => setOutcome('NV', e) }, T.outcome_nextvisit_full)
    ]);
    function setOutcome(v, e) { if (visit) visit.visit_outcome = v; [...outcomeSeg.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); }

    const uploadBtn = h('button', { class: 'btn btn-primary btn-lg', onClick: upload }, '⬆ ' + T.upload_master);
    const clearBtn = h('button', { class: 'btn btn-danger btn-lg', disabled: true, onClick: clearDrive }, '🧹 ' + T.clear_drive);
    const statusLine = h('div', { class: 'process-status muted' });

    async function upload() {
      if (!visit || !visit.visit_outcome) { toast(T.visit_outcome + ' — ' + T.required, 'warn'); return; }
      visit.station_status.checkout = true;
      if (!visit.checkout_timestamp) visit.checkout_timestamp = window.api.model.nowISO();
      visit.last_modified = window.api.model.nowISO();
      const res = await window.api.db.uploadPatient(patient);
      if (!res.ok) { await alertDialog(T.error, res.error || 'upload_failed'); return; }
      st.uploaded = true;
      clearBtn.removeAttribute('disabled');
      uploadBtn.setAttribute('disabled', '');
      statusLine.textContent = T.upload_summary
        .replace('{num}', patient.patient_number)
        .replace('{name}', window.api.model.fullName(patient))
        .replace('{date}', fmtDate(visit.visit_date))
        .replace('{outcome}', visit.visit_outcome);
      toast(T.upload_done, 'success');
    }

    async function clearDrive() {
      if (!st.uploaded) { toast(T.upload_first, 'warn'); return; }
      const ok = await confirmDialog(T.clear_confirm_title, T.clear_confirm_body, { danger: true });
      if (!ok) return;
      const res = await window.api.drive.clear(drivePath);
      if (!res.ok) { await alertDialog(T.error, res.reason || 'clear_error'); return; }
      if (patient.drive_number != null) await window.api.db.logDrive(patient.drive_number, 'available');
      await alertDialog(T.clear_done, T.clear_done);
      route();
    }

    // Completeness indicator (Screen A)
    const ss = (visit && visit.station_status) || {};
    function stRow(label, done) {
      return h('div', { class: 'st-row' }, [
        h('span', { class: 'st-dot ' + (done ? 'st-done' : 'st-pending') }),
        h('span', { text: label }),
        h('span', { class: 'st-tag', text: done ? T.done : T.pending })
      ]);
    }

    // Visit detail summary
    const codes = visit ? (visit.treatment_items || []).map((t) => h('span', { class: 'code-chip' + (t.complete ? ' done' : ''), text: window.api.codes.formatItem(t) })) : [];

    // Outstanding from prior NV visits
    const priorNV = (patient.visits || []).filter((v) => v !== visit && v.visit_outcome === 'NV');
    const priorPending = priorNV.flatMap((v) => (v.treatment_items || []).filter((t) => !t.complete));

    mount(host, h('div', { class: 'view checkout-process' }, [
      h('div', { class: 'view-head' }, [
        h('h2', { text: T.final_review }),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: () => route() }, '← ' + T.load_from_drive)
      ]),
      alertBanner(patient),
      patientSummary(patient),

      h('div', { class: 'card' }, [
        h('h3', { class: 'card-title', text: T.completeness }),
        h('div', { class: 'st-grid' }, [
          stRow(T.station_checkin, ss.checkin),
          stRow(T.station_dentist, ss.dentist),
          stRow(T.station_cleaning, ss.cleaning || !(visit && visit.cleaning_type && visit.cleaning_type !== 'None')),
          stRow(T.station_fluoride, ss.fluoride || (visit && visit.fluoride_done))
        ])
      ]),

      h('div', { class: 'card' }, [
        h('h3', { class: 'card-title', text: T.treatment_plan }),
        h('div', { class: 'visit-detail' }, [
          h('div', { text: `${T.exam_type}: ${visit ? (visit.exam_type || '—') : '—'} · ${visit ? (visit.clinician_type || '') : ''} ${visit ? (visit.clinician_initials || '') : ''}` }),
          codes.length ? h('div', { class: 'pending-list' }, codes) : h('div', { class: 'muted', text: '—' }),
          visitTreatmentSummary(visit)
        ])
      ]),

      h('div', { class: 'card' }, [
        h('h3', { class: 'card-title', text: T.care_checklist }),
        careChecklist(visit, { editable: true })
      ]),

      priorPending.length ? h('div', { class: 'pending-box' }, [
        h('div', { class: 'pending-title', text: '⚠ ' + T.outstanding_prior }),
        h('div', { class: 'pending-list' }, priorPending.map((t) => h('span', { class: 'code-chip', text: window.api.codes.formatItem(t) })))
      ]) : null,

      visitHistoryPanel(patient),

      h('div', { class: 'card' }, [
        h('h3', { class: 'card-title', text: T.visit_outcome }),
        outcomeSeg
      ]),

      h('div', { class: 'card upload-card' }, [
        h('div', { class: 'two-step' }, [uploadBtn, h('span', { class: 'step-arrow', text: '→' }), clearBtn]),
        statusLine
      ])
    ]));
  }

  // ---- NV dashboard (7.3) ----
  async function screenNV(host) {
    mount(host, spinner(T.loading));
    const res = await window.api.db.listNV();
    const list = res.ok ? res.data : [];
    if (!list.length) { mount(host, h('div', { class: 'big-info', text: T.nv_empty })); return; }
    mount(host,
      h('div', { class: 'view-head' }, [h('h2', { text: T.nv_title }), h('span', { class: 'count-badge', text: list.length })]),
      h('div', { class: 'nv-list' }, list.map((p) => h('div', { class: 'nv-card' }, [
        h('div', { class: 'nv-num', text: `#${p.patient_number}` }),
        h('div', { class: 'nv-main' }, [
          h('div', { class: 'nv-name', text: p.name || '—' }),
          h('div', { class: 'nv-meta', text: `${p.school_group || '—'}` }),
          p.outstanding.length
            ? h('div', { class: 'pending-list' }, p.outstanding.map((t) => h('span', { class: 'code-chip', text: window.api.codes.formatItem(t) })))
            : (p.treatment_notes ? h('div', { class: 'visit-notes', text: p.treatment_notes }) : h('div', { class: 'muted', text: '—' }))
        ]),
        h('div', { class: 'nv-wait' }, [
          h('div', { class: 'nv-wait-label', text: T.nv_waiting }),
          h('div', { class: 'nv-wait-val', text: timeSince(p.marked_at) }),
          h('div', { class: 'muted', text: fmtDateTime(p.marked_at) })
        ])
      ])))
    );
  }

  route();
}

function tag(text) { return h('span', { class: 'tag', text }); }
