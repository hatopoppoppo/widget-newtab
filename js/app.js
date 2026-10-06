import * as store from './store.js';
import { WIDGETS, getWidget } from './widgets/index.js';
import { el, icon, editSettings, pickWidget, downloadJSON, pickFile, showDialog } from './ui.js';
import { t, applyI18n } from './i18n.js';
import { gradientEditor } from './gradient.js';
import { applyTheme } from './theme.js';
import { applyBackground, backgroundImageField, saveBackgroundPhoto, onBackgroundPhotoChange } from './page-bg.js';
import { layoutListField } from './layouts-ui.js';
import * as photos from './photo-store.js';
import { checkForUpdate, dismissUpdate, reloadExtension, helperAvailable, updateWithHelper, ZIP_URL, REPO_URL, FEEDBACK_URL } from './update.js';

// 全ウィジェット共通の設定項目
const COMMON_DEFAULTS = { frame: true };
const COMMON_FIELDS = [
  { key: 'frame', label: t('common_show_frame'), type: 'checkbox' },
];

// 全体設定の項目。device: true は PC ごとの設定(chrome.storage.local の device:<key>。他の PC には同期しない)
const section = (key, level, open = false) => ({ type: 'section', key, label: t(`prefs_section_${key}`), level, open });
const COLOR_MODES = [
  { value: 'theme', label: t('prefs_color_mode_theme') },
  { value: 'custom', label: t('prefs_color_mode_custom') },
];
const PREF_FIELDS = [
  section('theme', 1, true),
  {
    key: 'theme', label: t('prefs_theme'), type: 'select', options: [
      { value: 'auto', label: t('prefs_theme_auto') },
      { value: 'light', label: t('prefs_theme_light') },
      { value: 'dark', label: t('prefs_theme_dark') },
    ],
  },
  { key: 'accentMode', label: t('prefs_accent'), type: 'select', options: COLOR_MODES },
  { key: 'accent', label: t('prefs_color'), type: 'color', when: (v) => v.accentMode === 'custom' },

  section('widget', 2),
  { key: 'widgetBgMode', label: t('prefs_widget_bg'), type: 'select', options: COLOR_MODES },
  { key: 'widgetBg', label: t('prefs_color'), type: 'color', hint: t('prefs_widget_bg_hint'), when: (v) => v.widgetBgMode === 'custom' },
  { key: 'widgetOpacity', label: t('prefs_widget_opacity'), type: 'range', min: 20, max: 100, step: 5, unit: '%', hint: t('prefs_widget_opacity_hint') },
  { key: 'margin', label: t('prefs_margin'), type: 'range', min: 0, max: 20, unit: 'px' },
  { key: 'uiScale', device: true, label: t('prefs_ui_scale'), type: 'range', min: 70, max: 150, step: 5, unit: '%', hint: t('prefs_ui_scale_hint') },

  section('background', 2),
  {
    key: 'bgType', label: t('prefs_bg_type'), type: 'select', options: [
      { value: 'theme', label: t('prefs_bg_type_theme') },
      { value: 'color', label: t('prefs_bg_type_color') },
      { value: 'gradient', label: t('prefs_bg_type_gradient') },
      { value: 'image', label: t('prefs_bg_type_image') },
    ],
  },
  { key: 'bg', label: t('prefs_bg'), type: 'color', when: (v) => v.bgType === 'color' },
  { key: 'gradient', label: t('prefs_gradient'), type: 'custom', create: (value) => gradientEditor(value), when: (v) => v.bgType === 'gradient' },
  { key: 'bgImage', label: t('prefs_bg_image'), type: 'custom', create: () => backgroundImageField(activeLid), hint: t('bg_image_hint'), when: (v) => v.bgType === 'image' },
  {
    key: 'bgImageFit', label: t('prefs_bg_image_fit'), type: 'select', when: (v) => v.bgType === 'image', options: [
      { value: 'cover', label: t('bg_image_fit_cover') },
      { value: 'contain', label: t('bg_image_fit_contain') },
    ],
  },
  { key: 'bgImageDim', label: t('prefs_bg_image_dim'), type: 'range', min: 0, max: 80, step: 5, unit: '%', when: (v) => v.bgType === 'image' },
  { key: 'bgImageBlur', label: t('prefs_bg_image_blur'), type: 'range', min: 0, max: 20, unit: 'px', when: (v) => v.bgType === 'image' },

  section('integrations', 1),
  section('switchbot', 2),
  { key: 'switchbotToken', device: true, label: t('prefs_switchbot_token'), type: 'password' },
  { key: 'switchbotSecret', device: true, label: t('prefs_switchbot_secret'), type: 'password', hint: t('prefs_switchbot_hint') },

  // 1 項目だけなので、見出しで折りたたまずに出しておく
  { key: 'reminderNotify', device: true, outside: true, label: t('prefs_reminder_notify'), type: 'checkbox', hint: t('prefs_reminder_notify_hint') },
  // バージョンと更新の確認・再読み込み(値は持たない)
  { key: 'about', outside: true, label: t('prefs_about'), type: 'custom', create: () => aboutField() },
];
const DEVICE_KEYS = PREF_FIELDS.filter((f) => f.device).map((f) => f.key);

