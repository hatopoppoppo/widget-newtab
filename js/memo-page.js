import * as store from './store.js';
import { el, icon } from './ui.js';
import { memoEditor, memoTitle } from './memo-core.js';
import { t, applyI18n } from './i18n.js';
import { applyTheme } from './theme.js';

// メモ専用ページ(memo.html#<メモの id>)。左に一覧、右に編集とプレビュー。
// メモウィジェットと同じ chrome.storage.local の memo:<id> を読み書きするので、両方を開いていても内容は揃う

const VIEW_KEY = 'memoPage'; // chrome.storage.local。{ mode: 'edit' | 'split' | 'preview', side: boolean }
const MODES = { edit: 'edit', split: 'columns', preview: 'eye' };

const $ = (sel) => document.querySelector(sel);
const textarea = $('#memo-text');
const preview = $('#memo-preview');
const status = $('#memo-status');

let memos = [];
let currentId = null;
let view = { mode: 'split', side: true };

const newId = () => crypto.randomUUID().slice(0, 8);
const idFromHash = () => decodeURIComponent(location.hash.slice(1));

const editor = memoEditor({
  textarea,
  preview,
  onChange: (memo) => {
    if (memo) showSaved(memo);
    else openMemo(memos.find((m) => m.id !== currentId)?.id ?? newId()); // 他のタブで削除された
  },
});

applyI18n();
init();

async function init() {
  // 表示しているレイアウトの見た目に合わせる(レイアウトを切り替えたときや、その設定を変えたときも)
  const refreshTheme = async () => applyTheme(await store.loadPrefs());
  await refreshTheme();
  store.onExternalChange({ prefs: refreshTheme, layouts: refreshTheme, active: refreshTheme });

  for (const [mode, name] of Object.entries(MODES)) $(`[data-mode="${mode}"]`).append(icon(name));
  $('#new-memo').append(icon('plus'));
  $('#toggle-side').append(icon('menu'));
  $('#delete-memo').append(icon('trash'));

  view = { ...view, ...(await chrome.storage.local.get(VIEW_KEY))[VIEW_KEY] };
  applyView();

  memos = await store.listMemos();
  await openMemo(idFromHash() || memos[0]?.id || newId());

  bindEvents();
  let refreshTimer;
  store.onMemoChange(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshList, 100);
  });
}


function applyView() {
  $('#memo-panes').dataset.mode = view.mode;
  document.body.classList.toggle('side-hidden', !view.side);
  for (const b of document.querySelectorAll('[data-mode]')) b.classList.toggle('active', b.dataset.mode === view.mode);
}

function setView(patch) {
  view = { ...view, ...patch };
  applyView();
  chrome.storage.local.set({ [VIEW_KEY]: view });
}

async function openMemo(id) {
  currentId = id;
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  const memo = await editor.open(id);
  if (memo) showSaved(memo);
  else status.textContent = '';
  renderList();
}

function showSaved(memo) {
  document.title = t('memo_page_title_with', { title: memoTitle(memo.body) });
  const time = new Date(memo.updated).toLocaleString(t('locale'), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  status.textContent = t('memo_saved_at', { time });
}

async function refreshList() {
  memos = await store.listMemos();
  renderList();
}

// 一覧。開いているメモがまだ保存されていなければ、先頭に仮の項目を出す
function renderList() {
  const query = $('#memo-filter').value.trim().toLowerCase();
  const items = memos.some((m) => m.id === currentId) ? memos : [{ id: currentId, body: textarea.value, updated: null }, ...memos];
  const shown = query ? items.filter((m) => m.body.toLowerCase().includes(query)) : items;
  $('#memo-list').replaceChildren(...shown.map((m) => {
    const date = m.updated ? formatDate(m.updated) : t('memo_unsaved');
    const btn = el('button', { type: 'button', className: 'memo-item' },
      el('span', { className: 'memo-item-title', textContent: memoTitle(m.body) }),
      el('span', { className: 'memo-item-date', textContent: date }));
    btn.classList.toggle('active', m.id === currentId);
    btn.addEventListener('click', () => {
      if (m.id !== currentId) openMemo(m.id);
    });
    return el('li', {}, btn);
  }));
  if (!shown.length) $('#memo-list').append(el('li', { className: 'memo-list-empty', textContent: t('common_not_found') }));
}

function formatDate(ms) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(t('locale'), { year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', month: 'numeric', day: 'numeric' });
}

function bindEvents() {
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => setView({ mode: b.dataset.mode }));
  }
  $('#toggle-side').addEventListener('click', () => setView({ side: !view.side }));
  $('#memo-filter').addEventListener('input', renderList);
  $('#new-memo').addEventListener('click', async () => {
    await openMemo(newId());
    if (view.mode === 'preview') setView({ mode: 'split' });
    textarea.focus();
  });
  $('#delete-memo').addEventListener('click', async () => {
    if (!confirm(t('memo_confirm_delete', { title: memoTitle(textarea.value) }))) return;
    const id = currentId;
    const next = memos.find((m) => m.id !== id)?.id ?? newId();
    await store.removeMemo(id);
    memos = memos.filter((m) => m.id !== id);
    await openMemo(next);
  });
  textarea.addEventListener('input', () => {
    status.textContent = t('memo_editing');
    // 一覧のタイトルは保存を待たずに更新する
    const title = $('#memo-list .memo-item.active .memo-item-title');
    if (title) title.textContent = memoTitle(textarea.value);
  });
  addEventListener('hashchange', () => {
    const id = idFromHash();
    if (id && id !== currentId) openMemo(id);
  });
}
