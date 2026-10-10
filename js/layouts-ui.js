// プロファイル(保存の形では layouts の 1 つ)の管理。設定ダイアログの custom 欄(ui.js)として使う。
// プロファイルの追加・複製・名前の変更・削除と、プロファイルの中のレイアウト(ウィンドウの幅に合わせた並べ方)の追加・名前・マス数・条件・削除。
// 変更はダイアログで「保存」したときにまとめて反映する(app.js の openLayouts)。
// read(): [{ id, name, variants, from }]。from は新しく作ったもの: 'new'(空のプロファイル)| 'copy:<複製元の id>'。
// variants: [{ id, name, columns, maxWidth }]。先頭は条件なしのレイアウト(id 'default'。名前が「通常」のままなら name は null)。
// maxWidth: ウィンドウの幅がこれ以下ならこのレイアウトにする(null ならメニューから選んだときだけ)
import { el, icon } from './ui.js';
import { t } from './i18n.js';
import { MAX_LAYOUTS, MAX_VARIANTS, variantsOf } from './store.js';

let tempId = 0;

const COLUMN_OPTIONS = [24, 12, 6];
const newVariantId = () => `v${crypto.randomUUID().slice(0, 7)}`;
export const variantName = (v) => v.name || t('layouts_variant_default');

export function layoutListField(layouts, activeId, windowWidth) {
  let rows = layouts.map((l) => ({ ...l, variants: variantsOf(l).map((v) => ({ ...v, name: variantName(v), columns: v.columns ?? 24, maxWidth: v.maxWidth ?? null })) }));
  const list = el('div', { className: 'lo-list' });
  const addBtn = el('button', { type: 'button', className: 'btn lo-add' }, icon('plus'), t('layouts_new'));
  const limit = el('p', { className: 'hint lo-limit', textContent: t('layouts_max', { n: MAX_LAYOUTS }) });
  const variantsHint = el('p', { className: 'hint lo-variants-hint', textContent: t('layouts_variants_hint', { n: MAX_VARIANTS, width: Math.round(windowWidth) }) });
  const node = el('div', { className: 'lo-editor' }, list, el('div', { className: 'lo-foot' }, addBtn, limit), variantsHint);
  const emit = () => node.dispatchEvent(new Event('input', { bubbles: true }));
  // 入力の input はダイアログの値の読み直しに使わせず、まとめて emit する
  const onInput = (input, fn) => input.addEventListener('input', (e) => {
    e.stopPropagation();
    fn();
    emit();
  });

  // 「プロファイル2」のように、まだ使っていない番号の名前
  const freshName = () => {
    const names = new Set(rows.map((r) => r.name));
    for (let n = rows.length + 1; ; n++) if (!names.has(t('layouts_new_name', { n }))) return t('layouts_new_name', { n });
  };
  const freshVariantName = (row) => {
    const names = new Set(row.variants.map((v) => v.name));
    for (let n = row.variants.length + 1; ; n++) if (!names.has(t('layouts_variant_new_name', { n }))) return t('layouts_variant_new_name', { n });
  };

  function variantRow(row, v, i) {
    const name = el('input', { type: 'text', className: 'lo-vname', value: v.name, ariaLabel: t('layouts_variant_name'), spellcheck: false });
    onInput(name, () => { v.name = name.value; });
    name.addEventListener('change', () => {
      if (!name.value.trim()) name.value = v.name = i === 0 ? t('layouts_variant_default') : freshVariantName(row);
    });
    const columns = el('select', { className: 'lo-columns', ariaLabel: t('layouts_columns') },
      COLUMN_OPTIONS.map((n) => el('option', { value: String(n), textContent: t('layouts_columns_option', { n }), selected: v.columns === n })));
    onInput(columns, () => { v.columns = Number(columns.value); });
    let rule;
    if (i === 0) {
      rule = el('span', { className: 'lo-rule', textContent: t('layouts_variant_fallback') });
    } else {
      const width = el('input', {
        type: 'number', className: 'lo-width', min: 320, max: 7680, step: 10, value: v.maxWidth ?? '',
        ariaLabel: t('layouts_width_label'),
      });
      onInput(width, () => { v.maxWidth = Number(width.value) > 0 ? Math.round(Number(width.value)) : null; });
      rule = el('span', { className: 'lo-rule' }, width, el('span', { textContent: t('layouts_width_unit') }));
    }
    const remove = el('button', { type: 'button', className: 'btn lo-vdelete', title: t('common_delete') }, icon('trash'));
    remove.classList.toggle('lo-placeholder', i === 0); // 先頭は消せない(行の幅をそろえるため、見えないボタンを置く)
    remove.disabled = i === 0;
    remove.addEventListener('click', () => {
      row.variants.splice(i, 1);
      render();
      emit();
    });
    const r = el('div', { className: 'lo-variant' }, name, columns, rule, remove);
    r.dataset.vid = v.id;
    return r;
  }

  function render() {
    list.replaceChildren(...rows.map((row, i) => {
      const name = el('input', { type: 'text', className: 'lo-name', value: row.name, ariaLabel: t('layouts_name'), spellcheck: false });
      onInput(name, () => { row.name = name.value; });
      // 空の名前は、元の名前に戻す
      name.addEventListener('change', () => {
        if (!name.value.trim()) name.value = row.name = layouts.find((l) => l.id === row.id)?.name ?? freshName();
      });
      const copy = el('button', { type: 'button', className: 'btn lo-copy', title: t('layouts_duplicate') }, t('layouts_duplicate'));
      copy.disabled = rows.length >= MAX_LAYOUTS;
      copy.addEventListener('click', () => {
        // 保存前に作ったプロファイルの複製は、その複製元をたどる
        const from = row.from ?? `copy:${row.id}`;
        rows.splice(i + 1, 0, { id: `new-${++tempId}`, name: t('layouts_copy_name', { name: row.name }), variants: row.variants.map((v) => ({ ...v })), from });
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

      // プロファイルの中のレイアウト
      const addVariant = el('button', { type: 'button', className: 'btn lo-vadd' }, icon('plus'), t('layouts_variant_add'));
      addVariant.disabled = row.variants.length >= MAX_VARIANTS;
      addVariant.title = addVariant.disabled ? t('layouts_variant_max', { n: MAX_VARIANTS }) : '';
      addVariant.addEventListener('click', () => {
        row.variants.push({ id: newVariantId(), name: freshVariantName(row), columns: 12, maxWidth: null });
        render();
        emit();
        list.querySelector(`.lo-row[data-id="${row.id}"] .lo-variant:last-child .lo-width`)?.focus();
      });
      const variants = el('div', { className: 'lo-variants' }, ...row.variants.map((v, j) => variantRow(row, v, j)));

      const r = el('div', { className: 'lo-row' }, el('div', { className: 'lo-main' }, name, current, copy, remove), variants, el('div', { className: 'lo-vfoot' }, addVariant));
      r.dataset.id = row.id;
      return r;
    }));
    addBtn.disabled = rows.length >= MAX_LAYOUTS;
    limit.hidden = rows.length < MAX_LAYOUTS;
  }
  addBtn.addEventListener('click', () => {
    rows.push({ id: `new-${++tempId}`, name: freshName(), variants: variantsOf(null).map((v) => ({ ...v, name: variantName(v) })), from: 'new' });
    render();
    emit();
    list.lastElementChild.querySelector('.lo-name').select();
  });
  render();

  return {
    node,
    read: () => rows.map((row) => ({
      id: row.id,
      name: row.name.trim() || freshName(),
      variants: row.variants.map((v, i) => ({
        id: v.id,
        name: i === 0 ? (v.name.trim() && v.name.trim() !== t('layouts_variant_default') ? v.name.trim() : null) : v.name.trim() || freshVariantName(row),
        columns: v.columns,
        maxWidth: i === 0 ? null : v.maxWidth,
      })),
      ...(row.from ? { from: row.from } : {}),
    })),
  };
}
