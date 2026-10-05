// DOM ヘルパーとダイアログ類
import { t } from './i18n.js';

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

export function icon(name) {
  const span = el('span', { className: 'icon' });
  span.innerHTML = ICONS[name] ?? '';
  return span;
}

const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
export const ICONS = {
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  check: svg('<path d="m5 12 5 5 9-10"/>'),
  download: svg('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/>'),
  upload: svg('<path d="M12 21V9m0 0-4 4m4-4 4 4M4 3h16"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  chevronDown: svg('<path d="m6 9 6 6 6-6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  columns: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  bell: svg('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
};

// ---------- 設定フォーム ----------
// fields: [{ key, label, type, hint?, placeholder?, options?, min?, max?, step?, rows?, when?, parts? }]
//   type    : text | url | number | range | checkbox | select | multicheck | textarea | color | search | parts | preview | custom
//   parts   : 文字とセレクトを 1 行に並べる(parts 用)。['毎月', { key: 'nth', options }, { key: 'weekday', options }]
//             値はセレクトごとに、その key で読み書きする
//   render  : (values) => string  入力中の値から作る説明(preview 用。値は持たない。入力のたびに書き直す)
//   options : [{ value, label }] または (values) => Promise<options>(select / multicheck 用)。
//             読み込みに失敗したら(例外)、multicheck は理由を表示し、保存しても値を変えない
//   empty   : 選択肢が 1 つも無いときの説明(multicheck 用)
//   search  : (query) => Promise<[{ label, ... }]>(search 用)。選ばれた候補のオブジェクトがそのまま値になる
//   when    : (values) => boolean  条件を満たすときだけ表示
//   create  : (value, values) => { node, read() }(custom 用)。独自の入力欄。値が変わったら node から input イベントを出す
// 見出し(アコーディオン): { type: 'section', key, label, level: 1 | 2, open? }
//   次に同じか上の level の見出しが来るまでの項目を、折りたたみの中に入れる。同じ階層で開けるのは 1 つだけ
//   outside: true の項目は、見出しの後でも見出しの外(一番上の階層)に置く

// custom の入力欄の要素 → { node, read }
const customs = new WeakMap();

function fieldControl(f, value, values) {
  const id = `f-${f.key}`;
  switch (f.type) {
    case 'preview':
      return el('p', { className: 'field-preview', id });
    case 'custom': {
      const custom = f.create(value, values);
      custom.node.id = id;
      customs.set(custom.node, custom);
      return custom.node;
    }
    case 'parts':
      return el('div', { className: 'field-parts', id }, f.parts.map((p) => {
        if (typeof p === 'string') return el('span', { textContent: p });
        const sel = el('select', { id: `f-${p.key}`, name: p.key });
        sel.dataset.value = values[p.key] ?? '';
        return sel;
      }));
    case 'checkbox':
      return el('input', { type: 'checkbox', id, name: f.key, checked: !!value });
    case 'select': {
      const sel = el('select', { id, name: f.key });
      sel.dataset.value = value ?? '';
      return sel;
    }
    case 'multicheck': {
      const box = el('div', { className: f.inline ? 'multicheck inline' : 'multicheck', id }); // inline: 曜日など短い選択肢を 1 行に詰める
      box.dataset.name = f.key;
      box.dataset.value = JSON.stringify(value ?? []);
      return box;
    }
    case 'search': {
      // 検索して候補から 1 つ選ぶ(地名など)
      const box = el('div', { className: 'search-field', id });
      box.dataset.value = JSON.stringify(value ?? null);
      const current = el('div', { className: 'search-current' });
      const input = el('input', { type: 'text', placeholder: f.placeholder ?? '', spellcheck: false });
      const button = el('button', { type: 'button', className: 'btn', textContent: t('search_field_button') });
      const results = el('div', { className: 'search-results' });
      const showCurrent = () => {
        const v = JSON.parse(box.dataset.value);
        current.textContent = v ? t('search_field_selected', { label: v.label }) : t('search_field_none');
        current.classList.toggle('empty', !v);
      };
      const message = (text) => el('p', { className: 'hint', textContent: text });
      const run = async () => {
        const query = input.value.trim();
        if (!query) return;
        results.replaceChildren(message(t('search_field_searching')));
        try {
          const options = await f.search(query);
          results.replaceChildren(...(options.length ? options.map((o) => {
            const b = el('button', { type: 'button', className: 'search-option', textContent: o.label });
            b.addEventListener('click', () => {
              box.dataset.value = JSON.stringify(o);
              showCurrent();
              results.replaceChildren();
              box.dispatchEvent(new Event('change', { bubbles: true }));
            });
            return b;
          }) : [message(t('common_not_found'))]));
        } catch (err) {
          results.replaceChildren(message(t('search_field_failed', { message: err.message })));
        }
      };
      button.addEventListener('click', run);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); // フォームを送信しない
        run();
      });
      box.append(current, el('div', { className: 'search-row' }, input, button), results);
      showCurrent();
      return box;
    }
    case 'textarea':
      return el('textarea', { id, name: f.key, rows: f.rows ?? 4, value: value ?? '', placeholder: f.placeholder ?? '', spellcheck: false });
    case 'range': {
      const input = el('input', { type: 'range', id, name: f.key, min: f.min, max: f.max, step: f.step ?? 1, value });
      const out = el('output', { value: `${value}${f.unit ?? ''}` });
      input.addEventListener('input', () => { out.value = `${input.value}${f.unit ?? ''}`; });
      return el('div', { className: 'range' }, input, out);
    }
    default:
      return el('input', {
        type: f.type ?? 'text', id, name: f.key, value: value ?? '',
        placeholder: f.placeholder ?? '', min: f.min ?? '', max: f.max ?? '', step: f.step ?? '',
        spellcheck: false,
      });
  }
}

