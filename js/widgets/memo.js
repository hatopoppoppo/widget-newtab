import { el, icon } from '../ui.js';
import { t } from '../i18n.js';
import * as store from '../store.js';
import { memoEditor, memoTitle, memoPageUrl } from '../memo-core.js';

// メモ(Markdown)。ふだんは整形して表示し、クリックで編集する。
// 中身は chrome.storage.local の memo:<id> に保存する(同期しない)。メモ専用ページ(memo.html)でも同じメモを開ける。
// ウィジェットを削除してもメモは消さない(メモ専用ページから消す)

const NEW_MEMO = '__new';

export default {
  type: 'memo',
  name: t('memo_name'),
  shareable: true, // 中身を持つので、ほかのレイアウトにも同じものを置く意味がある
  description: t('memo_description'),
  size: { w: 6, h: 6, minW: 3, minH: 2 },
  defaults: {
    memoId: '', // 空ならウィジェットの id をメモの id にする
    showTabs: true,
  },
  fields: [
    {
      key: 'memoId', label: t('memo_select'), type: 'select',
      options: async (values) => {
        const memos = await store.listMemos();
        const options = memos.map((m) => ({ value: m.id, label: memoTitle(m.body) }));
        if (values.memoId && !memos.some((m) => m.id === values.memoId)) options.unshift({ value: values.memoId, label: t('memo_untitled_unsaved') });
        return [...options, { value: NEW_MEMO, label: t('memo_new_option') }];
      },
      hint: t('memo_select_hint'),
    },
    { key: 'showTabs', label: t('memo_show_tabs'), type: 'checkbox' },
  ],

  mount(root, config, ctx) {
    const newMemoId = () => crypto.randomUUID().slice(0, 8);
    let memoId = null;

    const textarea = el('textarea', { className: 'memo-text', spellcheck: false, placeholder: t('memo_text_placeholder') });
    const preview = el('div', { className: 'md memo-preview', tabIndex: 0 });
    preview.dataset.placeholder = t('memo_click_to_write');
    const tabs = el('div', { className: 'memo-tabs', role: 'tablist', ariaOrientation: 'vertical' });
    const addBtn = el('button', { type: 'button', className: 'memo-add', title: t('memo_new') }, icon('plus'), el('span', { textContent: t('memo_new') }));
    const editBtn = el('button', { type: 'button', className: 'memo-btn', title: t('common_edit') }, icon('edit'));
    const openBtn = el('button', { type: 'button', className: 'memo-btn', title: t('memo_open_page') }, icon('expand'));
    root.append(
      el('div', { className: 'memo-side' }, tabs, addBtn),
      el('div', { className: 'memo-content' }, textarea, preview, el('div', { className: 'memo-actions' }, editBtn, openBtn)));

    const editor = memoEditor({ textarea, preview });

    const setEditing = (on) => {
      root.classList.toggle('editing', on);
      editBtn.replaceChildren(icon(on ? 'eye' : 'edit'));
      editBtn.title = on ? t('memo_back_to_view') : t('common_edit');
      if (on) {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length); // 続きを書けるように末尾から
        textarea.focus();
      } else {
        editor.flush();
        editor.render();
      }
    };

    // タブ。この PC のメモを作った順に並べる(更新順だと、書いている間にタブが動いてしまう)。
    // 開いているメモがまだ保存されていなければ、末尾に仮のタブを出す
    let memos = [];
    const renderTabs = () => {
      const items = [...memos].sort((a, b) => a.created - b.created);
      if (!items.some((m) => m.id === memoId)) items.push({ id: memoId, body: textarea.value });
      tabs.replaceChildren(...items.map((m) => {
        const tab = el('button', { type: 'button', className: 'memo-tab', role: 'tab', textContent: memoTitle(m.id === memoId ? textarea.value : m.body) });
        tab.title = tab.textContent;
        tab.setAttribute('aria-selected', m.id === memoId);
        tab.addEventListener('click', () => select(m.id));
        return tab;
      }));
      tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    const refreshTabs = async () => {
      memos = await store.listMemos();
      renderTabs();
    };
    let refreshTimer;
    const unsubscribe = store.onMemoChange(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshTabs, 100);
    });
    textarea.addEventListener('input', () => {
      const tab = tabs.querySelector('[aria-selected="true"]');
      if (tab) tab.textContent = tab.title = memoTitle(textarea.value); // 保存を待たずにタイトルを更新
    });

    // 表示するメモを切り替える。選んだメモは設定に保存して、次に開いたときも同じメモにする
    async function select(id, { save = true } = {}) {
      if (id === memoId) return;
      setEditing(false);
      memoId = id;
      if (save) ctx.save({ memoId: id });
      await editor.open(id);
      renderTabs();
    }

    const applyConfig = (cfg) => {
      root.classList.toggle('no-tabs', !cfg.showTabs);
      if (cfg.memoId === NEW_MEMO) return select(newMemoId());
      return select(cfg.memoId || ctx.id, { save: false }); // 空ならウィジェットの id のメモ
    };
    setEditing(false);
    applyConfig(config).then(refreshTabs);

    preview.addEventListener('click', (e) => {
      if (e.target.closest('a, input')) return; // リンクとチェックボックスはそのまま
      if (getSelection().toString()) return;    // 文字を選択しただけ
      setEditing(true);
    });
    preview.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        setEditing(true);
      }
    });
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setEditing(false);
      }
    });
    // タブやボタンを押すときもフォーカスが外れるので、ウィジェットの外へ移ったときだけ表示に戻す
    textarea.addEventListener('blur', (e) => {
      if (!root.contains(e.relatedTarget)) setEditing(false);
    });
    addBtn.addEventListener('click', async () => {
      await select(newMemoId());
      setEditing(true);
    });
    editBtn.addEventListener('click', () => setEditing(!root.classList.contains('editing')));
    openBtn.addEventListener('click', async () => {
      await editor.flush();
      chrome.tabs.create({ url: memoPageUrl(memoId) });
    });

    return {
      update: applyConfig, // 他のタブでタブを切り替えたときなど。作り直さずにメモだけ切り替える
      unmount() {
        clearTimeout(refreshTimer);
        unsubscribe();
        editor.destroy();
      },
    };
  },
};
