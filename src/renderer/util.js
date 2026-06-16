/* DOM + UI helpers for the renderer (vanilla, no framework). */
import { T } from './i18n/es.js';

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'disabled') { if (v) el.setAttribute('disabled', ''); }
    else el.setAttribute(k, v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

export function mount(node, ...children) {
  clear(node);
  children.flat().forEach((c) => { if (c != null && c !== false) node.appendChild(c); });
  return node;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = iso.length <= 10 ? iso : iso.slice(0, 10);
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
}

export function timeSince(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return '—';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  if (hr < 24) return `${hr} h ${rem} min`;
  const days = Math.floor(hr / 24);
  return `${days} d ${hr % 24} h`;
}

// ---- Toast notifications ----
let toastHost = null;
export function toast(message, kind = 'info', ms = 3500) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
    document.body.appendChild(toastHost);
  }
  const t = h('div', { class: `toast toast-${kind}`, text: message });
  toastHost.appendChild(t);
  setTimeout(() => { t.classList.add('show'); }, 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// ---- Modal dialog ----
export function modal({ title, body, actions }) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal-overlay' });
    const close = (val) => { overlay.remove(); resolve(val); };
    const bodyNode = typeof body === 'string' ? h('div', { text: body }) : body;
    const actionRow = h('div', { class: 'modal-actions' },
      (actions || [{ label: T.ok, value: true, primary: true }]).map((a) =>
        h('button', {
          class: 'btn ' + (a.primary ? 'btn-primary' : (a.danger ? 'btn-danger' : 'btn-ghost')),
          onClick: () => close(a.value)
        }, a.label)
      )
    );
    const box = h('div', { class: 'modal-box' }, [
      title ? h('h3', { class: 'modal-title', text: title }) : null,
      h('div', { class: 'modal-body' }, bodyNode),
      actionRow
    ]);
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(undefined); });
    document.body.appendChild(overlay);
  });
}

export function confirmDialog(title, message, { danger = false } = {}) {
  return modal({
    title,
    body: message,
    actions: [
      { label: T.cancel, value: false },
      { label: T.confirm, value: true, primary: !danger, danger }
    ]
  });
}

export function alertDialog(title, message) {
  return modal({ title, body: message, actions: [{ label: T.ok, value: true, primary: true }] });
}

// ---- Field builders ----
export function field(labelText, control, { hint, required } = {}) {
  return h('div', { class: 'field' }, [
    h('label', { class: 'field-label' }, [
      labelText,
      required ? h('span', { class: 'req', text: ' *' }) : null
    ]),
    control,
    hint ? h('div', { class: 'field-hint', text: hint }) : null
  ]);
}

export function checkbox(labelText, checked, onChange, { id } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!checked, id });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'checkbox' }, [input, h('span', { text: labelText })]);
}

export function spinner(text) {
  return h('div', { class: 'spinner' }, [h('div', { class: 'spinner-dot' }), text || T.loading]);
}