async function fillOptions(form, fields, values) {
  for (const f of fields.flatMap((f) => (f.type === 'parts' ? f.parts.filter((p) => typeof p === 'object').map((p) => ({ ...p, type: 'select' })) : [f]))) {
    if (f.type !== 'select' && f.type !== 'multicheck') continue;
    let options;
    try {
      options = typeof f.options === 'function' ? await f.options(values) : f.options;
    } catch (err) {
      // 選択肢を読み込めなかった(通信の失敗など)。理由を出し、保存しても今の値を変えない
      const box = form.querySelector(`#f-${f.key}`);
      box.dataset.failed = 'true';
      if (f.type === 'multicheck') box.replaceChildren(el('p', { className: 'hint error', textContent: err.message }));
      continue;
    }
    if (f.type === 'select') {
      const sel = form.querySelector(`#f-${f.key}`);
      sel.replaceChildren(...options.map((o) => el('option', { value: o.value, textContent: o.label })));
      sel.value = sel.dataset.value;
      if (sel.selectedIndex === -1) sel.selectedIndex = 0;
    } else {
      const box = form.querySelector(`#f-${f.key}`);
      const checked = new Set(JSON.parse(box.dataset.value));
      box.replaceChildren(...options.map((o) =>
        el('label', {}, el('input', { type: 'checkbox', value: o.value, checked: checked.has(o.value) }), el('span', { textContent: o.label }))));
      if (!options.length && f.empty) box.append(el('p', { className: 'hint', textContent: f.empty }));
    }
  }
}

function readValues(form, fields) {
  const out = {};
  for (const f of fields) {
    const c = form.querySelector(`#f-${f.key}`);
    if (f.type === 'preview') continue;
    if (f.type === 'custom') {
      out[f.key] = customs.get(c).read();
      continue;
    }
    if (f.type === 'parts') {
      for (const p of f.parts) if (typeof p === 'object') out[p.key] = form.querySelector(`#f-${p.key}`).value;
      continue;
    }
    if (f.type === 'checkbox') out[f.key] = c.checked;
    else if (f.type === 'multicheck') out[f.key] = c.dataset.failed ? JSON.parse(c.dataset.value) : [...c.querySelectorAll('input:checked')].map((i) => i.value);
    else if (f.type === 'number' || f.type === 'range') out[f.key] = Number(c.value);
    else if (f.type === 'search') out[f.key] = JSON.parse(c.dataset.value);
    else out[f.key] = c.value;
  }
  return out;
}

// 設定ダイアログを開き、保存されたら値を、キャンセルなら null を返す。
// onInput(values): 入力のたびに呼ぶ(背景のように、保存する前に画面で試せるようにするとき用)
export function editSettings({ title, fields: all, values, onInput }) {
  const fields = all.filter((f) => f.type !== 'section');
  return new Promise((resolve) => {
    const container = el('div', { className: 'fields' });
    // 見出しの階層。末尾が今の項目を入れる先
    const stack = [{ level: 0, key: '', body: container }];
    for (const f of all) {
      if (f.type === 'section') {
        while (stack.at(-1).level >= f.level) stack.pop();
        const parent = stack.at(-1);
        const body = el('div', { className: 'fields section-body' });
        const section = el('details', { className: `section level-${f.level}`, open: !!f.open, name: `section-${parent.key}` },
          el('summary', {}, icon('chevron'), el('span', { textContent: f.label })),
          body);
        section.dataset.section = f.key;
        parent.body.append(section);
        stack.push({ level: f.level, key: f.key, body });
        continue;
      }
      const control = fieldControl(f, values[f.key], values);
      const row = f.type === 'checkbox'
        ? el('label', { className: 'field field-check' }, control, el('span', { textContent: f.label }))
        : el('div', { className: 'field' }, el('label', { htmlFor: `f-${f.key}`, textContent: f.label }), control);
      if (f.hint) row.append(el('p', { className: 'hint', textContent: f.hint }));
      row.dataset.key = f.key;
      (f.outside ? container : stack.at(-1).body).append(row);
    }

    const form = el('form', { method: 'dialog' },
      el('h2', { textContent: title }),
      container,
      el('div', { className: 'actions' },
        el('button', { type: 'button', className: 'btn', value: 'cancel', textContent: t('common_cancel') }),
        el('button', { className: 'btn primary', value: 'save', textContent: t('common_save') })));

    const updateVisibility = () => {
      const current = readValues(form, fields);
      for (const f of fields) {
        const row = form.querySelector(`[data-key="${f.key}"]`);
        if (f.when) row.hidden = !f.when(current);
        if (f.type === 'preview' && !row.hidden) row.querySelector('.field-preview').textContent = f.render(current);
      }
      onInput?.(current);
    };
    form.addEventListener('input', updateVisibility);
    form.addEventListener('change', updateVisibility);

    const dlg = showDialog(form, (ok) => resolve(ok ? readValues(form, fields) : null));
    form.querySelector('[value="cancel"]').addEventListener('click', () => dlg.close());
    fillOptions(form, fields, values).then(updateVisibility);
  });
}

