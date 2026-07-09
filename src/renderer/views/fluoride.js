/* Fluoride station (spec 5.4) — OH3 + fluoride, with full patient context (#1). */
import { h, mount, checkbox, field, alertDialog, spinner, lastVisit } from '../util.js';
import { T } from '../i18n/index.js';
import { alertBanner, patientSummary, medicalPanel, visitHistoryPanel, treatmentDonePanel, treatmentStatusPanel, driveSelector } from '../components/shared.js';

export function renderFluoride(container, ctx) {
  function screenLoad() {
    const selector = driveSelector({ mode: 'read', mergeMaster: true, onLoaded: screenEditor });
    mount(container, h('div', { class: 'view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.fluoride_title })]),
      selector.node
    ]));
  }

  function screenEditor(patient, drivePath) {
    const visit = lastVisit(patient);

    // FLU-7: block screen when fluoride is explicitly NOT recommended (=== false).
    // Legacy / skip-doctor records (undefined/true) proceed normally — never block on those.
    if (visit && visit.fluoride_recommended === false) {
      mount(container, h('div', { class: 'view fluoride-view' }, [
        h('div', { class: 'view-head' }, [
          h('h2', { text: T.fluoride_title }),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
        ]),
        alertBanner(patient),
        patientSummary(patient),
        h('div', { class: 'fl-block-banner' }, [
          h('div', { class: 'fl-block-title', text: T.fluoride_blocked_title }),
          h('div', { class: 'fl-block-msg', text: T.fluoride_blocked_msg })
        ]),
        h('div', { class: 'view-foot' }, [
          h('button', { class: 'btn btn-ghost', onClick: screenLoad }, T.back)
        ])
      ]));
      return;
    }

    // FLOW-5: patient came without a doctor visit (no dentist exam on this record).
    const noDentistExam = visit && visit.station_status && !visit.station_status.dentist;

    const oh3 = checkbox(T.oh3_label, visit && visit.oh3_done, (v) => { if (visit) visit.oh3_done = v; });
    const fl = checkbox(T.fl_label, visit && visit.fluoride_done, (v) => {
      if (visit) { visit.fluoride_done = v; visit.fluoride_done_at = v ? window.api.model.nowISO() : null; }
    });

    // Item 5: fluoride-station initials (mirrors the doctor's clinician_initials).
    const flInitials = h('input', { class: 'text-input', maxlength: '4', placeholder: 'AB', value: (visit && visit.fluoride_initials) || '' });
    flInitials.addEventListener('input', () => { if (visit) visit.fluoride_initials = flInitials.value.toUpperCase(); });

    async function save() {
      if (visit) { visit.station_status.fluoride = true; visit.last_modified = window.api.model.nowISO(); }
      mount(container, h('div', { class: 'view' }, [spinner(T.loading)]));
      const write = await window.api.drive.write(drivePath, patient);
      if (!write.ok) { await alertDialog(T.error, write.reason); screenEditor(patient, drivePath); return; }
      try { await window.api.db.mergeFromDrive(patient); } catch (_) { /* drive saved regardless */ }
      await alertDialog(T.saved, T.drive_saved);
      screenLoad();
    }

    mount(container, h('div', { class: 'view fluoride-view' }, [
      h('div', { class: 'view-head' }, [
        h('h2', { text: T.fluoride_title }),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
      ]),
      alertBanner(patient),
      noDentistExam ? h('div', { class: 'no-exam-banner', text: T.no_dentist_exam }) : null,
      patientSummary(patient),
      h('div', { class: 'panels-row' }, [medicalPanel(patient), treatmentDonePanel(visit, { open: true })]),
      visitHistoryPanel(patient),
      h('div', { class: 'card big-checks' }, [oh3, fl]),
      // Item 5: fluoride-station initials.
      h('div', { class: 'card' }, [field(T.fluoride_initials, flInitials)]),
      // Item 3: standardized status box — READ-ONLY here (fluoride neither plans
      // nor performs treatment; shows chips + provider tags only, never stamps).
      h('div', { class: 'card' }, [treatmentStatusPanel(visit, { editable: false })]),
      h('div', { class: 'view-foot' }, [
        h('button', { class: 'btn btn-ghost', onClick: screenLoad }, T.back),
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 ' + T.save_to_drive)
      ])
    ]));
  }

  screenLoad();
}
