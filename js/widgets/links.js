import { el, icon, editSettings, faviconUrl, handleSpecialLinks } from '../ui.js';
import * as icons from '../icons.js';
import { t } from '../i18n.js';

// リンクは設定(config.links)に持つ。sync は 1 項目 8KB までなので、目安として 50 件程度まで
const MAX_LINKS = 60;
const DRAG_TYPE = 'application/x-newtab-link';

const newId = () => crypto.randomUUID().slice(0, 8);

// "example.com" のようにスキームが無ければ https:// を補う
function normalizeUrl(text) {
  const s = text.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    return new URL(withScheme).href;
  } catch {
    return null;
  }
}

function defaultTitle(url) {
  try {
    const { hostname, protocol } = new URL(url);
    return hostname.replace(/^www\./, '') || protocol;
  } catch {
    return url;
  }
}

// 他のページやアドレスバーからドロップされたリンクを取り出す
function droppedLink(dt) {
  const url = (dt.getData('text/uri-list') || dt.getData('text/plain'))
    .split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
  const href = url && normalizeUrl(url);
  if (!href) return null;
  // リンクをドラッグした場合は text/html にリンク文字列が入っている
  const html = dt.getData('text/html');
  const text = html ? new DOMParser().parseFromString(html, 'text/html').body.textContent.trim() : '';
  return { url: href, title: text && text !== url ? text.slice(0, 80) : '' };
}

async function editLink(link) {
  const values = await editSettings({
    title: link ? t('links_edit') : t('links_add'),
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com' },
      { key: 'title', label: t('links_title'), type: 'text', placeholder: t('links_title_placeholder') },
      { key: 'icon', label: t('links_icon'), type: 'text', placeholder: t('links_icon_placeholder'), hint: t('links_icon_hint') },
    ],
    values: { url: link?.url ?? '', title: link?.title ?? '', icon: link?.icon ?? '' },
  });
  if (!values) return null;
  const url = normalizeUrl(values.url);
  if (!url) {
    if (values.url.trim()) alert(t('links_bad_url'));
    return null;
  }
  const iconUrl = values.icon.trim() ? normalizeUrl(values.icon) : '';
  if (iconUrl === null) {
    alert(t('links_bad_icon_url'));
    return null;
  }
  return { url, title: values.title.trim(), icon: iconUrl };
}

