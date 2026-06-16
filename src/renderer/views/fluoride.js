/* Fluoride station (spec 5.4) — OH3 + fluoride application. */
import { h, mount, checkbox, alertDialog, spinner } from '../util.js';
import { T } from '../i18n/es.js';
import { alertBanner, patientSummary, driveSelector } from '../components/shared.js';

export function renderFluoride(container) {
  function screenLoad() {
    const selector = driveSelector({ mode: 'read', onLoaded: screenEditor });
    mount(container, h('div', { class: 'view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.fluoride_title })]),
      selector.node
    ]));
  }

  function screenEditor(patient, drivePath) {
    const visit = window.api.model.lastVisit(patient);

    // Soft warning if patient had an extraction this visit (spec 5.4).
    const hadExtraction = visit && (visit.treatment_items || []).some((t) => t.treatment_type === 'extraction');

    const oh3 = checkbox(T.oh3_label, visit && visit.oh3_done, (v) => { if (visit) visit.oh3_done = v; });
    const fl = checkbox(T.fl_label, visit && visit.fluoride_done, (v) => {
      if (visit) { visit.fluoride_done = v; visit.fluoride_done_at = v ? window.api.model.nowISO() : null; }
    });

    async function save() {
      if (visit) { visit.station_status.fluoride = true; visit.last_modified = window.api.model.nowISO(); }
      mount(container, h('div', { class: 'view' }, [spinner(T.loading)]));
      const write = await window.api.drive.write(drivePath, patient);
      if (!write.ok) { await alertDialog(T.error, write.reason); screenEditor(patient, drivePath); return; }
      await alertDialog(T.saved, T.drive_saved);
      screenLoad();
    }

    mount(container, h('div', { class: 'view fluoride-view' }, [
      h('div', { class: 'view-head' }, [
        h('h2', { text: T.fluoride_title }),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
      ]),
      alertBanner(patient),
      patientSummary(patient),
      hadExtraction ? h('div', { class: 'warn-banner', text: '⚠ ' + T.fluoride_warn_extraction }) : null,
      h('div', { class: 'card big-checks' }, [oh3, fl]),
      h('div', { class: 'view-foot' }, [
        h('button', { class: 'btn btn-ghost', onClick: screenLoad }, T.back),
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 ' + T.save_to_drive)
      ])
    ]));
  }

  screenLoad();
}
