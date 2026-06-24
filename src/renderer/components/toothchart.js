/*
 * Tooth chart (spec 5.2 Screen C, 6.1–6.3) + v1.1.1 enhancements:
 *   - Layout dropdown: hybrid (adult + primary), full adult (1–32), full primary (a–t).
 *   - Two modes: "Treatment" (click a tooth -> code editor) and "Health status"
 *     (click a tooth to cycle yellow=watch / red=needs-care).
 *     Legacy records with a stored 'healthy' (green) value still render, but
 *     'healthy' is no longer offered in the cycle or legend.
 *     Health tint is independent of, and layered under, the treatment colours.
 *   - onChange fires on any change so callers can auto-fill treatment notes.
 *
 * Mutates visit.treatment_items and visit.tooth_conditions in place.
 */
import { h, mount, modal } from '../util.js';
import { T } from '../i18n/index.js';

const C = window.api.codes;
const COND_CYCLE = [null, 'watch', 'urgent'];

function findItem(visit, tooth) {
  return (visit.treatment_items || []).find((t) => String(t.tooth) === String(tooth));
}
function toothLabel(item) { return item ? C.formatItem(item) : ''; }

function toothButton(ctx, tooth, system) {
  const { visit, readOnly } = ctx;
  const item = findItem(visit, tooth);
  const cond = (visit.tooth_conditions || {})[tooth] || null;
  const classes = ['tooth', `tooth-${system}`];
  if (cond) classes.push('cond-' + cond);
  if (item) {
    classes.push('tooth-has');
    if (item.treating_today) classes.push('tooth-today');
    if (item.complete) classes.push('tooth-done');
    classes.push(`tx-${item.treatment_type}`);
  }
  return h('button', {
    class: classes.join(' '),
    type: 'button',
    title: item ? toothLabel(item) : `${T.tooth} ${tooth}`,
    onClick: async () => {
      if (readOnly) return;
      if (ctx.mode() === 'health') {
        visit.tooth_conditions = visit.tooth_conditions || {};
        const cur = visit.tooth_conditions[tooth] || null;
        const next = COND_CYCLE[(COND_CYCLE.indexOf(cur) + 1) % COND_CYCLE.length];
        if (next) visit.tooth_conditions[tooth] = next; else delete visit.tooth_conditions[tooth];
        ctx.rerender();
        if (ctx.onChange) ctx.onChange();
        return;
      }
      const res = await editTooth(visit, tooth, system);
      if (res.action === 'save') {
        const ex = findItem(visit, tooth);
        if (ex) Object.assign(ex, res.item); else visit.treatment_items.push(res.item);
      } else if (res.action === 'remove') {
        visit.treatment_items = visit.treatment_items.filter((t) => String(t.tooth) !== String(tooth));
      } else { return; }
      ctx.rerender();
      if (ctx.onChange) ctx.onChange();
    }
  }, [
    h('span', { class: 'tooth-id', text: tooth }),
    item ? h('span', { class: 'tooth-code', text: toothLabel(item) }) : null
  ]);
}

function row(ctx, teeth, system) {
  return h('div', { class: 'tooth-row' }, teeth.map((t) => toothButton(ctx, t, system)));
}

export function toothChart(visit, { readOnly = false, onChange } = {}) {
  if (!visit.treatment_items) visit.treatment_items = [];
  if (!visit.tooth_conditions) visit.tooth_conditions = {};
  if (!visit.chart_view) visit.chart_view = 'hybrid';
  let mode = 'treatment';

  const host = h('div', { class: 'tooth-chart-wrap' });
  const ctx = { visit, readOnly, mode: () => mode, rerender, onChange };

  function archRows() {
    const v = visit.chart_view;
    const upper = [];
    const lower = [];
    if (v === 'hybrid' || v === 'adult') {
      upper.push(h('div', { class: 'arch-label', text: `${T.upper} — ${T.adult_teeth}` }), row(ctx, C.ADULT_UPPER, 'adult'));
    }
    if (v === 'hybrid' || v === 'primary') {
      upper.push(h('div', { class: 'arch-label arch-label-sm', text: T.primary_teeth }), row(ctx, C.PRIMARY_UPPER, 'primary'));
      lower.push(h('div', { class: 'arch-label arch-label-sm', text: T.primary_teeth }), row(ctx, C.PRIMARY_LOWER, 'primary'));
    }
    if (v === 'hybrid' || v === 'adult') {
      lower.push(row(ctx, C.ADULT_LOWER, 'adult'), h('div', { class: 'arch-label', text: `${T.lower} — ${T.adult_teeth}` }));
    }
    return [
      h('div', { class: 'arch arch-upper' }, upper),
      h('div', { class: 'arch-divider' }),
      h('div', { class: 'arch arch-lower' }, lower)
    ];
  }

  function toolbar() {
    const sel = h('select', { class: 'text-input chart-view-select' }, [
      h('option', { value: 'hybrid', text: T.view_hybrid }),
      h('option', { value: 'adult', text: T.view_adult }),
      h('option', { value: 'primary', text: T.view_primary })
    ]);
    sel.value = visit.chart_view;
    sel.addEventListener('change', () => { visit.chart_view = sel.value; rerender(); });

    const modeSeg = h('div', { class: 'seg' }, [
      h('button', { class: 'seg-btn' + (mode === 'treatment' ? ' active' : ''), type: 'button', onClick: () => { mode = 'treatment'; rerender(); } }, T.chart_mode_treatment),
      h('button', { class: 'seg-btn' + (mode === 'health' ? ' active' : ''), type: 'button', onClick: () => { mode = 'health'; rerender(); } }, T.chart_mode_health)
    ]);

    return h('div', { class: 'chart-toolbar' }, [
      h('div', { class: 'chart-toolbar-grp' }, [h('label', { class: 'field-label', text: T.chart_view_label }), sel]),
      readOnly ? null : h('div', { class: 'chart-toolbar-grp' }, [modeSeg])
    ]);
  }

  function legend() {
    if (mode !== 'health') return null;
    return h('div', { class: 'health-legend' }, [
      h('span', { class: 'cond-key cond-watch', text: T.cond_watch }),
      h('span', { class: 'cond-key cond-urgent', text: T.cond_urgent }),
      h('span', { class: 'health-hint', text: T.chart_health_hint })
    ]);
  }

  function rerender() {
    mount(host,
      toolbar(),
      legend(),
      h('div', { class: 'tooth-chart' + (mode === 'health' ? ' mode-health' : '') }, archRows())
    );
  }
  rerender();
  return host;
}

