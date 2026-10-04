// ページの背景(全体設定の bgType)。テーマの色 / 単色 / グラデーション / 画像
//
// body の後ろに固定の層(#page-bg)を置いて描く。画像は IndexedDB の owner 'background:<レイアウトの id>'(この PC だけ)。
// 画像を選んでいないPC(同期した先など)では、テーマの色にする
import { el, icon } from './ui.js';
import { t } from './i18n.js';
import { backgroundOwner, isBackgroundOwner } from './store.js';
import * as photos from './photo-store.js';
import { gradientCss } from './gradient.js';

// 背景の画像は 4K の画面いっぱいに出すこともあるので、写真ウィジェットより大きく残す
export const BACKGROUND_MAX_SIDE = 3840;

let layer = null;
let image = null;    // { key, photo, urls: [image, thumb] }。key は IndexedDB の id か、選んだばかりのファイル
let token = 0;

function ensureLayer() {
  if (layer) return layer;
  layer = el('div', { id: 'page-bg', ariaHidden: 'true' },
    el('div', { className: 'bg-fill' }),
    el('div', { className: 'bg-image' }),
    el('div', { className: 'bg-dim' }));
  document.body.prepend(layer);
  return layer;
}

function setImage(next) {
  if (image) for (const url of image.urls) URL.revokeObjectURL(url);
  image = next;
}

// レイアウト lid の背景の画像(保存済み)。無ければ null
export async function loadBackgroundPhoto(lid) {
  const [photo] = await photos.listPhotos(backgroundOwner(lid));
  return photo ?? null;
}

// p: 全体設定。lid: レイアウトの id(画像の置き場所)。
// pending: 設定ダイアログで選んだばかりで、まだ保存していない画像のファイル(試し表示用)
export async function applyBackground(p, { lid, pending } = {}) {
  const my = ++token;
  const root = ensureLayer();
  const [fill, img, dim] = root.children;
  root.dataset.type = p.bgType;
  root.style.background = '';
  img.style.backgroundImage = fill.style.backgroundImage = '';
  // body の地(テーマの色)は、画像が無いときの代わりにも使う
  if (p.bgType === 'color') root.style.background = p.bg;
  else if (p.bgType === 'gradient') root.style.background = gradientCss(p.gradient);
  if (p.bgType !== 'image') {
    setImage(null);
    return;
  }

  let next = image;
  if (pending) {
    if (image?.key !== pending) next = { key: pending, urls: [URL.createObjectURL(pending)] };
  } else {
    const photo = await loadBackgroundPhoto(lid).catch((err) => {
      console.error(err);
      return null;
    });
    if (my !== token) return;
    if (!photo) next = null;
    else if (image?.key !== photo.id) next = { key: photo.id, urls: [URL.createObjectURL(photo.image), URL.createObjectURL(photo.thumb)] };
  }
  if (next !== image) setImage(next);
  root.dataset.type = image ? 'image' : 'theme';
  if (!image) return;
  const [main, thumb = main] = image.urls;
  img.style.backgroundImage = `url("${main}")`;
  img.style.backgroundSize = p.bgImageFit === 'contain' ? 'contain' : 'cover';
  img.style.filter = p.bgImageBlur ? `blur(${p.bgImageBlur}px)` : '';
  img.classList.toggle('blurred', p.bgImageBlur > 0);
  fill.hidden = p.bgImageFit !== 'contain';
  fill.style.backgroundImage = `url("${thumb}")`;
  dim.style.opacity = String((p.bgImageDim ?? 0) / 100);
}

// 他のタブで背景の画像を変えたとき。fn(lid)
export function onBackgroundPhotoChange(fn) {
  return photos.onPhotosChange((owner) => {
    if (isBackgroundOwner(owner)) fn(owner.slice(owner.indexOf(':') + 1));
  });
}

// 選んだ画像をレイアウト lid の背景として保存する(前の画像は消す)
export async function saveBackgroundPhoto(lid, file) {
  const owner = backgroundOwner(lid);
  const old = await photos.listPhotos(owner);
  const { added } = await photos.addPhotos(owner, [file], null, { maxSide: BACKGROUND_MAX_SIDE });
  if (!added) throw new Error(t('bg_image_failed'));
  for (const p of old) await photos.removePhoto(p.id);
}

// 設定ダイアログの custom 欄: レイアウト lid の背景の画像を選ぶ。read() は選んだファイル(選んでいなければ null)
export function backgroundImageField(lid) {
  let file = null;
  let url = null;
  const thumb = el('div', { className: 'bg-pick-thumb' });
  const name = el('span', { className: 'bg-pick-name', textContent: t('bg_image_none') });
  const input = el('input', { type: 'file', accept: 'image/*', hidden: true });
  const button = el('button', { type: 'button', className: 'btn bg-pick-button' }, icon('upload'), t('bg_image_pick'));
  const node = el('div', { className: 'bg-pick' }, thumb, el('div', { className: 'bg-pick-side' }, name, button), input);

  const show = (blob, label) => {
    if (url) URL.revokeObjectURL(url);
    url = blob ? URL.createObjectURL(blob) : null;
    thumb.style.backgroundImage = url ? `url("${url}")` : '';
    name.textContent = label;
  };
  loadBackgroundPhoto(lid).then((photo) => {
    if (photo && !file) show(photo.image, photo.name || t('bg_image_saved'));
  }).catch((err) => console.error(err));

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    e.stopPropagation();
    if (!input.files[0]) return;
    file = input.files[0];
    show(file, file.name);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return { node, read: () => file };
}
