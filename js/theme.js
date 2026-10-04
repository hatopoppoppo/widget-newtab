// テーマ(全体設定): ライト / ダーク、アクセントカラー、ウィジェットの背景色と不透明度
//
// 色はふだん css/newtab.css の変数(テーマごとの値)を使う。全体設定で色を指定したときだけ、
// その変数を上書きする CSS を <style id="custom-theme"> に書く。
// ウィジェットの背景色を指定したときは、文字や枠線の色も背景の明るさに合わせて作る(暗い背景に暗い文字にならないように)

// '#rrggbb' → 明るさ(0〜1、WCAG の相対輝度)
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// 白い文字の方が読みやすい暗い色か(白と黒のどちらとのコントラストが大きいか)
export const isDark = (hex) => (1.05 / (luminance(hex) + 0.05)) > ((luminance(hex) + 0.05) / 0.05);

const mix = (color, other, percent) => `color-mix(in srgb, ${color}, ${other} ${percent}%)`;

// アクセントカラーの変数(指定していなければ null)。<html> の style に直接入れる(ダークテーマの指定より優先させるため)。
// --on-accent はボタンなどアクセントカラーを地にしたときの文字の色。白や黄色のような明るい色なら黒い文字にする
const ACCENT_VARS = ['--accent', '--accent-soft', '--on-accent'];
export const accentVars = (p) => (p.accentMode === 'custom'
  ? {
    '--accent': p.accent,
    '--accent-soft': `color-mix(in srgb, ${p.accent} 16%, transparent)`,
    '--on-accent': isDark(p.accent) ? '#fff' : '#1f2328',
  }
  : null);

// 全体設定から、ウィジェットの色の変数を上書きする CSS を作る。上書きするものが無ければ ''
export function customThemeCss(p) {
  const rules = [];
  const vars = [];
  if (p.widgetBgMode === 'custom') {
    const bg = p.widgetBg;
    const dark = isDark(bg);
    const toward = dark ? '#fff' : '#000';
    vars.push(
      `--surface: ${bg}`,
      `--surface-2: ${mix(bg, toward, dark ? 6 : 3)}`,
      `--surface-hover: ${mix(bg, toward, dark ? 10 : 6)}`,
      `--border: ${mix(bg, toward, dark ? 14 : 11)}`,
      `--text: ${dark ? '#e6e8eb' : '#1f2328'}`,
      `--text-muted: ${dark ? '#9aa3ae' : '#667085'}`,
      `color-scheme: ${dark ? 'dark' : 'light'}`,
      'color: var(--text)',
    );
  }
  const opacity = p.widgetOpacity ?? 100;
  if (opacity < 100) {
    // カードの地だけを透かす(中の文字や入力欄はそのまま)。透けた先の背景はぼかして、文字を読みやすくする
    vars.push(`--card-bg: color-mix(in srgb, var(--surface) ${opacity}%, transparent)`, 'backdrop-filter: blur(12px)');
  }
  if (vars.length) rules.push(`.grid-stack-item-content:not(.noframe) { ${vars.join('; ')}; }`);
  return rules.join('\n');
}

// テーマを反映する(新規タブとメモのページで使う)
export function applyTheme(p) {
  const root = document.documentElement;
  if (p.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = p.theme;
  const accent = accentVars(p);
  for (const name of ACCENT_VARS) {
    if (accent) root.style.setProperty(name, accent[name]);
    else root.style.removeProperty(name);
  }
  let style = document.getElementById('custom-theme');
  if (!style) {
    style = document.createElement('style');
    style.id = 'custom-theme';
    document.head.append(style);
  }
  style.textContent = customThemeCss(p);
}