// グリッドは 24 列の正方形マス(1 マスの大きさはウィンドウ幅 / 24。1400px なら約 57px)
const COLUMNS = 24;

const DEFAULT_LAYOUT = [
  { type: 'clock', x: 0, y: 0, w: 6, h: 2 },
  { type: 'search', x: 6, y: 0, w: 12, h: 1 },
  { type: 'bookmarks', x: 0, y: 2, w: 6, h: 6 },
  { type: 'piano', x: 6, y: 2, w: 12, h: 4 },
];

const $ = (sel) => document.querySelector(sel);
const instances = new Map(); // id -> { id, type, def, node, content, body, config, handle }
let grid;
let prefs;           // 表示しているレイアウトの全体設定
let layouts = [];    // [{ id, name }]
let activeLid = null; // 表示しているレイアウト(PC ごと)
let editing = false;
let lastLayoutJSON = '';

// ウィジェットの中身の大きさの基準: 幅 1864px の画面(作者の環境の 100%)でのグリッドの幅(左右の余白 16px ずつを除く)。
// 中身はこのときのマスの大きさで作り、今のグリッドの幅との比(scale)を中身全体に掛ける(.wg-body の CSS の zoom)。
// 拡大縮小・ウィンドウの幅を変えても、マスと一緒に中身も同じ比率で伸縮するので、見た目が崩れない。
// zoom の中では offsetHeight などは掛ける前の値、getBoundingClientRect は掛けた後の値になることに注意
const BASE_GRID_WIDTH = 1832;
let scale = 1;
// 全体設定の「文字の大きさ」(PC ごと)。scale に掛ける。マスの大きさは変えないので、大きくすると中身が詰まる
let uiScale = 1;

applyI18n();
init();

async function init() {
  let data = await store.loadAll();
  if (!data.layouts.length) {
    // 初回起動
    const layout = DEFAULT_LAYOUT.map((item) => ({ id: newId(), ...item }));
    const configs = Object.fromEntries(layout.map((item) => [item.id, initialConfig(getWidget(item.type))]));
    await store.replaceAll({ name: t('layout_default_name'), layout, configs });
    data = await store.loadAll();
  }
  layouts = data.layouts;
  activeLid = await store.loadActiveLayout(layouts);
  prefs = data.layoutData[activeLid].prefs;

  grid = GridStack.init({
    column: COLUMNS,
    cellHeight: 'auto',         // 列の幅と同じ高さ(正方形)。ウィンドウのリサイズに追従する
    margin: prefs.margin,
    mode: 'float',              // 隙間を詰めず、置いた場所に留める
    staticGrid: true,           // 編集モード以外では動かさない
    handle: '.wg-overlay',
    alwaysShowResizeHandle: true,
    resizable: { handles: 'e,se,s,sw,w' },
    animate: true,
  }, '#grid');

  // 古い保存形式を移す(12 列 → 24 列、layout / prefs の 1 組 → レイアウト)
  const migrateGrid = data.gridVersion < store.CURRENT_GRID_VERSION;
  if (migrateGrid) {
    for (const d of Object.values(data.layoutData)) d.layout = migrateLayout(d.layout, d.prefs.cellHeight ?? store.LEGACY_CELL_HEIGHT);
  }
  if (data.legacy) {
    const { layout, prefs: p } = data.layoutData[store.MAIN_LAYOUT];
    await store.migrateLegacy({ name: t('layout_default_name'), layout, prefs: p });
    await photos.renameOwner('background', store.backgroundOwner(store.MAIN_LAYOUT)).catch((err) => console.error(err));
    layouts = [{ id: store.MAIN_LAYOUT, name: t('layout_default_name') }];
  } else if (migrateGrid) {
    for (const [lid, d] of Object.entries(data.layoutData)) await store.saveMigratedLayout(lid, d.layout);
  }
  uiScale = (Number((await store.loadDevicePrefs()).uiScale) || 100) / 100;
  applyPrefs(prefs);

  const layout = data.layoutData[activeLid].layout;
  lastLayoutJSON = JSON.stringify(layout);
  mountAll(() => {
    for (const item of layout) mountWidget(item, data.configs[item.id]);
  });
  updateEmpty();
  // 他の PC で削除されたウィジェット・レイアウトの写真を消す(写真はこの PC の IndexedDB にあるので、削除が同期されない)
  photos.prune([...layouts.map((l) => store.backgroundOwner(l.id)), ...data.widgets.map((w) => w.id)]).catch((err) => console.error(err));
  onBackgroundPhotoChange((lid) => {
    if (lid === activeLid) applyBackground(prefs, { lid });
  });

  grid.on('change', onGridChange);
  // この PC の別のタブで文字の大きさを変えた
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['device:uiScale']) setUiScale(changes['device:uiScale'].newValue);
  });
  checkForUpdate().then(showUpdateNotice).catch((err) => console.error(err));
  bindToolbar();
  bindKeyboard();
  store.onExternalChange({
    layouts: onRemoteLayouts,
    layout: (lid, layout) => { if (lid === activeLid) onRemoteLayout(layout); },
    prefs: (lid, p) => { if (lid === activeLid) onRemotePrefs(p); },
    config: onRemoteConfig,
    data: onDataChange,
    active: (lid) => switchLayout(lid, { remember: false }), // この PC の別のタブで切り替えた
  });

  // マスの大きさがウィンドウ幅(と拡大縮小)で変わるので、保存した配置に戻してから、
  // px で指定された最小の高さ(requireHeight)を計算し直す
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, 200);
  });
}

