// サイトの高解像度アイコンの取得とキャッシュ
//
// Chrome の _favicon API はタブ用の小さな画像(16〜32px)しか持っていないので、大きく表示するとぼやける。
// そこでリンクのページの HTML を一度だけ取得し、SVG や大きい PNG(apple-touch-icon、sizes 付きの icon、
// manifest のアイコン)を探して chrome.storage.local に data URL で保存する。
// 他サイトの HTML を読むには host 権限が必要なので、manifest の optional_host_permissions を
// ユーザー操作の中で requestPermission() から要求する。

import { faviconUrl } from './ui.js';

const ORIGINS = ['<all_urls>'];
const KEY_PREFIX = 'icon:';
const MIN_SIZE = 64;             // これより小さいアイコンしか無ければ _favicon のままにする
const RASTER_SIZE = 128;         // PNG などはこの大きさに縮小して保存する
const MAX_SVG_BYTES = 100_000;
const RETRY_AFTER = 7 * 24 * 60 * 60 * 1000; // 取得に失敗したサイトを再挑戦するまでの間隔
const TIMEOUT = 8000;
const PARALLEL = 3;

// ---------- 権限 ----------

let permitted = false;
const permissionReady = chrome.permissions.contains({ origins: ORIGINS }).then((ok) => { permitted = ok; });
chrome.permissions.onAdded.addListener(() => chrome.permissions.contains({ origins: ORIGINS }).then((ok) => { permitted = ok; }));
chrome.permissions.onRemoved.addListener(() => { permitted = false; });

export const hasPermission = () => permitted;

// クリックなどのユーザー操作のハンドラから「同期的に」呼ぶこと(await の後だと確認ダイアログが出ない)
export function requestPermission() {
  return chrome.permissions.request({ origins: ORIGINS }).then((ok) => {
    permitted = ok;
    return ok;
  }).catch(() => false);
}

// ---------- キャッシュ ----------
// icon:<キー> = { src: data URL | null, at: 取得時刻 }。キーは自動取得ならリンクの URL、手動指定ならアイコンの URL

const cache = new Map();
const cacheReady = chrome.storage.local.get(null).then((all) => {
  for (const [k, v] of Object.entries(all)) if (k.startsWith(KEY_PREFIX)) cache.set(k.slice(KEY_PREFIX.length), v);
});
// 他のタブで取得されたアイコンも反映する
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [k, { newValue }] of Object.entries(changes)) {
    if (!k.startsWith(KEY_PREFIX)) continue;
    if (newValue) cache.set(k.slice(KEY_PREFIX.length), newValue);
    else cache.delete(k.slice(KEY_PREFIX.length));
  }
});

export const ready = () => Promise.all([permissionReady, cacheReady]);

const cacheKey = (link) => (link.icon ? `img:${link.icon}` : `auto:${link.url}`);
const isWeb = (url) => /^https?:/i.test(url);

// 今表示すべきアイコンの URL(同期)。キャッシュが無ければ、手動指定はその URL、自動は _favicon
export function iconSrc(link, size = 128) {
  const hit = cache.get(cacheKey(link));
  if (hit?.src) return hit.src;
  if (link.icon) return link.icon;
  return faviconUrl(link.url, size);
}

// ---------- 取得 ----------

let running = 0;
const queue = [];
const inFlight = new Map(); // cacheKey -> Promise

function enqueue(task) {
  return new Promise((resolve) => {
    queue.push(async () => {
      try {
        resolve(await task());
      } catch {
        resolve(null);
      }
    });
    pump();
  });
}
function pump() {
  while (running < PARALLEL && queue.length) {
    running++;
    queue.shift()().finally(() => {
      running--;
      pump();
    });
  }
}

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// "180x180" / "32x32 64x64" / "any" -> 最大の辺(any は SVG 相当として大きく扱う)
function parseSizes(sizes) {
  if (!sizes) return 0;
  if (/\bany\b/i.test(sizes)) return 10_000;
  return Math.max(0, ...sizes.split(/\s+/).map((s) => Number(s.split(/x/i)[0]) || 0));
}

const isSvg = (href, type) => /svg/i.test(type ?? '') || /\.svg(\?|#|$)/i.test(href);

// ページの HTML(と manifest)から、アイコンの候補を { url, score } で集める
async function findCandidates(pageUrl) {
  const res = await fetchWithTimeout(pageUrl, { headers: { accept: 'text/html' } });
  const base = res.url;
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const out = [];
  let manifestUrl = null;

  for (const link of doc.querySelectorAll('link[rel][href]')) {
    const rel = link.getAttribute('rel').toLowerCase().split(/\s+/);
    const href = new URL(link.getAttribute('href'), base).href;
    if (rel.includes('manifest')) {
      manifestUrl = href;
    } else if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
      const svg = isSvg(href, link.getAttribute('type'));
      const size = svg ? 10_000 : parseSizes(link.getAttribute('sizes')) || (rel.includes('icon') ? 32 : 180);
      out.push({ url: href, svg, size });
    }
  }

  if (manifestUrl) {
    try {
      const manifest = await (await fetchWithTimeout(manifestUrl)).json();
      for (const icon of manifest.icons ?? []) {
        const purpose = (icon.purpose ?? 'any').split(/\s+/);
        if (!purpose.includes('any')) continue; // maskable(余白付き)・monochrome は除く
        const href = new URL(icon.src, manifestUrl).href;
        const svg = isSvg(href, icon.type);
        out.push({ url: href, svg, size: svg ? 10_000 : parseSizes(icon.sizes) });
      }
    } catch {
      // manifest が読めなくても HTML の候補だけで続ける
    }
  }
  return out;
}

// 画像を取得して data URL にする。SVG はそのまま、それ以外は RASTER_SIZE に縮小した PNG にする
async function toDataUrl(url, { svg }) {
  const blob = await (await fetchWithTimeout(url)).blob();
  if (svg || blob.type.includes('svg')) {
    if (blob.size > MAX_SVG_BYTES) throw new Error('svg too large');
    return blobToDataUrl(new Blob([await blob.text()], { type: 'image/svg+xml' }));
  }
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, RASTER_SIZE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function resolveIcon(link) {
  if (link.icon) return toDataUrl(link.icon, { svg: isSvg(link.icon) });
  const candidates = (await findCandidates(link.url))
    .filter((c) => c.svg || c.size >= MIN_SIZE)
    .sort((a, b) => b.size - a.size); // SVG(10000)→ 大きい順
  for (const c of candidates) {
    try {
      return await toDataUrl(c.url, c);
    } catch {
      // 次の候補へ
    }
  }
  return null; // 大きいアイコンが無い → _favicon のまま
}

// 必要ならアイコンを取得してキャッシュする。表示を変えるべきとき true を返す
export async function ensureIcon(link) {
  await ready();
  if (!permitted) return false;
  if (!link.icon && !isWeb(link.url)) return false;
  if (link.icon && !isWeb(link.icon)) return false;
  const key = cacheKey(link);
  const hit = cache.get(key);
  if (hit && (hit.src || Date.now() - hit.at < RETRY_AFTER)) return false;
  if (!inFlight.has(key)) {
    inFlight.set(key, enqueue(async () => {
      let src = null;
      try {
        src = await resolveIcon(link);
      } catch {
        src = null;
      }
      const entry = { src, at: Date.now() };
      cache.set(key, entry);
      await chrome.storage.local.set({ [KEY_PREFIX + key]: entry });
      return !!src;
    }).finally(() => inFlight.delete(key)));
  }
  return inFlight.get(key);
}

