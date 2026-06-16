/* Cleaning station (spec 5.3) — single-purpose. */
import { h, mount, checkbox, toast, alertDialog, fmtDateTime, spinner } from '../util.js';
import { T } from '../i18n/index.js';
import { alertBanner, patientSummary, driveSelector } from '../components/shared.js';

export function renderCleaning(container) {
  function screenLoad() {
    const selector = driveSelector({ mode: 'read', onLoaded: screenEditor });
    mount(container, h('div', { class: 'view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.cleaning_title })]),
      selector.node
    ]));
  }

  function screenEditor(patient, drivePath) {
    const visit = window.api.model.lastVisit(patient);

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
      await alertDialog(T.saved, T.drive_saved);
      screenLoad();
    }

    function render() {
      const ordered = visit && visit.cleaning_type && visit.cleaning_type !== 'None';
      const typeLabel = visit && visit.cleaning_type === 'P' ? T.cleaning_prophy
        : visit && visit.cleaning_type === 'D' ? T.cleaning_debride : T.cleaning_none;

      const oh2 = checkbox(T.oh2_label, visit && visit.oh2_done, (v) => { if (visit) visit.oh2_done = v; });

      mount(container, h('div', { class: 'view cleaning-view' }, [
        h('div', { class: 'view-head' }, [
          h('h2', { text: T.cleaning_title }),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
        ]),
        alertBanner(patient),
        patientSummary(patient),
        !ordered
          ? h('div', { class: 'big-info', text: T.no_cleaning_ordered })
          : h('div', { class: 'card' }, [
              h('div', { class: 'order-line' }, [h('span', { text: T.cleaning_ordered + ': ' }), h('strong', { class: 'big-number', text: typeLabel })]),
              visit.cleaning_done
                ? h('div', { class: 'done-line', text: `✓ ${T.completed} — ${fmtDateTime(visit.cleaning_done_at)}` })
                : h('button', { class: 'btn btn-primary btn-lg', onClick: markDone }, '✓ ' + T.cleaning_complete_btn)
            ]),
        h('div', { class: 'card' }, [oh2]),
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