export default {
  type: 'links',
  name: t('links_name'),
  shareable: true, // 中身を持つので、ほかのレイアウトにも同じものを置く意味がある
  description: t('links_description'),
  size: { w: 8, h: 4, minW: 2, minH: 1 },
  defaults: {
    links: [],
    view: 'grid',       // grid | list
    tileSpan: 4,        // タイル表示で 1 タイルが占めるマス数(縦横とも)
    iconSize: 'medium', // small | medium | large
    showTitles: true,
    showAdd: true,
    heading: '',
    newTab: false,
  },
  fields: [
    {
      key: 'view', label: t('links_view'), type: 'select', options: [
        { value: 'grid', label: t('links_view_grid') },
        { value: 'list', label: t('links_view_list') },
      ],
    },
    {
      key: 'tileSpan', label: t('links_tile_span'), type: 'select', when: (v) => v.view === 'grid', options: [
        ...[2, 3, 4, 6].map((n) => ({ value: String(n), label: t('links_tile_span_option', { n }) })),
      ],
    },
    {
      key: 'iconSize', label: t('links_icon_size'), type: 'select', when: (v) => v.view === 'grid', options: [
        { value: 'small', label: t('links_icon_small') },
        { value: 'medium', label: t('links_icon_medium') },
        { value: 'large', label: t('links_icon_large') },
      ],
    },
    { key: 'showTitles', label: t('links_show_titles'), type: 'checkbox', when: (v) => v.view === 'grid' },
    { key: 'heading', label: t('links_heading'), type: 'text', placeholder: t('links_heading_placeholder') },
    { key: 'showAdd', label: t('links_show_add'), type: 'checkbox', hint: t('links_show_add_hint') },
    { key: 'newTab', label: t('bookmarks_new_tab'), type: 'checkbox' },
  ],

  mount(root, config, ctx) {
    const heading = el('div', { className: 'ln-heading' });
    const list = el('div', { className: 'ln-list' });
    const flashEl = el('div', { className: 'ln-flash', hidden: true });
    const wrap = el('div', { className: 'ln' }, heading, list, flashEl);
    root.append(wrap);

    // スクロールせずに並べられる個数(fit() で計算)。これを超えて追加はできない
    let capacity = Infinity;

    let flashTimer;
    const flash = (text) => {
      flashEl.textContent = text;
      flashEl.hidden = false;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashEl.hidden = true; }, 2500);
    };

    const save = (links) => {
      config.links = links;
      ctx.save({ links });
      render();
      refreshIcons();
    };

    const addLink = (link) => {
      if (config.links.length >= MAX_LINKS) {
        flash(t('links_max', { n: MAX_LINKS }));
        return;
      }
      if (config.links.length >= capacity) {
        flash(t('links_full'));
        return;
      }
      save([...config.links, { id: newId(), ...link }]);
    };

    // 高解像度アイコン(icons.js)があればそれを、無ければ _favicon を表示する。読めなかったら _favicon に戻す
    const renderIcon = (link) => {
      const img = el('img', { src: icons.iconSrc(link), alt: '', loading: 'lazy' });
      img.addEventListener('error', () => {
        const fallback = faviconUrl(link.url, 128);
        if (img.src !== fallback) img.src = fallback;
      }, { once: true });
      return img;
    };

    // 足したり直したりしたリンクと、まだ許可されていないほかのリンクのサイトの権限を、まとめて確認する。
    // 保存のクリックの直後に呼ぶ(ユーザー操作から間を置くと確認画面を出せない)
    const askIconPermission = (links) => {
      icons.requestPermission(links).then((ok) => ok && refreshIcons());
    };

    // 未取得のアイコンを取りに行き、取れたものがあれば描き直す
    const refreshIcons = async () => {
      const results = await Promise.all(config.links.map((l) => icons.ensureIcon(l)));
      if (mounted && results.some(Boolean)) render();
    };

    const renderItem = (link) => {
      const title = link.title || defaultTitle(link.url);
      const a = el('a', { className: 'ln-link', href: link.url, title: `${title}\n${link.url}`, draggable: false },
        el('span', { className: 'ln-icon' }, renderIcon(link)),
        el('span', { className: 'ln-title', textContent: title }));
      if (config.newTab) {
        a.target = '_blank';
        a.rel = 'noopener';
      }

      const editBtn = el('button', { type: 'button', className: 'ln-btn', title: t('common_edit') }, icon('edit'));
      const delBtn = el('button', { type: 'button', className: 'ln-btn', title: t('common_delete') }, icon('close'));
      editBtn.addEventListener('click', async () => {
        const updated = await editLink(link);
        if (!updated) return;
        const links = config.links.map((l) => (l.id === link.id ? { ...l, ...updated } : l));
        askIconPermission(links);
        save(links);
      });
      delBtn.addEventListener('click', () => {
        if (confirm(t('widget_confirm_delete', { name: title }))) save(config.links.filter((l) => l.id !== link.id));
      });

      const item = el('div', { className: 'ln-item', draggable: true }, a, el('div', { className: 'ln-actions' }, editBtn, delBtn));
      item.dataset.id = link.id;
      return item;
    };

    const render = () => {
      wrap.dataset.view = config.view;
      wrap.dataset.size = config.iconSize;
      wrap.classList.toggle('no-titles', config.view === 'grid' && !config.showTitles);
      heading.textContent = config.heading;
      heading.hidden = !config.heading;

      const items = config.links.map(renderItem);
      if (config.showAdd) {
        const add = el('button', { type: 'button', className: 'ln-add', title: t('links_add') },
          el('span', { className: 'ln-icon' }, icon('plus')),
          el('span', { className: 'ln-title', textContent: t('links_add_short') }));
        add.addEventListener('click', async () => {
          const link = await editLink(null);
          if (!link) return;
          askIconPermission([...config.links, link]);
          addLink(link);
        });
        items.push(add);
      }
      // ウィジェットを縮めて入りきらなくなったリンクは消さずに隠し、残り件数を出す
      items.push(el('div', { className: 'ln-more', title: t('links_more_title') }));
      if (!config.links.length && !config.showAdd) {
        items.push(el('p', { className: 'wg-message', textContent: t('links_empty') }));
      }
      list.replaceChildren(...items);
      fit();
    };

    // 今のウィジェットのサイズに収まる個数を計算し、はみ出す分を隠す
    const fit = () => {
      const tiles = [...list.querySelectorAll('.ln-item')];
      const add = list.querySelector('.ln-add');
      const more = list.querySelector('.ln-more');
      for (const tile of tiles) tile.hidden = false;
      if (add) add.hidden = false;
      more.hidden = true;

      const measured = config.view === 'grid' ? fitGrid() : fitList(tiles[0] ?? add);
      if (!measured) return; // まだ描画されていない(ResizeObserver で後から呼ばれる)

      if (tiles.length > capacity) {
        const visible = capacity - 1; // 最後の 1 枠は「+N」に使う
        tiles.forEach((tile, i) => { tile.hidden = i >= visible; });
        more.hidden = false;
        more.replaceChildren(
          el('span', { className: 'ln-icon', textContent: `+${tiles.length - visible}` }),
          el('span', { className: 'ln-title', textContent: t('links_hidden') }));
      }
      if (add) add.hidden = tiles.length >= capacity;
    };

    // タイル表示: 1 タイル = ダッシュボードの span×span マス。タイル同士の間隔もウィジェット同士の間隔に揃える
    const fitGrid = () => {
      const { w, h, margin } = ctx.gridSize();
      const span = Number(config.tileSpan) || 4;
      ctx.requireHeight(0);
      ctx.setMinSize({ w: span, h: span });
      if (!list.clientWidth || !list.clientHeight) return false;
      const gap = 2 * margin;
      const cols = Math.max(1, Math.floor(w / span));
      const rows = Math.max(1, Math.floor(h / span));
      // 1 マス分の幅 = (内側の幅 + 間隔) / マス数。マス数が span で割り切れれば、隣の span×span ウィジェットと端がちょうど揃う
      const tileW = ((list.clientWidth + gap) / Math.max(w, span)) * span - gap;
      const tileH = ((list.clientHeight + gap) / Math.max(h, span)) * span - gap;
      Object.assign(list.style, {
        gridTemplateColumns: `repeat(${cols}, ${tileW}px)`,
        gridAutoRows: `${tileH}px`,
        gap: `${gap}px`,
      });
      wrap.style.setProperty('--tile-h', `${tileH}px`);
      capacity = cols * rows;
      return true;
    };

    // リスト表示: 実際の行の高さから、入る行数を数える
    const fitList = (sample) => {
      list.removeAttribute('style');
      ctx.setMinSize(null);
      if (!sample) {
        ctx.requireHeight(0);
        return false;
      }
      if (!list.clientHeight) return false;
      // 見出しなどを除いた残りに、1 行は入る高さを要求する(それより小さくリサイズできなくなる)
      ctx.requireHeight(root.clientHeight - list.clientHeight + sample.offsetHeight);
      const style = getComputedStyle(list);
      const gap = parseFloat(style.rowGap) || 0;
      const cols = style.gridTemplateColumns.split(' ').length; // auto-fill で実際に並んだ列数
      const rows = Math.max(1, Math.floor((list.clientHeight + gap) / (sample.offsetHeight + gap)));
      capacity = cols * rows;
      return true;
    };
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(list);

    handleSpecialLinks(list, 'a.ln-link', { newTab: () => config.newTab });

    // ---- ドラッグ: ウィジェット内の並べ替え + 外部からのリンクのドロップ ----
    let dragging = null;

    list.addEventListener('dragstart', (e) => {
      const item = e.target.closest?.('.ln-item');
      if (!item) return;
      dragging = item;
      item.classList.add('dragging');
      const link = config.links.find((l) => l.id === item.dataset.id);
      e.dataTransfer.effectAllowed = 'copyMove';
      e.dataTransfer.setData(DRAG_TYPE, link.id);
      // ブックマークバーや他のウィジェットにもドロップできるように URL も載せる
      e.dataTransfer.setData('text/uri-list', link.url);
      e.dataTransfer.setData('text/plain', link.url);
    });

    list.addEventListener('dragover', (e) => {
      if (dragging) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const target = e.target.closest('.ln-item');
        if (!target || target === dragging) return;
        const items = [...list.querySelectorAll('.ln-item')];
        const after = items.indexOf(dragging) < items.indexOf(target);
        list.insertBefore(dragging, after ? target.nextSibling : target);
      } else if (e.dataTransfer.types.includes('text/uri-list') || e.dataTransfer.types.includes('text/plain')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        wrap.classList.add('drop-target');
      }
    });
    list.addEventListener('dragleave', (e) => {
      if (!list.contains(e.relatedTarget)) wrap.classList.remove('drop-target');
    });

    list.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('drop-target');
      if (dragging) return; // 並べ替えは dragend で確定
      const link = droppedLink(e.dataTransfer);
      if (!link) return;
      askIconPermission([...config.links, link]);
      addLink(link);
    });

    list.addEventListener('dragend', () => {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging = null;
      const order = [...list.querySelectorAll('.ln-item')].map((i) => i.dataset.id);
      if (order.join() !== config.links.map((l) => l.id).join()) {
        const byId = new Map(config.links.map((l) => [l.id, l]));
        save(order.map((id) => byId.get(id)));
      }
    });

    let mounted = true;
    render();
    // キャッシュの読み込みを待ってから描き直し、未取得のアイコンを取りに行く
    icons.ready().then(() => {
      if (!mounted) return;
      render();
      refreshIcons();
    });
    return {
      update(cfg) {
        config = cfg;
        render();
        refreshIcons();
      },
      unmount() {
        mounted = false;
        resizeObserver.disconnect();
        clearTimeout(flashTimer);
      },
    };
  },
};