// ---- Tooth treatment editor modal --------------------------------------
function editTooth(visit, tooth, system) {
  const existing = findItem(visit, tooth);
  const item = existing
    ? JSON.parse(JSON.stringify(existing))
    : window.api.model.newTreatmentItem(tooth);
  item.tooth = tooth;

  return new Promise((resolve) => {
    const state = {
      treatment_type: item.treatment_type || 'restoration',
      surfaces: new Set(item.surfaces || []),
      surgical: !!item.surgical,
      treating_today: item.treating_today !== false,
      complete: !!item.complete
    };

    const preview = h('div', { class: 'tooth-preview' });
    function refreshPreview() {
      const tmp = { tooth, treatment_type: state.treatment_type, surfaces: [...state.surfaces], surgical: state.surgical };
      preview.textContent = C.formatItem(tmp) || `${T.tooth} ${tooth}`;
    }

    const typeRow = h('div', { class: 'seg' }, C.TREATMENTS.map((tr) =>
      h('button', {
        class: 'seg-btn' + (state.treatment_type === tr.key ? ' active' : ''),
        type: 'button',
        onClick: () => {
          state.treatment_type = tr.key;
          [...typeRow.children].forEach((c, i) => c.classList.toggle('active', C.TREATMENTS[i].key === tr.key));
          surfacesWrap.style.display = tr.needsSurfaces ? '' : 'none';
          surgicalWrap.style.display = tr.key === 'extraction' ? '' : 'none';
          refreshPreview();
        }
      }, T['tx_' + tr.key] || tr.es)
    ));

    const surfBtns = C.SURFACES.map((s) =>
      h('button', {
        class: 'surf-btn' + (state.surfaces.has(s.code) ? ' active' : ''),
        type: 'button',
        title: T['surf_' + s.code] || s.es,
        onClick: (e) => {
          if (state.surfaces.has(s.code)) state.surfaces.delete(s.code);
          else state.surfaces.add(s.code);
          e.currentTarget.classList.toggle('active');
          refreshPreview();
        }
      }, `${s.code}`)
    );
    const surfacesWrap = h('div', { class: 'field' }, [
      h('label', { class: 'field-label', text: T.surfaces }),
      h('div', { class: 'surf-row' }, surfBtns)
    ]);

    const surgChk = h('input', { type: 'checkbox', checked: state.surgical });
    surgChk.addEventListener('change', () => { state.surgical = surgChk.checked; refreshPreview(); });
    const surgicalWrap = h('label', { class: 'checkbox' }, [surgChk, h('span', { text: T.surgical })]);

    const todayChk = h('input', { type: 'checkbox', checked: state.treating_today });
    todayChk.addEventListener('change', () => { state.treating_today = todayChk.checked; });
    const todayWrap = h('label', { class: 'checkbox' }, [todayChk, h('span', { text: T.treating_today })]);

    const compChk = h('input', { type: 'checkbox', checked: state.complete });
    compChk.addEventListener('change', () => { state.complete = compChk.checked; });
    const compWrap = h('label', { class: 'checkbox' }, [compChk, h('span', { text: T.mark_complete })]);

    const trDef = C.TREATMENTS.find((x) => x.key === state.treatment_type);
    surfacesWrap.style.display = (trDef && trDef.needsSurfaces) ? '' : 'none';
    surgicalWrap.style.display = state.treatment_type === 'extraction' ? '' : 'none';
    refreshPreview();

    const body = h('div', { class: 'tooth-editor' }, [
      h('div', { class: 'tooth-editor-head' }, [h('div', { class: 'tooth-big', text: tooth }), preview]),
      h('div', { class: 'field' }, [h('label', { class: 'field-label', text: T.treatment_type }), typeRow]),
      surfacesWrap,
      surgicalWrap,
      h('div', { class: 'editor-checks' }, [todayWrap, compWrap])
    ]);

    modal({
      title: `${T.tooth} ${tooth}`,
      body,
      actions: [
        existing ? { label: T.remove_tooth, value: '__remove__', danger: true } : null,
        { label: T.cancel, value: '__cancel__' },
        { label: T.save, value: '__save__', primary: true }
      ].filter(Boolean)
    }).then((val) => {
      if (val === '__save__') {
        resolve({
          action: 'save',
          item: {
            id: item.id,
            tooth,
            treatment_type: state.treatment_type,
            surfaces: [...state.surfaces],
            surgical: state.treatment_type === 'extraction' ? state.surgical : false,
            treating_today: state.treating_today,
            complete: state.complete
          }
        });
      } else if (val === '__remove__') {
        resolve({ action: 'remove' });
      } else {
        resolve({ action: 'cancel' });
      }
    });
  });
}
