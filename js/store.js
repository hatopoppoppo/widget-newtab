// chrome.storage.sync のキー構成
//   layouts       : [{ id, name }]                レイアウト(配置と見た目の設定の組)の一覧。並び順もこのまま
//   layout:<lid>  : [{ id, type, x, y, w, h }]   レイアウトごとのウィジェットの配置
//   prefs:<lid>   : { ... }                      レイアウトごとの全体設定(テーマ・色・背景・間隔)
//   cfg:<id>      : { ... }                      ウィジェットごとの設定(レイアウトをまたいで共有)
//   data:<id>     : any                          ウィジェットごとのデータ(ToDo・リマインダーの中身など。共有)
//   gridVersion   : 2                            レイアウトの座標系(1 = 12 列・固定の行の高さ、2 = 24 列の正方形)
// 同じウィジェット(id)を複数のレイアウトに置ける。設定と中身は 1 つで、どのレイアウトからも外れたときに消す。
// sync は 1 項目 8KB までなので、設定はウィジェットごとに別キーへ分けている。
// トークンなど同期させたくない値や大きいデータは chrome.storage.local / IndexedDB に置くこと。
//
// 以前は layout / prefs の 1 組だけだった。読むときは id 'main' のレイアウト 1 つとして扱い、新規タブが開いたときに移す(migrateLegacy)
//
// chrome.storage.local(同期しない)
//   activeLayout : lid                         この PC で表示しているレイアウト(PC ごとに別のレイアウトを使える)
//   memo:<id>  : { id, body, created, updated }  メモ(Markdown)。ウィジェットとメモ専用ページ(memo.html)で共有

const LAYOUTS = 'layouts';
const LAYOUT_PREFIX = 'layout:';
const PREFS_PREFIX = 'prefs:';
const LEGACY_LAYOUT = 'layout';
const LEGACY_PREFS = 'prefs';
const ACTIVE = 'activeLayout';
export const MAIN_LAYOUT = 'main'; // 以前の 1 組だけの設定から移したレイアウトの id
export const MAX_LAYOUTS = 10;     // sync の容量(全体で 100KB)の都合
const CFG_PREFIX = 'cfg:';
const DATA_PREFIX = 'data:';
const GRID_VERSION = 'gridVersion';
export const CURRENT_GRID_VERSION = 2;

export const PREF_DEFAULTS = {
  theme: 'auto',      // auto | light | dark
  accentMode: 'theme', // アクセントカラー: theme(テーマの色)| custom(accent を使う)
  accent: '#3b6fe0',
  widgetBgMode: 'theme', // ウィジェットの背景色: theme | custom(widgetBg を使う。文字の色は明るさに合わせる)
  widgetBg: '#ffffff',
  widgetOpacity: 100,  // ウィジェットの不透明度(%)。下げると背景が透ける
  bgType: 'theme',    // 背景: theme(テーマの色)| color | gradient | image
  bg: '#20242c',      // 単色の背景
  gradient: {         // グラデーション(js/gradient.js の gradientCss)
    kind: 'linear',   // linear | radial | conic
    angle: 135,       // 線形・扇形の向き(度)
    shape: 'ellipse', // 円形の形: ellipse | circle
    x: 50, y: 50,     // 円形・扇形の中心(%)
    repeat: false,    // repeating-*-gradient にする
    stops: [{ color: '#4f46e5', pos: 0 }, { color: '#ec4899', pos: 100 }],
  },
  bgImageFit: 'cover', // 画像の収め方: cover | contain(余白は同じ画像のぼかし)
  bgImageDim: 0,       // 画像を暗くする割合(%)
  bgImageBlur: 0,      // 画像をぼかす強さ(px)
  margin: 6,          // ウィジェットの間隔(px)
};
// 背景の画像は IndexedDB(js/photo-store.js)の owner 'background:<lid>' に置く(レイアウトごと)。この PC だけで、同期しない
export const backgroundOwner = (lid) => `background:${lid}`;
export const isBackgroundOwner = (owner) => owner.startsWith('background:');

// 保存されている全体設定に初期値を補う。古い useBg(背景色を指定する)は bgType に読み替える
export function withPrefDefaults(stored = {}) {
  const { useBg, ...rest } = stored;
  return { ...PREF_DEFAULTS, bgType: useBg ? 'color' : 'theme', ...rest };
}
// PC ごとの設定(同期しない。chrome.storage.local の device:<名前>)
export const DEVICE_DEFAULTS = {
  reminderNotify: true, // この PC でリマインダーの通知を出す
  switchbotToken: '',   // SwitchBot の API のトークンとシークレット(他の PC に同期させない)
  switchbotSecret: '',
};
export async function loadDevicePrefs() {
  const keys = Object.fromEntries(Object.entries(DEVICE_DEFAULTS).map(([k, v]) => [`device:${k}`, v]));
  const got = await chrome.storage.local.get(keys);
  return Object.fromEntries(Object.keys(DEVICE_DEFAULTS).map((k) => [k, got[`device:${k}`]]));
}
export const saveDevicePrefs = (prefs) =>
  chrome.storage.local.set(Object.fromEntries(Object.entries(prefs).map(([k, v]) => [`device:${k}`, v])));

