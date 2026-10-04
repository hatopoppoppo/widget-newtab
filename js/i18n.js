// 画面の文言(多言語対応)
//
// 文言は _locales/<言語>/messages.json にまとめ、t('キー', { 名前: 値 }) で取り出す。
// - chrome.i18n を使う。言語は Chrome の表示言語で決まり、無い言語は manifest の default_locale(ja)になる
// - 値の埋め込みは {name} の形。chrome.i18n の $1 / placeholders は使わず、ここで置き換える(messages.json に $ は書かない)
// - HTML は data-i18n="キー"(textContent)と data-i18n-<属性>="キー"(title / placeholder / aria-label など)を
//   applyI18n() で差し込む
// - Node の単体テストでは chrome が無いので、tests/i18n-node.js が chrome.i18n の代わりを用意する

export function t(key, values) {
  const text = chrome.i18n.getMessage(key);
  if (!text) {
    console.error(`文言がありません: ${key}`);
    return key;
  }
  return values ? text.replace(/\{(\w+)\}/g, (m, name) => (name in values ? String(values[name]) : m)) : text;
}

// 曜日の短い名前 [日, 月, …, 土](0 = 日曜)
export const weekdayNames = () => t('weekdays_short').split(',');

export function applyI18n(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll('*')) {
    for (const [name, key] of Object.entries(node.dataset)) {
      // data-i18n-aria-label → dataset.i18nAriaLabel → aria-label
      if (!name.startsWith('i18n') || name === 'i18n') continue;
      const attr = name.slice(4).replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase());
      node.setAttribute(attr, t(key));
    }
  }
  // 実際に使われた messages.json の言語(表示言語の文言が無ければ ja になる)
  document.documentElement.lang = t('locale');
}
