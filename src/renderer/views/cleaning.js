/* Cleaning station (spec 5.3) — single-purpose, with full patient context (#1). */
import { h, mount, checkbox, field, toast, alertDialog, fmtDateTime, spinner, lastVisit } from '../util.js';
import { T } from '../i18n/index.js';
import { alertBanner, patientSummary, medicalPanel, visitHistoryPanel, treatmentDonePanel, treatmentStatusPanel, cleaningTypeControl, consentLimitsAlert, consentLimitsBanner } from '../components/shared.js';
import { driveSelector } from '../components/shared.js';
import { toothChart } from '../components/toothchart.js';

export function renderCleaning(container, ctx) {
  function screenLoad() {
    const selector = driveSelector({ mode: 'read', mergeMaster: true, onLoaded: screenEditor });
    mount(container, h('div', { class: 'view' }, [
      h('div', { class: 'view-head' }, [h('h2', { text: T.cleaning_title })]),
      selector.node
    ]));
  }

  function screenEditor(patient, drivePath) {
    // Care the parent refused must be acknowledged before charting starts.
    consentLimitsAlert(patient);

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

      // Item 4: RDH initials (mirrors the doctor's clinician_initials input).
      const rdhInitials = h('input', { class: 'text-input', maxlength: '4', placeholder: 'AB', value: (visit && visit.rdh_initials) || '' });
      rdhInitials.addEventListener('input', () => { if (visit) visit.rdh_initials = rdhInitials.value.toUpperCase(); });

      // Items 2/3: standardized completed / not-completed status box. Editable so
      // the hygienist can mark sealant/SDF complete later (stamps performed_by).
      // Re-mounted on chart changes so newly-charted items appear immediately.
      const statusHost = h('div', { class: 'card' });
      function refreshStatus() {
        mount(statusHost, treatmentStatusPanel(visit, { editable: true, provider: 'cleaning' }));
      }

      // Treatment notes — collapsible, editable, shared with the dentist screen.
      // Newly charted sealant/SDF codes are APPENDED (never regenerated) so the
      // doctor's existing notes are preserved.
      const notesTa = h('textarea', { class: 'textarea', rows: '2', placeholder: T.treatment_notes_hint });
      notesTa.value = (visit && visit.treatment_notes) || '';
      notesTa.addEventListener('input', () => { if (visit) visit.treatment_notes = notesTa.value; });
      function appendChartNotes() {
        if (!visit) return;
        const have = new Set(String(visit.treatment_notes || '').split(',').map((s) => s.trim()).filter(Boolean));
        const add = [];
        (visit.treatment_items || []).forEach((t) => {
          if (t.treatment_type !== 'sealant' && t.treatment_type !== 'sdf') return;
          const code = window.api.codes.formatItem(t);
          if (code && !have.has(code)) { have.add(code); add.push(code); }
        });
        if (!add.length) return;
        const cur = String(visit.treatment_notes || '').trim().replace(/,+$/, '');
        visit.treatment_notes = cur ? cur + ', ' + add.join(', ') : add.join(', ');
        notesTa.value = visit.treatment_notes;
      }
      const notesPanel = visit ? h('details', { class: 'panel' }, [
        h('summary', { text: T.treatment_notes }),
        h('div', { class: 'panel-body' }, [notesTa])
      ]) : null;

      // Items 4/5: same hybrid tooth chart as the doctor, restricted so the
      // hygienist can only chart sealant / SDF; the doctor's other items stay
      // visible read-only. Persists through the existing save() below.
      const chartPanel = visit ? h('details', { class: 'panel', open: true }, [
        h('summary', { text: T.tooth_chart }),
        h('div', { class: 'panel-body' }, [
          toothChart(visit, { allowedTreatments: ['sealant', 'sdf'], provider: 'cleaning', onChange: () => { appendChartNotes(); refreshStatus(); } })
        ])
      ]) : null;

      mount(container, h('div', { class: 'view cleaning-view' }, [
        h('div', { class: 'view-head' }, [
          h('h2', { text: T.cleaning_title }),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: screenLoad }, '← ' + T.load_from_drive)
        ]),
        alertBanner(patient),
        consentLimitsBanner(patient),
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
        // Item 4: RDH initials.
        h('div', { class: 'card' }, [field(T.rdh_initials, rdhInitials)]),
        chartPanel,
        notesPanel,
        // Items 2/3: standardized editable status box.
        statusHost,
        h('div', { class: 'view-foot' }, [
          h('button', { class: 'btn btn-ghost', onClick: screenLoad }, T.back),
          h('button', { class: 'btn btn-primary', onClick: save }, '💾 ' + T.save_to_drive)
        ])
      ]));
      refreshStatus();
    }
    render();
  }

  screenLoad();
}
