// グラデーション: 設定の値から CSS を作る関数と、設定ダイアログで使う編集画面
//
// 値: { kind: linear | radial | conic, angle, shape: ellipse | circle, x, y, repeat, stops: [{ color: '#rrggbb', pos: 0〜100 }] }
// CSS の linear-gradient / radial-gradient / conic-gradient(repeat なら repeating-*)の引数を、つまみで操作できるようにしたもの
import { el, icon } from './ui.js';
import { t } from './i18n.js';

export const GRADIENT_PRESETS = [
  { kind: 'linear', angle: 135, stops: [{ color: '#4f46e5', pos: 0 }, { color: '#ec4899', pos: 100 }] },
  { kind: 'linear', angle: 180, stops: [{ color: '#0f172a', pos: 0 }, { color: '#1e3a8a', pos: 60 }, { color: '#0ea5e9', pos: 100 }] },
  { kind: 'linear', angle: 160, stops: [{ color: '#fde68a', pos: 0 }, { color: '#f97316', pos: 50 }, { color: '#be185d', pos: 100 }] },
  { kind: 'linear', angle: 120, stops: [{ color: '#d1fae5', pos: 0 }, { color: '#a5f3fc', pos: 100 }] },
  { kind: 'radial', shape: 'ellipse', x: 50, y: 0, stops: [{ color: '#334155', pos: 0 }, { color: '#0b1020', pos: 100 }] },
  { kind: 'radial', shape: 'circle', x: 20, y: 20, stops: [{ color: '#f0abfc', pos: 0 }, { color: '#818cf8', pos: 45 }, { color: '#1e1b4b', pos: 100 }] },
  { kind: 'conic', angle: 0, x: 50, y: 50, stops: [{ color: '#f43f5e', pos: 0 }, { color: '#facc15', pos: 33 }, { color: '#22d3ee', pos: 66 }, { color: '#f43f5e', pos: 100 }] },
  { kind: 'linear', angle: 45, repeat: true, stops: [{ color: '#1f2937', pos: 0 }, { color: '#1f2937', pos: 2 }, { color: '#374151', pos: 2 }, { color: '#374151', pos: 4 }] },
];

const BASE = { kind: 'linear', angle: 135, shape: 'ellipse', x: 50, y: 50, repeat: false };
export const normalizeGradient = (g) => ({
  ...BASE,
  ...g,
  stops: (g?.stops?.length >= 2 ? g.stops : [{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 100 }]).map((s) => ({ ...s })),
});

const sortedStops = (stops) => [...stops].sort((a, b) => a.pos - b.pos);
const stopList = (stops) => sortedStops(stops).map((s) => `${s.color} ${s.pos}%`).join(', ');

// background に入れる CSS
export function gradientCss(value) {
  const g = normalizeGradient(value);
  const prefix = g.repeat ? 'repeating-' : '';
  switch (g.kind) {
    case 'radial':
      return `${prefix}radial-gradient(${g.shape} at ${g.x}% ${g.y}%, ${stopList(g.stops)})`;
    case 'conic':
      return `${prefix}conic-gradient(from ${g.angle}deg at ${g.x}% ${g.y}%, ${stopList(g.stops)})`;
    default:
      return `${prefix}linear-gradient(${g.angle}deg, ${stopList(g.stops)})`;
  }
}

