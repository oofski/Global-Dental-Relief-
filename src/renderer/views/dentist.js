/* Dentist station (spec 5.2). */
import { h, mount, field, checkbox, toast, alertDialog, spinner } from '../util.js';
import { T } from '../i18n/index.js';
import { alertBanner, patientSummary, medicalPanel, visitHistoryPanel, driveSelector } from '../components/shared.js';
import { toothChart } from '../components/toothchart.js';

export function renderDentist(container, ctx) {
  function screenLoad() {
    const selector = driveSelector({
      mode: 'read',
      onLoaded: (patient, drivePath) => screenEditor(patient, drivePath)
    });
    mount(container, h('div', { class: 'view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.dentist_title })]),
      selector.node
    ]));
  }

  function screenEditor(patient, drivePath) {
    // Work on the latest visit (created at check-in). Create one if missing.
    let visit = window.api.model.lastVisit(patient);
    if (!visit || visit.station_status.checkout) {
      visit = window.api.model.newVisit(patient);
      patient.visits.push(visit);
    }
    if (!visit.treatment_items) visit.treatment_items = [];

    const todayList = h('div', { class: 'today-list' });

    function refreshToday() {
      const items = visit.treatment_items || [];
      if (!items.length) { mount(todayList, h('div', { class: 'muted', text: T.no_treatment_items })); return; }
      mount(todayList, ...items.map((t) => {
        const code = window.api.codes.formatItem(t);
        const todayChk = h('input', { type: 'checkbox', checked: !!t.treating_today });
        todayChk.addEventListener('change', () => { t.treating_today = todayChk.checked; });
        const doneChk = h('input', { type: 'checkbox', checked: !!t.complete });
        doneChk.addEventListener('change', () => { t.complete = doneChk.checked; refreshToday(); });
        return h('div', { class: 'today-item' + (t.complete ? ' done' : '') + (t.treating_today ? ' today' : '') }, [
          h('span', { class: 'code-chip', text: code }),
          h('label', { class: 'checkbox checkbox-inline' }, [todayChk, h('span', { text: T.treating_today })]),
          h('label', { class: 'checkbox checkbox-inline' }, [doneChk, h('span', { text: T.mark_complete })])
        ]);
      }));
    }

    const chart = toothChart(visit, { onChange: refreshToday });

    // Exam type
    const examSeg = h('div', { class: 'seg' }, [
      h('button', { class: 'seg-btn' + (visit.exam_type === 'E' ? ' active' : ''), onClick: (e) => setExam('E', e) }, T.exam_new_full),
      h('button', { class: 'seg-btn' + (visit.exam_type === 'R' ? ' active' : ''), onClick: (e) => setExam('R', e) }, T.exam_return_full)
    ]);
    function setExam(v, e) { visit.exam_type = v; [...examSeg.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); }

    // Clinician
    const clinSeg = h('div', { class: 'seg' }, [
      h('button', { class: 'seg-btn' + (visit.clinician_type === 'DDS' ? ' active' : ''), onClick: (e) => { visit.clinician_type = 'DDS'; toggle(clinSeg, e); } }, 'DDS'),
      h('button', { class: 'seg-btn' + (visit.clinician_type === 'RDH' ? ' active' : ''), onClick: (e) => { visit.clinician_type = 'RDH'; toggle(clinSeg, e); } }, 'RDH')
    ]);
    const initials = h('input', { class: 'text-input', maxlength: '4', placeholder: 'AB', value: visit.clinician_initials || '' });
    initials.addEventListener('input', () => { visit.clinician_initials = initials.value.toUpperCase(); });

    // NT
    const ntChk = checkbox(T.nt_label, visit.nt_status, (v) => { visit.nt_status = v; });

    // Cleaning order
    const cleanSeg = h('div', { class: 'seg' }, [
      h('button', { class: 'seg-btn' + (visit.cleaning_type === 'P' ? ' active' : ''), onClick: (e) => { visit.cleaning_type = 'P'; toggle(cleanSeg, e); } }, T.cleaning_prophy),
      h('button', { class: 'seg-btn' + (visit.cleaning_type === 'D' ? ' active' : ''), onClick: (e) => { visit.cleaning_type = 'D'; toggle(cleanSeg, e); } }, T.cleaning_debride),
      h('button', { class: 'seg-btn' + (!visit.cleaning_type || visit.cleaning_type === 'None' ? ' active' : ''), onClick: (e) => { visit.cleaning_type = 'None'; toggle(cleanSeg, e); } }, T.cleaning_none)
    ]);

    // Treatment notes (free text codes)
    const notes = h('textarea', { class: 'textarea', rows: '2', placeholder: T.treatment_notes_hint });
    notes.value = visit.treatment_notes || '';
    notes.addEventListener('input', () => { visit.treatment_notes = notes.value; });

    // OH2
    const oh2 = checkbox(T.oh2_label, visit.oh2_done, (v) => { visit.oh2_done = v; });

    async function save() {
      if (!visit.exam_type) { toast(T.exam_type + ' — ' + T.required, 'warn'); return; }
      visit.station_status.dentist = true;
      visit.last_modified = window.api.model.nowISO();
      mount(container, h('div', { class: 'view' }, [spinner(T.loading)]));
      const write = await window.api.drive.write(drivePath, patient);
      if (!write.ok) {
        await alertDialog(T.error, `${T.error}: ${write.reason}${write.detail ? ' — ' + write.detail : ''}`);
        screenEditor(patient, drivePath);
        return;
      }
      await alertDialog(T.saved, T.drive_saved);
      screenLoad();
    }

    // Pending from last NV (prior visit)
    const priorVisits = (patient.visits || []).filter((v) => v !== visit && v.visit_outcome === 'NV');
    const priorPending = priorVisits.flatMap((v) => (v.treatment_items || []).filter((t) => !t.complete));

    mount(container, h('div', { class: 'view dentist-view' }, [
      h('div', { class: 'view-head' }, [
        h('h2', { text: T.dentist_title }),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
      ]),
      alertBanner(patient),
      patientSummary(patient),
      h('div', { class: 'panels-row' }, [medicalPanel(patient), visitHistoryPanel(patient)]),

      priorPending.length ? h('div', { class: 'pending-box' }, [
        h('div', { class: 'pending-title', text: '⚠ ' + T.prior_pending }),
        h('div', { class: 'pending-list' }, priorPending.map((t) => h('span', { class: 'code-chip', text: window.api.codes.formatItem(t) })))
      ]) : null,

      h('div', { class: 'card' }, [
        h('div', { class: 'form-grid form-grid-3' }, [
          field(T.exam_type, examSeg, { required: true }),
          field(T.clinician_type, clinSeg),
          field(T.clinician_initials, initials)
        ])
      ]),

      h('div', { class: 'card' }, [
        h('h3', { class: 'card-title', text: T.tooth_chart }),
        chart,
        h('div', { class: 'chart-controls' }, [
          ntChk,
          h('div', { class: 'field-hint', text: T.nt_hint })
        ]),
        field(T.cleaning_order, cleanSeg),
        field(T.treatment_notes, notes, { hint: T.treatment_notes_hint })
      ]),

      h('div', { class: 'card' }, [
        h('h3', { class: 'card-title', text: T.today_selection }),
        h('div', { class: 'field-hint', text: T.today_rule }),
        todayList
      ]),

      h('div', { class: 'card' }, [oh2]),

      h('div', { class: 'view-foot' }, [
        h('button', { class: 'btn btn-ghost', onClick: screenLoad }, T.back),
        h('button', { class: 'btn btn-primary btn-lg', onClick: save }, '💾 ' + T.save_to_drive)
      ])
    ]));
    refreshToday();
  }

  function toggle(seg, e) { [...seg.children].forEach((c) => c.classList.remove('active')); e.currentTarget.classList.add('active'); }

  screenLoad();
}
