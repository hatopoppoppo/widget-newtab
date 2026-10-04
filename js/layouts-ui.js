// レイアウトの管理(追加・複製・名前の変更・削除)。設定ダイアログの custom 欄(ui.js)として使う。
// 変更はダイアログで「保存」したときにまとめて反映する(app.js の openLayouts)。
// read(): [{ id, name, from }]。from は新しく作ったもの: 'new'(空のレイアウト)| 'copy:<複製元の id>'
import { el, icon } from './ui.js';
import { t } from './i18n.js';
import { MAX_LAYOUTS } from './store.js';

let tempId = 0;

export function layoutListField(layouts, activeId) {
  let rows = layouts.map((l) => ({ ...l }));
  const list = el('div', { className: 'lo-list' });
  const addBtn = el('button', { type: 'button', className: 'btn lo-add' }, icon('plus'), t('layouts_new'));
  const limit = el('p', { className: 'hint lo-limit', textContent: t('layouts_max', { n: MAX_LAYOUTS }) });
  const node = el('div', { className: 'lo-editor' }, list, el('div', { className: 'lo-foot' }, addBtn, limit));
  const emit = () => node.dispatchEvent(new Event('input', { bubbles: true }));

  // 「レイアウト2」のように、まだ使っていない番号の名前
  const freshName = () => {
    const names = new Set(rows.map((r) => r.name));
    for (let n = rows.length + 1; ; n++) if (!names.has(t('layouts_new_name', { n }))) return t('layouts_new_name', { n });
  };

  function render() {
    list.replaceChildren(...rows.map((row, i) => {
      const name = el('input', { type: 'text', className: 'lo-name', value: row.name, ariaLabel: t('layouts_name'), spellcheck: false });
      name.addEventListener('input', (e) => {
        e.stopPropagation();
        row.name = name.value;
        emit();
      });
      // 空の名前は、元の名前に戻す
      name.addEventListener('change', () => {
        if (!name.value.trim()) name.value = row.name = layouts.find((l) => l.id === row.id)?.name ?? freshName();
      });
      const copy = el('button', { type: 'button', className: 'btn lo-copy', title: t('layouts_duplicate') }, t('layouts_duplicate'));
      copy.disabled = rows.length >= MAX_LAYOUTS;
      copy.addEventListener('click', () => {
        // 保存前に作ったレイアウトの複製は、その複製元をたどる
        const from = row.from ?? `copy:${row.id}`;
        rows.splice(i + 1, 0, { id: `new-${++tempId}`, name: t('layouts_copy_name', { name: row.name }), from });
        render();
        emit();
      });
      const remove = el('button', { type: 'button', className: 'btn lo-delete', title: t('common_delete') }, icon('trash'));
      remove.disabled = rows.length <= 1;
      remove.addEventListener('click', () => {
        rows.splice(i, 1);
        render();
        emit();
      });
      const current = row.id === activeId ? el('span', { className: 'lo-current', textContent: t('layouts_current') }) : null;
      const r = el('div', { className: 'lo-row' }, name, current, copy, remove);
      r.dataset.id = row.id;
      return r;
    }));
    addBtn.disabled = rows.length >= MAX_LAYOUTS;
    limit.hidden = rows.length < MAX_LAYOUTS;
  }
  addBtn.addEventListener('click', () => {
    rows.push({ id: `new-${++tempId}`, name: freshName(), from: 'new' });
    render();
    emit();
    list.lastElementChild.querySelector('.lo-name').select();
  });
  render();

  return {
    node,
    read: () => rows.map(({ id, name, from }) => ({ id, name: name.trim() || freshName(), ...(from ? { from } : {}) })),
  };
}
