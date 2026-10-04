import { el, ICONS, faviconUrl, handleSpecialLinks } from '../ui.js';
import { t } from '../i18n.js';

const EVENTS = ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered', 'onImportEnded'];

// サブフォルダの開閉状態は端末ごとに保存(全ブックマークウィジェットで共有)
let openFolders = null;
const loadOpenFolders = async () => {
  openFolders ??= (await chrome.storage.local.get({ openFolders: {} })).openFolders;
  return openFolders;
};

async function folderOptions() {
  const [root] = await chrome.bookmarks.getTree();
  const out = [{ value: '', label: t('bookmarks_bar') }];
  const walk = (node, depth) => {
    for (const c of node.children ?? []) {
      if (c.url) continue;
      out.push({ value: c.id, label: `${'\u3000'.repeat(depth)}${c.title || t('bookmarks_untitled')}` });
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

async function findFolder(folderId) {
  const [root] = await chrome.bookmarks.getTree();
  if (!folderId) {
    return root.children.find((c) => c.folderType === 'bookmarks-bar') ?? root.children[0];
  }
  const find = (node) => {
    if (node.id === folderId) return node;
    for (const c of node.children ?? []) {
      const hit = !c.url && find(c);
      if (hit) return hit;
    }
    return null;
  };
  return find(root);
}

export default {
  type: 'bookmarks',
  name: t('bookmarks_name'),
  description: t('bookmarks_description'),
  size: { w: 6, h: 6, minW: 4, minH: 2 },
  defaults: {
    folderId: '',
    title: '',
    showTitle: true,
    newTab: false,
  },
  fields: [
    { key: 'folderId', label: t('bookmarks_folder'), type: 'select', options: folderOptions },
    { key: 'showTitle', label: t('bookmarks_show_title'), type: 'checkbox' },
    { key: 'title', label: t('bookmarks_title'), type: 'text', placeholder: t('bookmarks_title_placeholder'), when: (v) => v.showTitle },
    { key: 'newTab', label: t('bookmarks_new_tab'), type: 'checkbox' },
  ],

  mount(root, config) {
    const head = el('div', { className: 'bm-head' });
    const body = el('div', { className: 'bm-body' });
    root.append(el('div', { className: 'bm' }, head, body));

    const renderLink = (node) => {
      const a = el('a', { className: 'bm-link', href: node.url, title: `${node.title}\n${node.url}` });
      if (node.url.startsWith('javascript:')) {
        a.classList.add('disabled');
        a.title = t('bookmarks_bookmarklet');
      } else if (config.newTab) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
      const img = el('img', { alt: '', loading: 'lazy', width: 16, height: 16 });
      img.src = faviconUrl(node.url);
      a.append(img, el('span', { textContent: node.title || node.url }));
      return a;
    };

    const renderChildren = (node) => {
      const box = el('div', { className: 'bm-links' });
      for (const child of node.children ?? []) {
        if (child.url) {
          box.append(renderLink(child));
          continue;
        }
        const inner = renderChildren(child);
        if (!inner.childElementCount) continue;
        const summary = el('summary', {}, el('span', { className: 'icon' }), el('span', { textContent: child.title || t('bookmarks_untitled') }));
        summary.firstChild.innerHTML = ICONS.chevron;
        const details = el('details', { open: !!openFolders[child.id] }, summary, inner);
        details.addEventListener('toggle', () => {
          if (details.open) openFolders[child.id] = true;
          else delete openFolders[child.id];
          chrome.storage.local.set({ openFolders });
        });
        box.append(details);
      }
      return box;
    };

    let seq = 0;
    const render = async () => {
      const mySeq = ++seq;
      const [folder] = await Promise.all([findFolder(config.folderId), loadOpenFolders()]);
      if (mySeq !== seq) return; // 連続で呼ばれたときは最後の 1 回だけ描画

      head.textContent = config.title || folder?.title || '';
      head.hidden = !config.showTitle;
      if (!folder) {
        body.replaceChildren(el('p', { className: 'wg-message', textContent: t('bookmarks_folder_missing') }));
        return;
      }
      const links = renderChildren(folder);
      body.replaceChildren(links.childElementCount ? links : el('p', { className: 'wg-message', textContent: t('bookmarks_empty') }));
    };

    handleSpecialLinks(body, 'a.bm-link', { newTab: () => config.newTab });

    let timer;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(render, 150);
    };
    for (const ev of EVENTS) chrome.bookmarks[ev].addListener(onChange);

    render();
    return {
      update(cfg) {
        config = cfg;
        render();
      },
      unmount() {
        clearTimeout(timer);
        for (const ev of EVENTS) chrome.bookmarks[ev].removeListener(onChange);
      },
    };
  },
};