// 12 列・固定の行の高さ(gridVersion 1)のレイアウトを、24 列の正方形マスに変換する。
// 横は列数が倍なのでそのまま 2 倍、縦は見た目の高さ(px)がなるべく変わらないよう今のマスの大きさで換算する
function migrateLayout(layout, oldCellHeight) {
  const ratio = oldCellHeight / grid.getCellHeight(true);
  return layout.map((item) => ({
    ...item,
    x: item.x * 2,
    w: item.w * 2,
    y: Math.round(item.y * ratio),
    h: Math.max(1, Math.round(item.h * ratio)),
  }));
}

// ---------- ウィジェットのライフサイクル ----------

const newId = () => crypto.randomUUID().slice(0, 8);

function initialConfig(def) {
  return { ...COMMON_DEFAULTS, ...def?.defaults };
}

function fullConfig(def, stored) {
  return { ...initialConfig(def), ...stored };
}

function mountWidget(item, storedConfig) {
  const def = getWidget(item.type);
  const size = def?.size ?? { w: 3, h: 2 };
  const node = grid.addWidget({
    id: item.id,
    x: item.x, y: item.y,
    w: item.w ?? size.w, h: item.h ?? size.h,
    minW: size.minW, minH: size.minH, maxW: size.maxW, maxH: size.maxH,
    autoPosition: item.x == null || item.y == null,
  });
  const content = node.querySelector('.grid-stack-item-content');
  const body = el('div', { className: `wg-body wg-${item.type}` });
  const settingsBtn = el('button', { type: 'button', className: 'wg-btn', title: t('common_settings') }, icon('gear'));
  const removeBtn = el('button', { type: 'button', className: 'wg-btn', title: t('common_delete') }, icon('trash'));
  const overlay = el('div', { className: 'wg-overlay' },
    el('span', { className: 'wg-name', textContent: def?.name ?? item.type }),
    el('div', { className: 'wg-actions' }, def?.fields ? settingsBtn : null, removeBtn));
  content.append(body, overlay);

  const inst = { id: item.id, type: item.type, def, node, content, body, config: fullConfig(def, storedConfig), handle: null, dataWatchers: new Set() };
  // 保存する配置(自動で決まった位置も含む)。中身の高さで自動で伸びる前の値
  const { x, y, w, h } = node.gridstackNode;
  inst.saved = { x, y, w, h };
  instances.set(inst.id, inst);
  settingsBtn.addEventListener('click', () => openWidgetSettings(inst));
  removeBtn.addEventListener('click', () => removeWidget(inst));
  startWidget(inst);
  return inst;
}

function startWidget(inst) {
  inst.content.classList.toggle('noframe', !inst.config.frame);
  if (!inst.def) {
    inst.body.append(el('p', { className: 'wg-message', textContent: t('widget_unknown', { type: inst.type }) }));
    return;
  }
  const ctx = {
    id: inst.id,
    // ウィジェット自身による設定変更(再描画はしない)
    save: (patch) => {
      inst.config = { ...inst.config, ...patch };
      return store.saveConfig(inst.id, inst.config);
    },
    // 中身を表示するのに最低限必要な高さ(px、ウィジェット本体の内側)。これより小さくリサイズできなくなる
    requireHeight: (px) => {
      inst.minBodyHeight = px;
      applyMinSize(inst);
    },
    // 最小のマス数(グリッド単位)。null で解除
    setMinSize: (size) => {
      inst.minGridSize = size;
      applyMinSize(inst);
    },
    // 今のマス数とウィジェット同士の間隔(px)
    gridSize: () => {
      const { w, h } = inst.node.gridstackNode;
      return { w, h, margin: grid.getMargin() / scale }; // 中身の座標(scale を掛ける前)での間隔
    },
    // ウィジェットごとのデータ(chrome.storage.sync の data:<id>)。設定とは別に、中身の多いデータを置く。
    // subscribe には他のタブ・バックグラウンドでの変更も、自分の保存も届く(違いは呼び出し側で判断する)
    data: {
      load: () => store.loadData(inst.id),
      save: (value) => store.saveData(inst.id, value),
      key: store.dataKey(inst.id),
      subscribe: (fn) => {
        inst.dataWatchers.add(fn);
        return () => inst.dataWatchers.delete(fn);
      },
    },
  };
  try {
    inst.handle = inst.def.mount(inst.body, { ...inst.config }, ctx) ?? {};
  } catch (err) {
    console.error(err);
    inst.body.replaceChildren(el('p', { className: 'wg-message', textContent: t('widget_error', { message: err.message }) }));
  }
}