// gridVersion 1 のころの「1 行の高さ」の初期値(prefs.cellHeight が無いときの移行用)
export const LEGACY_CELL_HEIGHT = 64;

// sync の中身を読む。layoutData: { [lid]: { layout, prefs } }。
// widgets はどれかのレイアウトに置かれているウィジェット [{ id, type }](重なりなし。バックグラウンドの通知などで使う)
function parseAll(all) {
  const configs = {};
  const data = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(CFG_PREFIX)) configs[key.slice(CFG_PREFIX.length)] = value;
    else if (key.startsWith(DATA_PREFIX)) data[key.slice(DATA_PREFIX.length)] = value;
  }
  const legacy = !all[LAYOUTS];
  let layouts = [];
  const layoutData = {};
  if (legacy) {
    if (all[LEGACY_LAYOUT] || all[LEGACY_PREFS]) {
      layouts = [{ id: MAIN_LAYOUT, name: null }]; // 名前は移すときに付ける
      layoutData[MAIN_LAYOUT] = { layout: all[LEGACY_LAYOUT] ?? [], prefs: withPrefDefaults(all[LEGACY_PREFS]) };
    }
  } else {
    layouts = all[LAYOUTS];
    for (const { id } of layouts) layoutData[id] = { layout: all[LAYOUT_PREFIX + id] ?? [], prefs: withPrefDefaults(all[PREFS_PREFIX + id]) };
  }
  const widgets = new Map();
  for (const { layout } of Object.values(layoutData)) for (const w of layout) widgets.set(w.id, { id: w.id, type: w.type });
  return {
    layouts,      // [] = 初回起動
    layoutData,
    legacy,       // 以前の形式(移す必要がある)
    configs,
    data,
    widgets: [...widgets.values()],
    // 記録が無いのにレイアウトがあるのは、24 列になる前に保存されたもの
    gridVersion: all[GRID_VERSION] ?? (all[LEGACY_LAYOUT] ? 1 : CURRENT_GRID_VERSION),
  };
}
export const loadAll = async () => parseAll(await chrome.storage.sync.get(null));

// 以前の形式(layout / prefs)を、id 'main' のレイアウトに移す
export async function migrateLegacy({ name, layout, prefs }) {
  await chrome.storage.sync.set({
    [LAYOUTS]: [{ id: MAIN_LAYOUT, name }],
    [LAYOUT_PREFIX + MAIN_LAYOUT]: layout,
    [PREFS_PREFIX + MAIN_LAYOUT]: prefs,
    [GRID_VERSION]: CURRENT_GRID_VERSION,
  });
  await chrome.storage.sync.remove([LEGACY_LAYOUT, LEGACY_PREFS]);
}

// ---------- レイアウト ----------

export const saveLayoutList = (layouts) => chrome.storage.sync.set({ [LAYOUTS]: layouts });
export const saveLayout = (lid, layout) => chrome.storage.sync.set({ [LAYOUT_PREFIX + lid]: layout });
export const savePrefs = (lid, prefs) => chrome.storage.sync.set({ [PREFS_PREFIX + lid]: prefs });
export const saveLayoutData = (lid, { layout, prefs }) =>
  chrome.storage.sync.set({ [LAYOUT_PREFIX + lid]: layout, [PREFS_PREFIX + lid]: prefs });
export const removeLayoutData = (lid) => chrome.storage.sync.remove([LAYOUT_PREFIX + lid, PREFS_PREFIX + lid]);
export const saveMigratedLayout = (lid, layout) =>
  chrome.storage.sync.set({ [LAYOUT_PREFIX + lid]: layout, [GRID_VERSION]: CURRENT_GRID_VERSION });

// この PC で表示するレイアウト(無い・消えたものなら一覧の先頭)
export async function loadActiveLayout(layouts) {
  const id = (await chrome.storage.local.get(ACTIVE))[ACTIVE];
  return layouts.some((l) => l.id === id) ? id : layouts[0]?.id ?? null;
}
export const saveActiveLayout = (lid) => chrome.storage.local.set({ [ACTIVE]: lid });

