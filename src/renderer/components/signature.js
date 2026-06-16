/*
 * Signature capture pad (spec 5.1 Screen C).
 * Works with finger / stylus (Pointer Events) on a touchscreen, or mouse on a
 * laptop. Returns a PNG dataURL. A typed-name fallback is provided by the view.
 */
import { h } from '../util.js';
import { T } from '../i18n/es.js';

export function signaturePad(onChange) {
  const canvas = h('canvas', { class: 'sig-canvas', width: 600, height: 180 });
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#13343b';

  let drawing = false;
  let dirty = false;
  let last = null;

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const scaleX = canvas.width / r.width;
    const scaleY = canvas.height / r.height;
    return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
  }
  function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    dirty = true;
    e.preventDefault();
  }
  function end() {
    if (drawing && dirty && onChange) onChange(canvas.toDataURL('image/png'));
    drawing = false;
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);

  function clearPad() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty = false;
    if (onChange) onChange(null);
  }

  const clearBtn = h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: clearPad }, T.clear_signature);

  const wrap = h('div', { class: 'sig-wrap' }, [
    h('div', { class: 'sig-hint', text: T.signature_hint }),
    canvas,
    h('div', { class: 'sig-toolbar' }, [clearBtn])
  ]);

  return { node: wrap, clear: clearPad, isDirty: () => dirty, dataURL: () => (dirty ? canvas.toDataURL('image/png') : null) };
}
