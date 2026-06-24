/* Cleaning station (spec 5.3) — single-purpose, with full patient context (#1). */
import { h, mount, checkbox, toast, alertDialog, fmtDateTime, spinner, lastVisit } from '../util.js';
import { T } from '../i18n/index.js';
import { alertBanner, patientSummary, medicalPanel, visitHistoryPanel, treatmentDonePanel, cleaningTypeControl } from '../components/shared.js';
import { driveSelector } from '../components/shared.js';

export function renderCleaning(container) {
  function screenLoad() {
    const selector = driveSelector({ mode: 'read', mergeMaster: true, onLoaded: screenEditor });
    mount(container, h('div', { class: 'view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.cleaning_title })]),
      selector.node
    ]));
  }

  function screenEditor(patient, drivePath) {
    const visit = lastVisit(patient);

    async function markDone() {
      visit.cleaning_done = true;
      visit.cleaning_done_at = window.api.model.nowISO();
      toast(T.cleaning_marked, 'success');
      render();
    }

    async function save() {
      if (visit) { visit.station_status.cleaning = true; visit.last_modified = window.api.model.nowISO(); }
      mount(container, h('div', { class: 'view' }, [spinner(T.loading)]));
      const write = await window.api.drive.write(drivePath, patient);
      if (!write.ok) { await alertDialog(T.error, write.reason); screenEditor(patient, drivePath); return; }
      try { await window.api.db.mergeFromDrive(patient); } catch (_) { /* drive saved regardless */ }
      await alertDialog(T.saved, T.drive_saved);
      screenLoad();
    }

    function render() {
      const ordered = visit && visit.cleaning_type && visit.cleaning_type !== 'None';
      // FLOW-5: patient came without a doctor visit (no dentist exam on this record).
      const noDentistExam = visit && visit.station_status && !visit.station_status.dentist;
      const oh2 = checkbox(T.oh2_label, visit && visit.oh2_done, (v) => { if (visit) visit.oh2_done = v; });
      // HYG-4: fluoride checkbox bound to visit.fluoride_done (timestamp like fluoride.js).
      const fl = checkbox(T.fl_label, visit && visit.fluoride_done, (v) => {
        if (visit) { visit.fluoride_done = v; visit.fluoride_done_at = v ? window.api.model.nowISO() : null; }
      });

      mount(container, h('div', { class: 'view cleaning-view' }, [
        h('div', { class: 'view-head' }, [
          h('h2', { text: T.cleaning_title }),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
        ]),
        alertBanner(patient),
        noDentistExam ? h('div', { class: 'no-exam-banner', text: T.no_dentist_exam }) : null,
        patientSummary(patient),
        h('div', { class: 'panels-row' }, [medicalPanel(patient), treatmentDonePanel(visit, { open: true })]),
        visitHistoryPanel(patient),
        // HYG-4: editable shared cleaning-type control (Prophy / Debridement / None).
        h('div', { class: 'card' }, [
          h('div', { class: 'order-line' }, [h('span', { text: T.cleaning_ordered + ': ' }), cleaningTypeControl(visit)]),
          ordered
            ? (visit.cleaning_done
                ? h('div', { class: 'done-line', text: `✓ ${T.completed} — ${fmtDateTime(visit.cleaning_done_at)}` })
                : h('button', { class: 'btn btn-primary btn-lg', onClick: markDone }, '✓ ' + T.cleaning_complete_btn))
            : h('div', { class: 'muted', text: T.no_cleaning_ordered })
        ]),
        // HYG-4: OH2 + fluoride, both editable.
        h('div', { class: 'card big-checks' }, [oh2, fl]),
        h('div', { class: 'view-foot' }, [
          h('button', { class: 'btn btn-ghost', onClick: screenLoad }, T.back),
          h('button', { class: 'btn btn-primary', onClick: save }, '💾 ' + T.save_to_drive)
        ])
      ]));
    }
    render();
  }

  screenLoad();
}
