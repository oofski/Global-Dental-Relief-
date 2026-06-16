/* Reports & export (spec 8). Admin (checkout) only. */
import { h, mount, toast, alertDialog, spinner } from '../util.js';
import { T } from '../i18n/es.js';

export function renderReports(container, ctx) {
  const range = { from: '', to: '' };

  const fromInput = h('input', { class: 'text-input', type: 'date', value: range.from });
  const toInput = h('input', { class: 'text-input', type: 'date', value: range.to });
  fromInput.addEventListener('change', () => { range.from = fromInput.value; });
  toInput.addEventListener('change', () => { range.to = toInput.value; });

  const tableHost = h('div', { class: 'report-table-host' });
  const exportStatus = h('div', { class: 'export-status' });

  function setPreset(preset) {
    const today = window.api.model.todayISO();
    if (preset === 'today') { range.from = today; range.to = today; }
    else if (preset === 'week') {
      const d = new Date(); const day = (d.getDay() + 6) % 7; // Monday=0
      const monday = new Date(d); monday.setDate(d.getDate() - day);
      const off = monday.getTimezoneOffset();
      range.from = new Date(monday.getTime() - off * 60000).toISOString().slice(0, 10);
      range.to = today;
    } else { range.from = ''; range.to = ''; }
    fromInput.value = range.from; toInput.value = range.to;
    generate();
  }

  async function generate() {
    mount(tableHost, spinner(T.loading));
    const res = await window.api.report.stats({ from: range.from || null, to: range.to || null });
    if (!res.ok) { mount(tableHost, h('div', { class: 'muted', text: T.error })); return; }
    const stats = res.data;
    const rows = stats.rows.map((r) => h('tr', { class: r.count > 0 ? '' : 'row-zero' }, [
      h('td', { text: r.label }),
      h('td', { class: 'num-cell', text: String(r.count) })
    ]));
    mount(tableHost,
      h('table', { class: 'report-table' }, [
        h('thead', {}, h('tr', {}, [h('th', { text: T.treatment_type_col }), h('th', { class: 'num-cell', text: T.count_col })])),
        h('tbody', {}, rows)
      ])
    );
  }

  async function exportSummary(format) {
    mount(exportStatus, spinner(T.loading));
    const res = await window.api.report.exportSummary(format, { from: range.from || null, to: range.to || null });
    if (!res.ok) { mount(exportStatus, h('div', { class: 'muted', text: T.error + ': ' + (res.error || '') })); return; }
    showExported(res.data.file);
  }

  async function exportMaster(format) {
    mount(exportStatus, spinner(T.loading));
    const res = await window.api.report.exportMaster(format);
    if (!res.ok) { mount(exportStatus, h('div', { class: 'muted', text: T.error })); return; }
    showExported(res.data.file);
  }

  function showExported(file) {
    mount(exportStatus, h('div', { class: 'exported-ok' }, [
      h('span', { text: '✓ ' + T.exported_to + ' ' }),
      h('code', { text: file }),
      h('button', { class: 'btn btn-ghost btn-sm', onClick: () => window.api.shell.openPath(file) }, '📂 ' + T.open_folder)
    ]));
  }

  async function importMaster() {
    const res = await window.api.db.importMaster();
    if (!res.ok) { toast(T.error, 'error'); return; }
    if (!res.data) return; // cancelled
    const r = res.data;
    if (!r.ok) { toast(T.error, 'error'); return; }
    toast(T.imported_result.replace('{added}', r.added).replace('{updated}', r.updated).replace('{total}', r.total), 'success', 6000);
    generate();
  }

  const countBadge = h('span', { class: 'count-badge', text: '…' });
  window.api.db.count().then((r) => { if (r.ok) countBadge.textContent = String(r.data); });

  mount(container, h('div', { class: 'view reports-view' }, [
    h('div', { class: 'view-head' }, [h('h2', { text: T.report_summary })]),

    h('div', { class: 'card' }, [
      h('div', { class: 'filter-row' }, [
        h('div', { class: 'field' }, [h('label', { class: 'field-label', text: T.date_from }), fromInput]),
        h('div', { class: 'field' }, [h('label', { class: 'field-label', text: T.date_to }), toInput]),
        h('div', { class: 'preset-row' }, [
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => setPreset('today') }, T.today),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => setPreset('week') }, T.this_week),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: () => setPreset('all') }, T.all_time),
          h('button', { class: 'btn btn-primary btn-sm', onClick: generate }, T.generate)
        ])
      ]),
      tableHost,
      h('div', { class: 'export-row' }, [
        h('button', { class: 'btn btn-secondary', onClick: () => exportSummary('csv') }, '⬇ ' + T.export_csv),
        h('button', { class: 'btn btn-secondary', onClick: () => exportSummary('xlsx') }, '⬇ ' + T.export_xlsx),
        h('button', { class: 'btn btn-ghost', onClick: () => window.print() }, '🖨 ' + T.print_summary)
      ]),
      exportStatus
    ]),

    h('div', { class: 'card' }, [
      h('h3', { class: 'card-title' }, [T.admin_tools, ' ', h('span', { class: 'muted' }, [T.total_patients_db + ': ', countBadge])]),
      h('div', { class: 'export-row' }, [
        h('button', { class: 'btn btn-secondary', onClick: () => exportMaster('json') }, '⬇ ' + T.export_master_json),
        h('button', { class: 'btn btn-secondary', onClick: () => exportMaster('csv') }, '⬇ ' + T.export_master_csv),
        h('button', { class: 'btn btn-ghost', onClick: importMaster }, '⬆ ' + T.import_master)
      ])
    ])
  ]));

  generate();
}
