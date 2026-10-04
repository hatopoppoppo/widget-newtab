// 写真ウィジェットの写真(IndexedDB。この PC だけに保存し、同期しない)
//
// chrome.storage は sync が 100KB、local も大きい画像を何枚も置くには向かないので、IndexedDB に Blob で置く。
// 追加するときに縮小して保存する。元のファイルをそのまま置くと、1 枚で数 MB〜十数 MB になり、表示のたびに大きな画像を展開することになるため。
//   photos(keyPath: id、索引 owner)
//     { id, owner: ウィジェットの id, order: 並び順(追加した時刻), name, width, height, image: Blob, thumb: Blob }
//   image: 長い辺を MAX_SIDE px 以下に縮小した WebP
//   thumb: 長い辺 THUMB_SIDE px の WebP。全体を表示するときに、余白にぼかして敷く(大きい画像をぼかすより軽い)
// 背景画像の設定を作るときは、ここの縮小と保存を使い回す(owner に 'background' などを入れる)

const DB_NAME = 'photos';
const STORE = 'photos';
export const MAX_SIDE = 2560;
export const THUMB_SIDE = 64;
const QUALITY = 0.85;

let dbPromise = null;
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('owner', 'owner');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(mode, fn) {
  const db = await openDb();
  const t = db.transaction(STORE, mode);
  const result = await fn(t.objectStore(STORE));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result;
}

// ---------- 変更の通知(他のタブにも届く) ----------

const channel = new BroadcastChannel('photos');
const listeners = new Set();
channel.addEventListener('message', (e) => { for (const fn of listeners) fn(e.data.owner); });
function changed(owner) {
  channel.postMessage({ owner });
  for (const fn of listeners) fn(owner); // BroadcastChannel は自分には届かない
}
// fn(owner)。戻り値で登録を解除する
export function onPhotosChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- 読み書き ----------

// owner の写真(追加した順)
export async function listPhotos(owner) {
  const items = await tx('readonly', (s) => done(s.index('owner').getAll(owner)));
  return items.sort((a, b) => a.order - b.order);
}

export const getPhoto = (id) => tx('readonly', (s) => done(s.get(id)));

export async function removePhoto(id) {
  const photo = await getPhoto(id);
  if (!photo) return;
  await tx('readwrite', (s) => done(s.delete(id)));
  changed(photo.owner);
}

export async function removeOwner(owner) {
  await tx('readwrite', async (s) => {
    for (const key of await done(s.index('owner').getAllKeys(owner))) s.delete(key);
  });
  changed(owner);
}

// owner の写真を、別の owner にも複製する(レイアウトを複製したときの背景の画像)
export async function copyOwner(from, to) {
  const list = await listPhotos(from);
  if (!list.length) return;
  await tx('readwrite', (s) => {
    for (const p of list) s.put({ ...p, id: crypto.randomUUID(), owner: to });
  });
  changed(to);
}

// owner を付け替える(保存先の名前を変えたときの移行用)
export async function renameOwner(from, to) {
  const list = await listPhotos(from);
  if (!list.length) return;
  await tx('readwrite', (s) => {
    for (const p of list) s.put({ ...p, owner: to });
  });
  changed(to);
}

// 置かれていないウィジェットの写真・無くなったレイアウトの背景の画像を消す(他の PC で削除したときなど)。
// データベースがまだ無ければ作らずに終える
export async function prune(liveOwners) {
  const dbs = await indexedDB.databases?.() ?? [];
  if (!dbs.some((d) => d.name === DB_NAME)) return;
  const live = new Set(liveOwners);
  const owners = new Set(await tx('readonly', async (s) => {
    const all = [];
    await new Promise((resolve, reject) => {
      const req = s.index('owner').openKeyCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return resolve();
        all.push(cursor.key);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return all;
  }));
  for (const owner of owners) if (!live.has(owner)) await removeOwner(owner);
}

// ---------- 追加 ----------

// 長い辺が max 以下になる大きさ(拡大はしない)
export function fitSize(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function encode(bitmap, { width, height }) {
  const small = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').drawImage(small, 0, 0);
  small.close();
  return canvas.convertToBlob({ type: 'image/webp', quality: QUALITY });
}

// 画像ファイルを縮小して保存する。1 枚ずつ処理する(大きい写真を同時に展開するとメモリを使いすぎるため)。
// onProgress(済んだ枚数, 全体)。戻り値は { added, failed }(読めなかったファイルの数。HEIC など Chrome が開けない形式)
// maxSide: 縮小する長い辺(背景の画像は大きめに残す)
export async function addPhotos(owner, files, onProgress, { maxSide = MAX_SIDE } = {}) {
  let added = 0;
  let failed = 0;
  for (const [i, file] of [...files].entries()) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); // 写真の向き(Exif)に合わせる
      try {
        const size = fitSize(bitmap.width, bitmap.height, maxSide);
        const record = {
          id: crypto.randomUUID(),
          owner,
          order: Date.now() + i / 1000, // 同じ時刻に追加しても、選んだ順に並ぶように
          name: file.name ?? '',
          ...size,
          image: await encode(bitmap, size),
          thumb: await encode(bitmap, fitSize(bitmap.width, bitmap.height, THUMB_SIDE)),
        };
        await tx('readwrite', (s) => done(s.put(record)));
        added++;
      } finally {
        bitmap.close();
      }
    } catch (err) {
      console.warn('写真を読み込めませんでした', file.name, err);
      failed++;
    }
    onProgress?.(i + 1, files.length);
  }
  if (added) changed(owner);
  return { added, failed };
}

// ---------- 表示 ----------

// 切り抜いても写真がこの割合以上残るなら、枠いっぱいに広げる(自動のとき)
export const AUTO_COVER_RATIO = 0.8;

// 写真の収め方。mode: auto | cover | contain → cover | contain
export function chooseFit(mode, box, photo) {
  if (mode !== 'auto') return mode;
  if (!box.width || !box.height) return 'cover';
  const a = box.width / box.height;
  const b = photo.width / photo.height;
  return Math.min(a, b) / Math.max(a, b) >= AUTO_COVER_RATIO ? 'cover' : 'contain';
}