// 画面の大きさによらない最小サイズ(マス数): ウィジェット定義の最小サイズと setMinSize の大きい方
function fixedMinSize(inst) {
  return {
    minW: Math.max(inst.def?.size.minW ?? 1, inst.minGridSize?.w ?? 1),
    minH: Math.max(inst.def?.size.minH ?? 1, inst.minGridSize?.h ?? 1),
  };
}

// fixedMinSize と requireHeight(px を行数に換算)のうち大きい方を minW / minH にする。
// 今のサイズが足りなければ gridstack が自動で広げる。これは画面の大きさ(マスの大きさ)で変わる表示だけの調整なので、
// 保存しない(拡大縮小やウィンドウの幅を戻すと、relayout で保存した配置に戻る)
function applyMinSize(inst) {
  let { minW, minH } = fixedMinSize(inst);
  if (inst.minBodyHeight > 0) {
    // requireHeight の px は中身の座標(scale を掛ける前)なので、グリッドの座標に直す
    const frame = inst.content.offsetHeight - inst.body.offsetHeight * scale; // カードの枠線など
    const px = inst.minBodyHeight * scale + frame + 2 * grid.getMargin();
    minH = Math.max(minH, Math.ceil(px / grid.getCellHeight(true)));
  }
  const node = inst.node.gridstackNode;
  if (node.minW === minW && node.minH === minH) return;
  adjust(() => grid.update(inst.node, { minW, minH }));
  // 最小の高さが下がって、自動で伸びた分が要らなくなったら、保存した配置に戻す(押し下げたほかのウィジェットも戻すため、全体で)
  if (node.w > Math.max(inst.saved.w, minW) || node.h > Math.max(inst.saved.h, minH)) scheduleRelayout();
}

let relayoutTimer;
function scheduleRelayout() {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(relayout, 50);
}

// 表示だけの調整(保存しない)。この間の gridstack の change は、自分で動かした変更として扱わない
let adjusting = 0;
function adjust(fn) {
  adjusting++;
  try {
    fn();
  } finally {
    adjusting--;
  }
}

// 保存した配置に戻してから、今のマスの大きさで最小サイズを当て直す
function relayout() {
  adjust(() => {
    updateScale();
    grid.batchUpdate();
    try {
      const list = [...instances.values()];
      // 先に大きさを戻してから、上から順に位置を戻す(伸びたウィジェットに押し下げられた位置から、ぶつからずに戻すため)
      for (const inst of list) grid.update(inst.node, { w: inst.saved.w, h: inst.saved.h, ...fixedMinSize(inst) });
      for (const inst of list.sort((a, b) => a.saved.y - b.saved.y)) grid.update(inst.node, { x: inst.saved.x, y: inst.saved.y });
      for (const inst of list) applyMinSize(inst);
    } finally {
      grid.batchUpdate(false);
    }
  });
}

function stopWidget(inst) {
  try {
    inst.handle?.unmount?.();
  } catch (err) {
    console.error(err);
  }
  inst.handle = null;
  inst.dataWatchers.clear();
  inst.body.replaceChildren();
}

function applyConfig(inst, config) {
  inst.config = config;
  inst.content.classList.toggle('noframe', !config.frame);
  if (inst.handle?.update) {
    inst.handle.update({ ...config });
  } else {
    stopWidget(inst);
    startWidget(inst);
  }
}

function destroyWidget(inst) {
  stopWidget(inst);
  grid.removeWidget(inst.node);
  instances.delete(inst.id);
}

// ---------- 操作 ----------