export const saveConfig = (id, config) => chrome.storage.sync.set({ [CFG_PREFIX + id]: config });
export const removeConfig = (id) => chrome.storage.sync.remove(CFG_PREFIX + id);
export const dataKey = (id) => DATA_PREFIX + id;
export const loadData = async (id) => (await chrome.storage.sync.get(DATA_PREFIX + id))[DATA_PREFIX + id];
export const saveData = (id, value) => chrome.storage.sync.set({ [DATA_PREFIX + id]: value });
// ウィジェットを削除したときに、そのウィジェットのデータ(sync・local とも)も消す
export const removeData = (id) => Promise.all([
  chrome.storage.sync.remove(DATA_PREFIX + id),
  chrome.storage.local.remove(DATA_PREFIX + id),
]);

// どれかのレイアウトに置かれている type のウィジェット [{ id, cfg }]
export async function listWidgets(type) {
  const all = await chrome.storage.sync.get(null);
  return parseAll(all).widgets.filter((w) => w.type === type).map((w) => ({ id: w.id, cfg: all[CFG_PREFIX + w.id] ?? {} }));
}

// この PC で表示しているレイアウトの全体設定(メモのページ用)
export async function loadPrefs() {
  const { layouts, layoutData } = await loadAll();
  const lid = await loadActiveLayout(layouts);
  return layoutData[lid]?.prefs ?? withPrefDefaults();
}

// 書き出しファイルの読み込み。layouts / layoutData の無い古いファイル(layout / prefs だけ)は、1 つのレイアウトにする。
// gridVersion を省略すると現在の座標系として扱う。古い書き出しファイルは 1 を渡すと、次の起動時に変換される。
// memos は今あるメモに追加する(同じ id は上書き。読み込んだファイルに無いメモは消さない)
export async function replaceAll({ layouts, layoutData, layout, prefs = {}, name = null, configs = {}, data = {}, memos = [], gridVersion = CURRENT_GRID_VERSION }) {
  if (!layouts) {
    layouts = [{ id: MAIN_LAYOUT, name }];
    layoutData = { [MAIN_LAYOUT]: { layout: layout ?? [], prefs } };
  }
  await chrome.storage.sync.clear();
  const items = { [LAYOUTS]: layouts, [GRID_VERSION]: gridVersion };
  for (const { id } of layouts) {
    items[LAYOUT_PREFIX + id] = layoutData[id]?.layout ?? [];
    items[PREFS_PREFIX + id] = withPrefDefaults(layoutData[id]?.prefs);
  }
  for (const [id, cfg] of Object.entries(configs)) items[CFG_PREFIX + id] = cfg;
  for (const [id, value] of Object.entries(data)) items[DATA_PREFIX + id] = value;
  await chrome.storage.sync.set(items);
  if (memos.length) await chrome.storage.local.set(Object.fromEntries(memos.map((m) => [MEMO_PREFIX + m.id, m])));
}

// ---------- メモ(chrome.storage.local の memo:<id>。他の PC には同期しない) ----------

const MEMO_PREFIX = 'memo:';
// 新しく更新したものから順に
export async function listMemos() {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(MEMO_PREFIX))
    .map(([, memo]) => memo)
    .sort((a, b) => b.updated - a.updated);
}
export const loadMemo = async (id) => (await chrome.storage.local.get(MEMO_PREFIX + id))[MEMO_PREFIX + id] ?? null;
export const saveMemo = (memo) => chrome.storage.local.set({ [MEMO_PREFIX + memo.id]: memo });
export const removeMemo = (id) => chrome.storage.local.remove(MEMO_PREFIX + id);
// メモの変更(他のタブでの変更も、自分の保存も届く)。fn(id, memo | null)。戻り値で登録を解除する
export function onMemoChange(fn) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key.startsWith(MEMO_PREFIX)) fn(key.slice(MEMO_PREFIX.length), newValue ?? null);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

// 他のタブ・PC で変更されたときの通知。自分の書き込みも届くので、呼び出し側で差分を見て判断する。
//   layouts(list) / layout(lid, layout) / prefs(lid, prefs) / config(id, cfg) / data(id, value)
//   active(lid): この PC の別のタブでレイアウトを切り替えた
export function onExternalChange({ layouts, layout, prefs, config, data, active }) {
  chrome.storage.onChanged.addListener((changes, area) => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (area === 'local') {
        if (key === ACTIVE && newValue) active?.(newValue);
        continue;
      }
      if (area !== 'sync') continue;
      if (key === LAYOUTS) layouts?.(newValue ?? []);
      else if (key.startsWith(LAYOUT_PREFIX)) layout?.(key.slice(LAYOUT_PREFIX.length), newValue ?? []);
      else if (key.startsWith(PREFS_PREFIX)) prefs?.(key.slice(PREFS_PREFIX.length), withPrefDefaults(newValue));
      else if (key.startsWith(CFG_PREFIX)) config?.(key.slice(CFG_PREFIX.length), newValue);
      else if (key.startsWith(DATA_PREFIX)) data?.(key.slice(DATA_PREFIX.length), newValue);
    }
  });
}
