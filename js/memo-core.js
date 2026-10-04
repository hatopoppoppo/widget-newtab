import { Marked } from '../vendor/marked/marked.esm.js';
import DOMPurify from '../vendor/dompurify/purify.es.mjs';
import * as store from './store.js';
import { t } from './i18n.js';

// メモ(Markdown)の共通処理。メモウィジェット(js/widgets/memo.js)とメモ専用ページ(js/memo-page.js)で使う。
// 中身は chrome.storage.local の memo:<id> に保存し、両方の画面で開いていれば互いの変更をすぐ反映する

const SAVE_DELAY = 400; // 入力が止まってから保存するまで(ms)

const marked = new Marked({ gfm: true, breaks: true }); // メモなので、1 回の改行でも改行する

// リンクは新しいタブで開く(新規タブ・メモのページ自体を置き換えない)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// 貼り付けた HTML などに含まれるスクリプトは DOMPurify で取り除く
export const renderMarkdown = (text) => DOMPurify.sanitize(marked.parse(text));

// 1 行目(見出しの # やリストの記号は除く)をタイトルにする
export function memoTitle(body) {
  const line = (body ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return t('memo_untitled');
  return line.replace(/^(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+)/, '').slice(0, 80) || t('memo_untitled');
}

// index 番目のチェックボックス(- [ ] / - [x])を切り替えた本文を返す。コードブロックの中は数えない
const TASK = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])(?=\s|$)/;
export function toggleTask(text, index) {
  const lines = text.split('\n');
  let n = 0;
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s*(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (fence || !TASK.test(lines[i])) continue;
    if (n++ === index) {
      lines[i] = lines[i].replace(TASK, (_, open, mark, close) => open + (mark === ' ' ? 'x' : ' ') + close);
      return lines.join('\n');
    }
  }
  return text;
}

// 入力中の textarea の中身を差し替える。変わった位置より後ろにあるカーソルは、増減した文字数だけずらす
export function replaceKeepingCursor(textarea, text) {
  const old = textarea.value;
  if (old === text) return;
  const { selectionStart: start, selectionEnd: end, scrollTop } = textarea;
  let p = 0;
  while (p < old.length && p < text.length && old[p] === text[p]) p++;
  const shift = (pos) => (pos <= p ? pos : Math.max(p, pos + text.length - old.length));
  textarea.value = text;
  textarea.setSelectionRange(shift(start), shift(end));
  textarea.scrollTop = scrollTop;
}

// textarea(編集)と preview(表示)を 1 つのメモにつなぐ。
//   open(id)  メモを開く。まだ保存されていない id は空のメモとして開き、書き始めたときに作られる
//   flush()   保存待ちの内容をすぐ保存する
//   destroy() 保存待ちを保存して、変更の監視をやめる
//   onChange(memo)   自分の保存・他の画面での変更のたびに呼ばれる(削除されたら memo は null)
export function memoEditor({ textarea, preview, onChange = () => {} }) {
  let memo = null;
  let timer = null;

  const render = () => {
    const text = textarea.value;
    preview.innerHTML = text.trim() ? renderMarkdown(text) : '';
    preview.classList.toggle('empty', !text.trim());
    // marked はチェックボックスを disabled で出力するので、クリックで切り替えられるようにする
    for (const cb of preview.querySelectorAll('input[type="checkbox"]')) cb.disabled = false;
  };

  const flush = async () => {
    if (!timer || !memo) return;
    clearTimeout(timer);
    timer = null;
    const now = Date.now();
    memo = { ...memo, body: textarea.value, created: memo.created ?? now, updated: now };
    await store.saveMemo(memo);
  };
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, SAVE_DELAY);
  };

  textarea.addEventListener('input', () => {
    scheduleSave();
    render();
  });
  textarea.addEventListener('blur', flush);
  addEventListener('pagehide', flush);

  preview.addEventListener('click', (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const index = [...preview.querySelectorAll('input[type="checkbox"]')].indexOf(cb);
    textarea.value = toggleTask(textarea.value, index);
    render();
    scheduleSave();
    flush();
  });

  const unsubscribe = store.onMemoChange((id, value) => {
    if (!memo || id !== memo.id) return;
    // 入力して保存待ちの間は、こちらの内容を優先する(すぐ保存され、相手に反映される)
    if (timer) return;
    if (!value) {
      memo = { id: memo.id, body: '', created: null, updated: null };
      textarea.value = '';
      render();
      onChange(null);
      return;
    }
    memo = value;
    if (value.body !== textarea.value) {
      replaceKeepingCursor(textarea, value.body);
      render();
    }
    onChange(value);
  });

  return {
    get memo() { return memo; },
    async open(id) {
      await flush();
      const loaded = await store.loadMemo(id);
      memo = loaded ?? { id, body: '', created: null, updated: null };
      textarea.value = memo.body;
      render();
      return loaded;
    },
    flush,
    render,
    destroy() {
      flush();
      unsubscribe();
      removeEventListener('pagehide', flush);
    },
  };
}

// メモ専用ページの URL
export const memoPageUrl = (id) => chrome.runtime.getURL(`memo.html#${encodeURIComponent(id)}`);