async function addWidget() {
  // ほかのレイアウトにだけ置かれているウィジェットも、ここに置ける(中身は共有)。中身を持つもの(shareable)だけ
  const data = await store.loadAll();
  const shared = data.widgets.filter((w) => !instances.has(w.id) && getWidget(w.type)?.shareable).map((w) => ({
    ...w,
    label: data.configs[w.id]?.title || getWidget(w.type).name,
    where: layoutsUsing(data, w.id).map((l) => l.name).join(t('list_separator')),
  }));
  const picked = await pickWidget(WIDGETS, shared);
  if (!picked) return;
  let inst;
  if (picked.shared) {
    inst = mountWidget({ id: picked.shared.id, type: picked.shared.type }, data.configs[picked.shared.id]);
  } else {
    const id = newId();
    const config = initialConfig(picked.def);
    await store.saveConfig(id, config);
    inst = mountWidget({ id, type: picked.def.type }, config);
  }
  saveLayout();
  updateEmpty();
  inst.node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// lid 以外のレイアウトのうち、ウィジェット id を置いているもの
const layoutsUsing = (data, id, except = null) =>
  data.layouts.filter((l) => l.id !== except && data.layoutData[l.id]?.layout.some((w) => w.id === id));

// このレイアウトから外す。ほかのレイアウトにも無ければ、設定と中身も消す
async function removeWidget(inst) {
  const name = inst.def?.name ?? inst.type;
  const elsewhere = layoutsUsing(await store.loadAll(), inst.id, activeLid);
  const message = elsewhere.length
    ? t('widget_confirm_remove_shared', { name, layouts: elsewhere.map((l) => l.name).join(t('list_separator')) })
    : t('widget_confirm_delete', { name });
  if (!confirm(message)) return;
  destroyWidget(inst);
  saveLayout();
  if (!elsewhere.length) forgetWidget(inst.id, inst.type);
  updateEmpty();
}

// どのレイアウトにも置かれなくなったウィジェットの設定と中身を消す
function forgetWidget(id, type) {
  store.removeConfig(id);
  store.removeData(id);
  getWidget(type)?.removed?.(id);
}

async function openWidgetSettings(inst) {
  const fields = typeof inst.def.fields === 'function' ? inst.def.fields(inst.config) : inst.def.fields;
  const values = await editSettings({
    title: t('widget_settings_title', { name: inst.def.name }),
    fields: [...fields, ...COMMON_FIELDS],
    values: inst.config,
  });
  if (!values) return;
  applyConfig(inst, { ...inst.config, ...values });
  store.saveConfig(inst.id, inst.config); // 反映中にウィジェット自身が ctx.save で書き換えた分も含める
}

async function openPrefs() {
  // device: true の項目は PC ごとの設定(同期しない)なので、保存先を分ける
  const device = await store.loadDevicePrefs();
  // 背景は保存する前から画面で試せるようにする(キャンセルしたら戻す)
  const preview = (v) => {
    const next = { ...prefs, ...v, widgetOpacity: Number(v.widgetOpacity) };
    applyTheme(next);
    applyBackground(next, { lid: activeLid, pending: v.bgImage });
    setUiScale(v.uiScale);
  };
  const values = await editSettings({ title: t('toolbar_prefs'), fields: PREF_FIELDS, values: { ...prefs, ...device }, onInput: preview });
  delete values?.about;
  if (!values) {
    applyTheme(prefs);
    applyBackground(prefs, { lid: activeLid });
    setUiScale(device.uiScale);
    return;
  }
  values.uiScale = Number(values.uiScale);
  setUiScale(values.uiScale);
  // 選んだ背景の画像は IndexedDB に置く(全体設定には入れない)
  const { bgImage } = values;
  delete values.bgImage;
  if (bgImage) {
    try {
      await saveBackgroundPhoto(activeLid, bgImage);
    } catch (err) {
      console.error(err);
      alert(t('bg_image_failed'));
    }
  }
  const deviceValues = Object.fromEntries(DEVICE_KEYS.map((key) => [key, values[key]]));
  for (const key of DEVICE_KEYS) delete values[key];
  prefs = { ...prefs, ...values };
  applyPrefs(prefs);
  store.savePrefs(activeLid, prefs);
  store.saveDevicePrefs(deviceValues);
}

function applyPrefs(p) {
  applyTheme(p);
  applyBackground(p, { lid: activeLid });
  updateScale(p);
  for (const inst of instances.values()) applyMinSize(inst); // 間隔が変わると必要な行数も変わる
}

// 今のグリッドの幅から scale を決め、中身に掛ける(文字の大きさの設定も掛ける)。ウィジェット同士の間隔はグリッドの幅の比だけ
function updateScale(p = prefs) {
  const width = grid.el.clientWidth;
  if (!width) return;
  const gridScale = width / BASE_GRID_WIDTH;
  scale = gridScale * uiScale;
  grid.el.style.setProperty('--wg-scale', scale);
  const margin = Math.round(p.margin * gridScale * 100) / 100;
  if (grid.getMargin() !== margin) grid.margin(margin);
}

// 文字の大きさを変える(全体設定・他のタブ)。必要な高さが変わるので、保存した配置から当て直す
function setUiScale(percent) {
  const next = (Number(percent) || 100) / 100;
  if (next === uiScale) return;
  uiScale = next;
  relayout();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  grid.setStatic(!on);
  const toggle = $('#toggle-edit');
  toggle.replaceChildren(icon(on ? 'check' : 'edit'), el('span', { textContent: on ? t('toolbar_done') : '' }));
  toggle.title = on ? t('toolbar_done_title') : t('toolbar_edit_title');
}

function updateEmpty() {
  $('#empty').hidden = instances.size > 0;
}

// ---------- 保存 ----------

function serializeLayout() {
  return [...instances.values()]
    .map(({ id, type, saved: { x, y, w, h } }) => ({ id, type, x, y, w, h }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

// 自分で動かした(ドラッグ・リサイズ・追加)ときに、今の配置を保存する配置にする。
// ただし中身の高さ(requireHeight)で自動で伸びて、その最小の高さに張り付いているウィジェットは、伸びる前の高さのままにする
function captureSaved() {
  for (const inst of instances.values()) {
    const node = inst.node.gridstackNode;
    const { minH } = fixedMinSize(inst);
    const stretched = node.minH > minH && node.h === node.minH && inst.saved.h < node.h;
    inst.saved = { x: node.x, y: node.y, w: node.w, h: stretched ? Math.max(inst.saved.h, minH) : node.h };
  }
}

function onGridChange() {
  if (mounting || adjusting) return;
  captureSaved();
  saveLayout();
}

// ウィジェットをまとめて配置している間は保存しない。途中で(最小サイズの補正などから)保存すると、
// まだ配置していないウィジェットが抜けたレイアウトが保存され、他のタブや自分自身で消えてしまうため
let mounting = false;
function mountAll(fn) {
  mounting = true;
  grid.batchUpdate();
  try {
    fn();
  } finally {
    grid.batchUpdate(false);
    mounting = false;
  }
  saveLayout(); // 定義の最小サイズなどで補正された場合は、補正後の値を保存する
}

function saveLayout() {
  if (mounting) return;
  const layout = serializeLayout();
  const json = JSON.stringify(layout);
  if (json === lastLayoutJSON) return;
  lastLayoutJSON = json;
  store.saveLayout(activeLid, layout);
}

async function exportSettings() {
  const { layouts: list, layoutData, configs, data } = await store.loadAll();
  const memos = await store.listMemos(); // メモは同期しないので、バックアップとして書き出しに含める
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJSON(`newtab-${stamp}.json`, { app: 'newtab-dashboard', version: 3, gridVersion: store.CURRENT_GRID_VERSION, layouts: list, layoutData, configs, data, memos });
}

async function importSettings() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    // version 3 からはレイアウトが複数。それより前のファイルは layout / prefs の 1 組
    if (!Array.isArray(data.layouts) && !Array.isArray(data.layout)) throw new Error(t('import_no_layout'));
    if (!confirm(t('import_confirm'))) return;
    // version 1 の書き出しファイルは 12 列のレイアウトなので、次の起動時に変換させる
    await store.replaceAll({ name: t('layout_default_name'), ...data, gridVersion: data.gridVersion ?? (data.version >= 2 ? 2 : 1) });
    location.reload();
  } catch (err) {
    alert(t('import_failed', { message: err.message }));
  }
}

// ---------- 他のタブでの変更を反映 ----------

async function onRemoteLayout(layout, configs = null) {
  const json = JSON.stringify(layout);
  if (json === lastLayoutJSON) return; // 自分の書き込み
  lastLayoutJSON = json;

  const ids = new Set(layout.map((i) => i.id));
  const added = layout.filter((i) => !instances.has(i.id));
  if (added.length) configs ??= (await store.loadAll()).configs;

  mountAll(() => {
    for (const inst of [...instances.values()]) if (!ids.has(inst.id)) destroyWidget(inst);
    // 残すウィジェットを先に動かしてから、新しいウィジェットを置く。逆だと、まだ前の位置にいるウィジェットと重なって
    // 押し出され、保存された配置とずれる(ずれた配置を保存すると、他のタブとの間で書き換え合いが続く)
    for (const item of layout) instances.get(item.id) && grid.update(instances.get(item.id).node, { x: item.x, y: item.y, w: item.w, h: item.h });
    for (const item of layout) if (!instances.has(item.id)) mountWidget(item, configs[item.id]);
    for (const item of layout) {
      const inst = instances.get(item.id);
      const { minW, minH } = fixedMinSize(inst);
      inst.saved = { x: item.x, y: item.y, w: Math.max(item.w, minW), h: Math.max(item.h, minH) };
    }
  });
  updateEmpty();
}

// レイアウトの一覧が変わった(他のタブ・PC で追加・削除・名前の変更)
function onRemoteLayouts(list) {
  if (!list.length) return;
  layouts = list;
  if (!layouts.some((l) => l.id === activeLid)) switchLayout(layouts[0].id);
  renderLayoutSelect();
}

// 表示するレイアウトを切り替える。同じウィジェットが両方にあれば、作り直さずに位置だけ変える
// remember: この PC で次に開くときもこのレイアウトにする(別のタブで切り替えたのを受けたときは書かない)
async function switchLayout(lid, { remember = true } = {}) {
  if (lid === activeLid) return;
  const data = await store.loadAll();
  if (!data.layoutData[lid] || lid === activeLid) return;
  // ここから並べ替えが終わるまで await しない(途中で前のレイアウトのウィジェットを、新しいレイアウトとして保存しないように)
  activeLid = lid;
  layouts = data.layouts;
  if (remember) store.saveActiveLayout(lid);
  onRemoteLayout(data.layoutData[lid].layout, data.configs);
  // 間隔などは並べ替えた後に反映する(最小サイズの補正で保存するのは、新しいレイアウトのウィジェットにする)
  prefs = data.layoutData[lid].prefs;
  applyPrefs(prefs);
  renderLayoutSelect();
}

function onRemoteConfig(id, stored) {
  const inst = instances.get(id);
  if (!inst || !stored) return;
  const config = fullConfig(inst.def, stored);
  if (JSON.stringify(config) === JSON.stringify(inst.config)) return;
  applyConfig(inst, config);
}

function onDataChange(id, value) {
  const inst = instances.get(id);
  if (!inst) return;
  for (const fn of inst.dataWatchers) {
    try {
      fn(value);
    } catch (err) {
      console.error(err);
    }
  }
}

function onRemotePrefs(p) {
  if (JSON.stringify(p) === JSON.stringify(prefs)) return;
  prefs = p;
  applyPrefs(p);
}

// ---------- ツールバー・キーボード ----------

// ---------- レイアウトの切り替え・管理 ----------

// ツールバーの「レイアウト」: 表示中のレイアウト名と、切り替え・管理のメニュー
function renderLayoutSelect() {
  $('#layout-current').textContent = layouts.find((l) => l.id === activeLid)?.name ?? '';
  const menu = $('#layout-menu');
  const items = layouts.map((l) => {
    const b = el('button', { type: 'button', className: 'tb-menu-item layout-opt', role: 'menuitemradio' },
      el('span', { className: 'tb-menu-name', textContent: l.name }),
      l.id === activeLid ? icon('check') : null);
    b.setAttribute('aria-checked', String(l.id === activeLid));
    b.dataset.id = l.id;
    b.addEventListener('click', () => {
      menu.hidePopover();
      switchLayout(l.id);
    });
    return b;
  });
  const manage = el('button', { type: 'button', className: 'tb-menu-item layout-manage', role: 'menuitem' },
    icon('gear'), el('span', { className: 'tb-menu-name', textContent: t('layouts_manage') }));
  manage.addEventListener('click', () => {
    menu.hidePopover();
    openLayouts();
  });
  menu.replaceChildren(...items, el('hr', { className: 'tb-menu-sep' }), manage);
}

async function openLayouts() {
  const values = await editSettings({
    title: t('layouts_title'),
    fields: [{ key: 'layouts', label: t('layouts_list'), type: 'custom', hint: t('layouts_hint'), create: () => layoutListField(layouts, activeLid) }],
    values: {},
  });
  if (!values) return;
  const data = await store.loadAll();
  const next = [];
  for (const row of values.layouts) {
    if (!row.from) {
      next.push({ id: row.id, name: row.name });
      continue;
    }
    // 新しく作ったもの: 空のレイアウトは今の見た目を引き継ぐ。複製はウィジェットの配置(共有)と見た目、背景の画像も写す
    const id = newId();
    const source = row.from.startsWith('copy:') ? data.layoutData[row.from.slice(5)] : null;
    await store.saveLayoutData(id, source ?? { layout: [], prefs });
    if (source) await photos.copyOwner(store.backgroundOwner(row.from.slice(5)), store.backgroundOwner(id)).catch((err) => console.error(err));
    next.push({ id, name: row.name });
  }
  // 消したレイアウト。そこにだけ置いていたウィジェットは、設定と中身も消す
  const removed = data.layouts.filter((l) => !next.some((n) => n.id === l.id));
  for (const l of removed) {
    for (const w of data.layoutData[l.id].layout) {
      if (!next.some((n) => data.layoutData[n.id]?.layout.some((x) => x.id === w.id))) forgetWidget(w.id, w.type);
    }
    await store.removeLayoutData(l.id);
    photos.removeOwner(store.backgroundOwner(l.id)).catch((err) => console.error(err));
  }
  layouts = next;
  await store.saveLayoutList(next);
  if (!next.some((l) => l.id === activeLid)) await switchLayout(next[0].id);
  renderLayoutSelect();
}

// ---------- 更新 ----------

// 新しいバージョンがあれば、ツールバーで知らせる(「このバージョンは知らせない」を選んだものは出さない)
function showUpdateNotice(result) {
  const notice = $('#update-notice');
  notice.hidden = !result.available || result.dismissed;
  if (notice.hidden) return;
  notice.replaceChildren(icon('download'), el('span', { textContent: t('update_available', { version: result.latest }) }));
  notice.onclick = () => openUpdateDialog(result);
  helperCheck ??= helperAvailable(); // ダイアログを開く前に確かめておく(ヘルパーの起動に少しかかる)
}

// 更新ヘルパーが使えるか(確かめている途中なら Promise)。使えなかったときは、次に開くときに確かめ直す
let helperCheck = null;

async function openUpdateDialog(result) {
  const helper = await (helperCheck ??= helperAvailable());
  if (!helper) helperCheck = null;
  const link = (text, href) => el('a', { className: 'btn', href, target: '_blank', rel: 'noopener', textContent: text });
  const reload = el('button', { type: 'button', className: 'btn primary', textContent: t('update_reload') });
  reload.addEventListener('click', reloadExtension);
  const dismiss = el('button', { type: 'button', className: 'btn', textContent: t('update_dismiss') });
  const close = el('button', { type: 'button', className: 'btn', textContent: t('common_close') });
  // ヘルパーがあれば「今すぐ更新」。手動で入れ替える手順は、たたんでおく(失敗したら開く)
  const status = el('p', { className: 'update-status', role: 'status' });
  const updateNow = el('button', { type: 'button', className: 'btn primary update-now', textContent: t('update_now') });
  const manual = el('details', { className: 'update-manual', open: !helper },
    el('summary', { textContent: t('update_manual') }),
    el('ol', { className: 'update-steps' },
      el('li', {}, el('span', { textContent: t('update_step_files') }),
        el('div', { className: 'update-links' }, link(t('update_download_zip'), ZIP_URL), link(t('update_open_repo'), REPO_URL))),
      el('li', {}, el('span', { textContent: t('update_step_reload') }), el('div', { className: 'update-links' }, reload))),
    helper ? null : el('p', { className: 'hint update-helper-hint', textContent: t('update_helper_hint') }));
  const form = el('form', { method: 'dialog', className: 'update-dialog' },
    el('h2', { textContent: t('update_title') }),
    el('p', { className: 'update-versions', textContent: t('update_versions', { current: result.current, latest: result.latest }) }),
    helper ? el('div', { className: 'update-auto' }, updateNow, status) : null,
    manual,
    el('div', { className: 'actions' }, dismiss, close));
  updateNow.addEventListener('click', async () => {
    updateNow.disabled = true;
    status.textContent = t('update_updating');
    try {
      const version = await updateWithHelper();
      status.textContent = t('update_done', { version });
      setTimeout(reloadExtension, 800); // 終わったことを見せてから読み込み直す
    } catch (err) {
      console.warn('更新ヘルパーで更新できませんでした', err);
      status.textContent = t('update_auto_failed', { error: err.message });
      updateNow.disabled = false;
      manual.open = true;
    }
  });
  const dlg = showDialog(form);
  close.addEventListener('click', () => dlg.close());
  dismiss.addEventListener('click', async () => {
    await dismissUpdate(result.latest);
    $('#update-notice').hidden = true;
    dlg.close();
  });
}

// 全体設定の「バージョン」: 今のバージョン、更新の確認、再読み込み
function aboutField() {
  const status = el('span', { className: 'about-status' });
  const check = el('button', { type: 'button', className: 'btn about-check', textContent: t('update_check') });
  const reload = el('button', { type: 'button', className: 'btn about-reload', textContent: t('update_reload'), title: t('update_reload_hint') });
  check.addEventListener('click', async () => {
    check.disabled = true;
    status.textContent = t('update_checking');
    const result = await checkForUpdate({ force: true });
    check.disabled = false;
    status.textContent = result.error ?? (result.available ? t('update_found', { version: result.latest }) : t('update_latest'));
    showUpdateNotice({ ...result, dismissed: false });
  });
  reload.addEventListener('click', reloadExtension);
  const node = el('div', { className: 'about' },
    el('span', { className: 'about-version', textContent: t('update_current', { version: chrome.runtime.getManifest().version }) }),
    check, reload, status,
    el('a', { className: 'about-feedback', href: FEEDBACK_URL, target: '_blank', rel: 'noopener', textContent: t('feedback_report') }));
  return { node, read: () => null };
}

function bindToolbar() {
  $('#toggle-edit').addEventListener('click', () => setEditing(!editing));
  // メニューはボタンの下に、画面からはみ出さないように出す
  const layoutButton = $('#layout-menu-button');
  const layoutMenu = $('#layout-menu');
  layoutButton.popoverTargetElement = layoutMenu;
  layoutMenu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return;
    const r = layoutButton.getBoundingClientRect();
    layoutMenu.style.top = `${r.bottom + 6}px`;
    layoutMenu.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 240))}px`;
  });
  renderLayoutSelect();
  $('#add-widget').addEventListener('click', addWidget);
  $('#open-prefs').addEventListener('click', openPrefs);
  $('#export').addEventListener('click', exportSettings);
  $('#import').addEventListener('click', importSettings);
  for (const [id, name] of [['add-widget', 'plus'], ['layout-menu-button', 'columns'], ['open-prefs', 'sliders'], ['export', 'download'], ['import', 'upload']]) {
    $(`#${id}`).prepend(icon(name));
  }
  setEditing(false);
}

function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    const typing = active?.matches('input, textarea, select, [contenteditable="true"], .piano');
    if (e.key === '/' && !typing) {
      const input = document.querySelector('.search-input');
      if (input) {
        e.preventDefault();
        input.focus();
        input.select();
      }
    } else if (e.key === 'Escape' && editing) {
      setEditing(false);
    }
  });
}