// ウィジェット追加用のピッカー。新しいウィジェットなら { def }、ほかのレイアウトのウィジェットを置くなら { shared } を返す。
// shared: [{ id, type, label, where }](where はそのウィジェットを置いているレイアウトの名前)
export function pickWidget(defs, shared = []) {
  return new Promise((resolve) => {
    let picked = null;
    const item = (title, description, value) => {
      const btn = el('button', { type: 'button', className: 'picker-item' },
        el('strong', { textContent: title }),
        el('span', { textContent: description }));
      btn.addEventListener('click', () => { picked = value; dlg.close(); });
      return btn;
    };
    const list = el('div', { className: 'picker' }, defs.map((def) => item(def.name, def.description ?? '', { def })));
    // ほかのレイアウトのウィジェットは、ふだんは折りたたんでおく(新しく置くことの方が多いので)
    const sharedList = shared.length ? el('details', { className: 'picker-more' },
      el('summary', {}, icon('chevron'), el('span', { textContent: t('picker_shared') })),
      el('p', { className: 'hint', textContent: t('picker_shared_hint') }),
      el('div', { className: 'picker picker-shared' }, shared.map((w) => item(w.label, t('picker_shared_in', { layouts: w.where }), { shared: w })))) : null;
    // 開いたら、下に固定したボタンの裏に隠れないよう、中身が見えるところまでスクロールする
    sharedList?.addEventListener('toggle', () => {
      if (sharedList.open) sharedList.scrollIntoView({ block: 'nearest' });
    });
    const form = el('form', { method: 'dialog' },
      el('h2', { textContent: t('toolbar_add_widget') }),
      list,
      sharedList,
      el('div', { className: 'actions' }, el('span'), el('button', { className: 'btn', textContent: t('common_close') })));
    const dlg = showDialog(form, () => resolve(picked));
  });
}

// ダイアログを開く。onClose(保存ボタンで閉じたか)。閉じるには戻り値の close()
export function showDialog(content, onClose = () => {}) {
  const dlg = el('dialog', { className: 'dialog' }, content);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // 背景クリックで閉じる
  dlg.addEventListener('close', () => {
    onClose(dlg.returnValue === 'save');
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// ---------- リンク関連 ----------

// Chrome の _favicon API(manifest の "favicon" 権限が必要)
export const faviconUrl = (pageUrl, size = 32) =>
  `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}`;

// http(s) 以外(chrome:// など)は拡張ページの <a> から直接開けないので tabs API で開く。
// container 内の selector に一致するリンクのクリックを処理する
const NATIVE_PROTOCOLS = new Set(['http:', 'https:']);
export function handleSpecialLinks(container, selector, { newTab = () => false } = {}) {
  container.addEventListener('click', (e) => {
    const a = e.target.closest(selector);
    if (!a || e.button !== 0) return;
    if (a.classList.contains('disabled')) {
      e.preventDefault();
      return;
    }
    if (NATIVE_PROTOCOLS.has(new URL(a.href).protocol)) return;
    e.preventDefault();
    if (newTab() || e.ctrlKey || e.metaKey || e.shiftKey) chrome.tabs.create({ url: a.href });
    else chrome.tabs.update({ url: a.href });
  });
}

// 必要になったときだけ読み込むライブラリ用。同じ src は 1 回だけ読み込む
const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const script = el('script', { src });
      script.addEventListener('load', resolve);
      script.addEventListener('error', () => {
        scripts.delete(src); // 次回やり直せるように
        reject(new Error(t('script_load_failed', { src })));
      });
      document.head.append(script);
    }));
  }
  return scripts.get(src);
}

export function downloadJSON(filename, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: filename }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files[0] ?? null));
    input.click();
  });
}
