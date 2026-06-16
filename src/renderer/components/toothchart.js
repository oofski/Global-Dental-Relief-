/*
 * Hybrid tooth chart (spec 5.2 Screen C, 6.1, 6.2, 6.3).
 *
 * - Outer rings: adult Universal numbers 1–32 (upper 1–16, lower 32–17).
 * - Inner rows: primary letters a–t (upper a–j, lower t–k).
 * - One treatment item per tooth per visit. Click a tooth to add/edit:
 *     treatment type, surfaces (multi-select -> combined code e.g. DOB),
 *     surgical flag (extS), "treating today" (the paper underline) and
 *     "complete" (the paper slash-through).
 *
 * Mutates visit.treatment_items in place and calls onChange so dependent panels
 * (today's-treatment list, etc.) refresh.
 */
import { h, mount, modal } from '../util.js';
import { T } from '../i18n/index.js';

const C = window.api.codes;

function findItem(visit, tooth) {
  return (visit.treatment_items || []).find((t) => String(t.tooth) === String(tooth));
}

function toothLabel(item) {
  return item ? C.formatItem(item) : '';
}

function toothButton(visit, tooth, system, readOnly, rerender, onChange) {
  const item = findItem(visit, tooth);
  const classes = ['tooth', `tooth-${system}`];
  if (item) {
    classes.push('tooth-has');
    if (item.treating_today) classes.push('tooth-today');
    if (item.complete) classes.push('tooth-done');
    classes.push(`tx-${item.treatment_type}`);
  }
  const btn = h('button', {
    class: classes.join(' '),
    type: 'button',
    title: item ? toothLabel(item) : `${T.tooth} ${tooth}`,
    onClick: async () => {
      if (readOnly) return;
      const res = await editTooth(visit, tooth, system);
      if (res.action === 'save') {
        const existing = findItem(visit, tooth);
        if (existing) Object.assign(existing, res.item);
        else visit.treatment_items.push(res.item);
      } else if (res.action === 'remove') {
        visit.treatment_items = visit.treatment_items.filter((t) => String(t.tooth) !== String(tooth));
      } else { return; }
      rerender();
      if (onChange) onChange();
    }
  }, [
    h('span', { class: 'tooth-id', text: tooth }),
    item ? h('span', { class: 'tooth-code', text: toothLabel(item) }) : null
  ]);
  return btn;
}

function row(visit, teeth, system, readOnly, rerender, onChange) {
  return h('div', { class: 'tooth-row' },
    teeth.map((t) => toothButton(visit, t, system, readOnly, rerender, onChange)));
}

export function toothChart(visit, { readOnly = false, onChange } = {}) {
  if (!visit.treatment_items) visit.treatment_items = [];
  const host = h('div', { class: 'tooth-chart' });
  function rerender() {
    mount(host,
      h('div', { class: 'arch arch-upper' }, [
        h('div', { class: 'arch-label', text: `${T.upper} — ${T.adult_teeth}` }),
        row(visit, C.ADULT_UPPER, 'adult', readOnly, rerender, onChange),
        h('div', { class: 'arch-label arch-label-sm', text: `${T.primary_teeth}` }),
        row(visit, C.PRIMARY_UPPER, 'primary', readOnly, rerender, onChange)
      ]),
      h('div', { class: 'arch-divider' }),
      h('div', { class: 'arch arch-lower' }, [
        h('div', { class: 'arch-label arch-label-sm', text: `${T.primary_teeth}` }),
        row(visit, C.PRIMARY_LOWER, 'primary', readOnly, rerender, onChange),
        row(visit, C.ADULT_LOWER, 'adult', readOnly, rerender, onChange),
        h('div', { class: 'arch-label', text: `${T.lower} — ${T.adult_teeth}` })
      ])
    );
  }
  rerender();
  return host;
}

// ---- Tooth editor modal -------------------------------------------------
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
      const tmp = {
        tooth, treatment_type: state.treatment_type,
        surfaces: [...state.surfaces], surgical: state.surgical
      };
      preview.textContent = C.formatItem(tmp) || `${T.tooth} ${tooth}`;
    }

    // Treatment type segmented control (labels in the staff UI language)
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

    // Surfaces multi-select
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

    // Surgical
    const surgChk = h('input', { type: 'checkbox', checked: state.surgical });
    surgChk.addEventListener('change', () => { state.surgical = surgChk.checked; refreshPreview(); });
    const surgicalWrap = h('label', { class: 'checkbox' }, [surgChk, h('span', { text: T.surgical })]);

    // Treating today
    const todayChk = h('input', { type: 'checkbox', checked: state.treating_today });
    todayChk.addEventListener('change', () => { state.treating_today = todayChk.checked; });
    const todayWrap = h('label', { class: 'checkbox' }, [todayChk, h('span', { text: T.treating_today })]);

    // Complete
    const compChk = h('input', { type: 'checkbox', checked: state.complete });
    compChk.addEventListener('change', () => { state.complete = compChk.checked; });
    const compWrap = h('label', { class: 'checkbox' }, [compChk, h('span', { text: T.mark_complete })]);

    // initial visibility
    const trDef = C.TREATMENTS.find((x) => x.key === state.treatment_type);
    surfacesWrap.style.display = (trDef && trDef.needsSurfaces) ? '' : 'none';
    surgicalWrap.style.display = state.treatment_type === 'extraction' ? '' : 'none';
    refreshPreview();

    const body = h('div', { class: 'tooth-editor' }, [
      h('div', { class: 'tooth-editor-head' }, [
        h('div', { class: 'tooth-big', text: tooth }),
        preview
      ]),
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
