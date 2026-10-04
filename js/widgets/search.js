import { el, icon, faviconUrl } from '../ui.js';
import { t } from '../i18n.js';

// url の %s が検索語に置き換わる。'chrome' は Chrome に設定された既定の検索エンジン(chrome.search API)
const PRESETS = [
  { id: 'chrome', name: t('search_engine_chrome'), url: null },
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { id: 'yahoojp', name: 'Yahoo! JAPAN', url: 'https://search.yahoo.co.jp/search?p=%s' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://ja.wikipedia.org/w/index.php?search=%s' },
  { id: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s' },
];

// 「名前 | URL」形式の行を解析する
function parseCustom(text) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).flatMap((line, i) => {
    const [name, url] = line.split('|').map((s) => s.trim());
    return name && url?.includes('%s') ? [{ id: `custom${i}`, name, url }] : [];
  });
}

function enginesOf(cfg) {
  const enabled = new Set(cfg.engines);
  const list = [...PRESETS.filter((e) => enabled.has(e.id)), ...parseCustom(cfg.custom)];
  return list.length ? list : [PRESETS[0]];
}


export default {
  type: 'search',
  name: t('search_name'),
  description: t('search_description'),
  size: { w: 12, h: 1, minW: 6, minH: 1, maxH: 2 },
  defaults: {
    engines: ['chrome', 'google', 'bing', 'duckduckgo'],
    custom: '',
    current: 'chrome',
    newTab: false,
    placeholder: t('search_placeholder'),
  },
  fields: [
    { key: 'engines', label: t('search_engines'), type: 'multicheck', options: PRESETS.map((e) => ({ value: e.id, label: e.name })) },
    {
      key: 'custom', label: t('search_custom'), type: 'textarea', rows: 3,
      placeholder: 'Amazon | https://www.amazon.co.jp/s?k=%s',
      hint: t('search_custom_hint'),
    },
    { key: 'placeholder', label: t('search_placeholder_label'), type: 'text' },
    { key: 'newTab', label: t('search_new_tab'), type: 'checkbox' },
  ],

  mount(root, config, ctx) {
    // エンジン選択ボタン + メニュー。メニューはウィジェットの overflow で切れないよう popover(トップレイヤー)で出す
    const btnIcon = el('span', { className: 'engine-icon' });
    const btnName = el('span', { className: 'engine-name' });
    const caret = icon('chevronDown');
    caret.classList.add('engine-caret');
    const button = el('button', { type: 'button', className: 'engine-btn' }, btnIcon, btnName, caret);
    button.setAttribute('aria-haspopup', 'listbox');
    const menu = el('div', { className: 'engine-menu', role: 'listbox' });
    menu.popover = 'auto'; // 外側クリック・Esc で閉じる
    button.popoverTargetElement = menu;

    const input = el('input', { type: 'search', className: 'search-input', autocomplete: 'off', spellcheck: false });
    const form = el('form', { className: 'search' }, button, el('span', { className: 'search-divider' }), input);
    root.append(form, menu);

    let engines = [];
    let currentId = null;
    const current = () => engines.find((e) => e.id === currentId) ?? engines[0];

    const engineIcon = (engine) => {
      if (!engine.url) return icon('search'); // Chrome の既定は URL が分からないので虫眼鏡
      return el('img', { src: faviconUrl(engine.url.replace('%s', '')), alt: '', width: 16, height: 16 });
    };

    const renderButton = () => {
      const engine = current();
      btnIcon.replaceChildren(engineIcon(engine));
      btnName.textContent = engine.name;
      button.title = engines.length > 1 ? t('search_engine_title_switch', { name: engine.name }) : t('search_engine_title', { name: engine.name });
      button.disabled = engines.length < 2;
    };

    const renderMenu = () => {
      menu.replaceChildren(...engines.map((engine) => {
        const selected = engine.id === current().id;
        const opt = el('button', { type: 'button', className: 'engine-opt' },
          el('span', { className: 'engine-icon' }, engineIcon(engine)),
          el('span', { className: 'engine-opt-name', textContent: engine.name }),
          selected ? icon('check') : el('span', { className: 'icon' }));
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-selected', selected);
        opt.addEventListener('click', () => select(engine.id));
        return opt;
      }));
    };

    const select = (id, { keepMenu = false } = {}) => {
      if (id !== currentId) {
        currentId = id;
        renderButton();
        renderMenu();
        ctx.save({ current: id });
      }
      if (!keepMenu) {
        menu.hidePopover();
        input.focus();
      }
    };

    // ボタンの真下(下に入らなければ真上)に出す
    const placeMenu = () => {
      const r = button.getBoundingClientRect();
      const h = menu.offsetHeight;
      const below = r.bottom + 6;
      menu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${below + h > innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : below}px`;
    };
    menu.addEventListener('toggle', (e) => {
      const open = e.newState === 'open';
      button.classList.toggle('open', open);
      button.setAttribute('aria-expanded', open);
      if (!open) return;
      placeMenu();
      menu.querySelector('[aria-selected="true"]')?.focus();
    });

    // メニュー内は ↑↓ / Home / End で移動
    menu.addEventListener('keydown', (e) => {
      const opts = [...menu.querySelectorAll('.engine-opt')];
      const i = opts.indexOf(document.activeElement);
      const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      opts[(next + opts.length) % opts.length].focus();
    });

    // 入力欄で Ctrl + ↑↓ なら、メニューを開かずに切り替え
    input.addEventListener('keydown', (e) => {
      if (!e.ctrlKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || engines.length < 2) return;
      e.preventDefault();
      const i = engines.indexOf(current()) + (e.key === 'ArrowDown' ? 1 : -1);
      select(engines[(i + engines.length) % engines.length].id, { keepMenu: true });
    });

    const apply = (cfg) => {
      config = cfg;
      engines = enginesOf(cfg);
      currentId = engines.some((e) => e.id === cfg.current) ? cfg.current : engines[0].id;
      input.placeholder = cfg.placeholder;
      renderButton();
      renderMenu();
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const engine = current();
      if (!engine.url) {
        chrome.search.query({ text, disposition: config.newTab ? 'NEW_TAB' : 'CURRENT_TAB' });
        return;
      }
      const url = engine.url.replace('%s', encodeURIComponent(text));
      if (config.newTab) chrome.tabs.create({ url });
      else location.href = url;
    });

    // メニューは画面に固定配置なので、スクロール・リサイズで位置がずれる前に閉じる
    const close = (e) => {
      if (e?.type === 'scroll' && menu.contains(e.target)) return; // メニュー自体のスクロールは除く
      if (menu.matches(':popover-open')) menu.hidePopover();
    };
    addEventListener('scroll', close, true);
    addEventListener('resize', close);

    apply(config);
    return {
      update: apply,
      unmount() {
        removeEventListener('scroll', close, true);
        removeEventListener('resize', close);
      },
    };
  },
};