// pos(%)の位置の色。バーをクリックして色を足すとき、その場所の今の色にする
export function colorAt(stops, pos) {
  const list = sortedStops(stops);
  if (pos <= list[0].pos) return list[0].color;
  if (pos >= list.at(-1).pos) return list.at(-1).color;
  const i = list.findIndex((s) => s.pos >= pos);
  const [a, b] = [list[i - 1], list[i]];
  const r = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
  const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const [ca, cb] = [rgb(a.color), rgb(b.color)];
  return `#${ca.map((v, k) => Math.round(v + (cb[k] - v) * r).toString(16).padStart(2, '0')).join('')}`;
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 設定ダイアログの custom 欄(ui.js)。{ node, read }
export function gradientEditor(value) {
  let g = normalizeGradient(value);
  let selected = 0; // 選んでいる色(g.stops の番号)

  const node = el('div', { className: 'gradient-editor' });
  const emit = () => node.dispatchEvent(new Event('input', { bubbles: true }));

  // ---------- 見本 ----------
  const preview = el('div', { className: 'ge-preview' });

  // ---------- 色のバー(つまみ) ----------
  const bar = el('div', { className: 'ge-bar', title: t('gradient_bar_title') });
  const track = el('div', { className: 'ge-track' });
  bar.append(track);
  const posFromEvent = (e) => {
    const r = bar.getBoundingClientRect();
    return clamp(Math.round(((e.clientX - r.left) / r.width) * 100), 0, 100);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (e.target !== bar && e.target !== track) return;
    const pos = posFromEvent(e);
    g.stops.push({ color: colorAt(g.stops, pos), pos });
    selected = g.stops.length - 1;
    render();
    emit();
  });

  // ---------- 選んだ色 ----------
  const stopColor = el('input', { type: 'color', className: 'ge-stop-color', title: t('gradient_stop_color') });
  const stopPos = el('input', { type: 'range', className: 'ge-stop-pos', min: 0, max: 100, step: 1 });
  const stopPosOut = el('output', { className: 'ge-out' });
  const stopDelete = el('button', { type: 'button', className: 'btn ge-stop-delete', title: t('gradient_stop_delete') }, icon('trash'));
  stopColor.addEventListener('input', (e) => {
    e.stopPropagation();
    g.stops[selected].color = stopColor.value;
    render();
    emit();
  });
  stopPos.addEventListener('input', (e) => {
    e.stopPropagation();
    g.stops[selected].pos = Number(stopPos.value);
    render();
    emit();
  });
  stopDelete.addEventListener('click', () => removeStop(selected));
  function removeStop(i) {
    if (g.stops.length <= 2) return;
    g.stops.splice(i, 1);
    selected = Math.min(selected, g.stops.length - 1);
    render();
    emit();
  }

  // ---------- 種類・角度・中心など ----------
  const control = (label, input, out) => el('label', { className: 'ge-control' }, el('span', { textContent: label }), input, out ?? null);
  const kind = el('select', { className: 'ge-kind' },
    ['linear', 'radial', 'conic'].map((k) => el('option', { value: k, textContent: t(`gradient_kind_${k}`) })));
  const shape = el('select', { className: 'ge-shape' },
    el('option', { value: 'ellipse', textContent: t('gradient_shape_ellipse') }),
    el('option', { value: 'circle', textContent: t('gradient_shape_circle') }));
  const range = (min, max) => el('input', { type: 'range', min, max, step: 1 });
  const angle = range(0, 360);
  const x = range(0, 100);
  const y = range(0, 100);
  const outs = { angle: el('output', { className: 'ge-out' }), x: el('output', { className: 'ge-out' }), y: el('output', { className: 'ge-out' }) };
  const repeat = el('input', { type: 'checkbox', className: 'ge-repeat' });
  const rows = {
    kind: control(t('gradient_kind'), kind),
    shape: control(t('gradient_shape'), shape),
    angle: control(t('gradient_angle'), angle, outs.angle),
    x: control(t('gradient_center_x'), x, outs.x),
    y: control(t('gradient_center_y'), y, outs.y),
  };
  const repeatRow = el('label', { className: 'ge-check' }, repeat, el('span', { textContent: t('gradient_repeat') }));
  const bind = (input, key, read = (v) => Number(v)) => input.addEventListener(input.type === 'checkbox' ? 'change' : 'input', (e) => {
    e.stopPropagation();
    g[key] = input.type === 'checkbox' ? input.checked : read(input.value);
    render();
    emit();
  });
  bind(kind, 'kind', String);
  bind(shape, 'shape', String);
  bind(angle, 'angle');
  bind(x, 'x');
  bind(y, 'y');
  bind(repeat, 'repeat');

  // ---------- 見本から選ぶ ----------
  const presets = el('div', { className: 'ge-presets' }, GRADIENT_PRESETS.map((p, i) => {
    const b = el('button', { type: 'button', className: 'ge-preset', title: t('gradient_preset', { n: i + 1 }) });
    b.style.background = gradientCss(p);
    b.addEventListener('click', () => {
      g = normalizeGradient(p);
      selected = 0;
      render();
      emit();
    });
    return b;
  }));

  // ---------- CSS ----------
  const css = el('code', { className: 'ge-css' });

  node.append(
    preview,
    bar,
    el('div', { className: 'ge-stop' }, el('span', { className: 'ge-label', textContent: t('gradient_stop') }), stopColor, stopPos, stopPosOut, stopDelete),
    el('p', { className: 'hint', textContent: t('gradient_bar_hint') }),
    el('div', { className: 'ge-controls' }, rows.kind, rows.shape, rows.angle, rows.x, rows.y, repeatRow),
    el('div', { className: 'ge-section' }, el('span', { className: 'ge-label', textContent: t('gradient_presets') }), presets),
    el('div', { className: 'ge-section' }, el('span', { className: 'ge-label', textContent: 'CSS' }), css),
  );

  function makeHandle(stop, i) {
    const h = el('button', {
      type: 'button',
      className: `ge-handle${i === selected ? ' selected' : ''}`,
      title: t('gradient_stop_title', { n: i + 1, pos: stop.pos }),
    });
    h.style.left = `${stop.pos}%`;
    h.style.background = stop.color;
    h.dataset.index = i;
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      selected = i;
      h.setPointerCapture(e.pointerId);
      render();
      h.focus();
      const move = (ev) => {
        g.stops[i].pos = posFromEvent(ev);
        render();
        emit();
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        g.stops[i].pos = clamp(g.stops[i].pos + (e.key === 'ArrowLeft' ? -step : step), 0, 100);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeStop(i);
        return;
      } else {
        return;
      }
      selected = i;
      render();
      emit();
    });
    h.addEventListener('focus', () => {
      if (selected === i) return;
      selected = i;
      render();
    });
    return h;
  }

  function render() {
    const cssText = gradientCss(g);
    preview.style.background = cssText;
    track.style.background = `linear-gradient(90deg, ${stopList(g.stops)})`;
    css.textContent = `background: ${cssText};`;
    const handles = [...bar.querySelectorAll('.ge-handle')];
    // つまみの要素は、色の数が変わったときだけ作り直す(ドラッグ中のポインターのキャプチャやフォーカスを保つため)
    if (handles.length === g.stops.length) {
      handles.forEach((h, i) => {
        h.style.left = `${g.stops[i].pos}%`;
        h.style.background = g.stops[i].color;
        h.title = t('gradient_stop_title', { n: i + 1, pos: g.stops[i].pos });
        h.classList.toggle('selected', i === selected);
      });
    } else {
      for (const h of handles) h.remove();
      bar.append(...g.stops.map(makeHandle));
    }
    const stop = g.stops[selected];
    stopColor.value = stop.color;
    stopPos.value = stop.pos;
    stopPosOut.value = `${stop.pos}%`;
    stopDelete.disabled = g.stops.length <= 2;

    kind.value = g.kind;
    shape.value = g.shape;
    angle.value = g.angle;
    x.value = g.x;
    y.value = g.y;
    repeat.checked = g.repeat;
    outs.angle.value = `${g.angle}°`;
    outs.x.value = `${g.x}%`;
    outs.y.value = `${g.y}%`;
    rows.shape.hidden = g.kind !== 'radial';
    rows.angle.hidden = g.kind === 'radial';
    rows.x.hidden = rows.y.hidden = g.kind === 'linear';
  }
  render();

  return { node, read: () => ({ ...g, stops: g.stops.map((s) => ({ ...s })) }) };
}
