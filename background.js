// バックグラウンド(Service Worker)。新規タブを開いていなくてもリマインダーとタイマーの通知を出す
//
// - リマインダー(data:<id>)や設定が変わったら(他の PC からの同期も含む)、次の通知の時刻に chrome.alarms を登録し直す
// - アラームが来たら chrome.notifications で通知する。ボタンは「◯分後に再通知」と、繰り返しなら「今後は通知しない」(一時停止)。
//   繰り返しは次の回を登録する
// - Chrome を閉じていた間に過ぎた分は、起動時にまとめて 1 件の通知にする

import * as store from './js/store.js';
import { REMINDER_DEFAULTS, notifyTimes, missed } from './js/reminder-core.js';
import { repeatLabel } from './js/repeat-core.js';
import * as timer from './js/timer-core.js';
import { t } from './js/i18n.js';

const ALARM_PREFIX = 'rem|';        // アラーム名: rem|<ウィジェット ID>|<リマインダー ID>|<at | snooze>
const NOTIFICATION_PREFIX = 'rem|'; // 通知 ID: rem|<ウィジェット ID>|<リマインダー ID>
const SUMMARY_ID = 'rem-summary';
const LAST_CHECK = 'rem:lastCheck'; // 最後に通知を確認した時刻(chrome.storage.local)
const LATE = 2 * 60 * 1000;         // これより遅れて来たアラームは、Chrome を閉じていた間の分とみなす
const ICON = 'icons/icon-128.png';

// どれかのレイアウトに置かれているリマインダー(表示していないレイアウトのものも通知する)
async function loadLists() {
  const { widgets, configs, data } = await store.loadAll();
  return widgets.filter((w) => w.type === 'reminder').map((w) => ({
    id: w.id,
    cfg: { ...REMINDER_DEFAULTS, ...configs[w.id] },
    items: data[w.id]?.items ?? [],
  }));
}

async function findItem(listId, itemId) {
  const list = (await loadLists()).find((l) => l.id === listId);
  return { list, item: list?.items.find((i) => i.id === itemId) };
}

// 同時に走ると二重に通知しかねない処理は、順番に実行する
let chain = Promise.resolve();
const serial = (fn) => {
  chain = chain.then(fn, fn);
  return chain;
};

// ---------- アラーム ----------

// after より後の通知の時刻を登録する。アラームが来た直後は、その時刻を after にして同じ回を登録し直さないようにする
async function reschedule(after = Date.now()) {
  const want = new Map();
  for (const list of await loadLists()) {
    for (const item of list.items) {
      for (const t of notifyTimes(item, after)) want.set(`${ALARM_PREFIX}${list.id}|${item.id}|${t.kind}`, t.at);
    }
  }
  const existing = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith(ALARM_PREFIX));
  for (const a of existing) {
    if (want.get(a.name) !== a.scheduledTime) await chrome.alarms.clear(a.name);
  }
  for (const [name, when] of want) {
    if (!existing.some((a) => a.name === name && a.scheduledTime === when)) await chrome.alarms.create(name, { when });
  }
}

// 削除・一時停止されたリマインダーの通知が出ていたら消す(他の PC で変更した場合など)
async function clearStaleNotifications() {
  const shown = Object.keys(await chrome.notifications.getAll()).filter((id) => id.startsWith(NOTIFICATION_PREFIX));
  if (!shown.length) return;
  const lists = await loadLists();
  for (const id of shown) {
    const [, listId, itemId] = id.split('|');
    const item = lists.find((l) => l.id === listId)?.items.find((i) => i.id === itemId);
    if (!item || item.paused) chrome.notifications.clear(id);
  }
}

// ToDo に通知があったころのアラームと記録を片付ける。「この PC で ToDo の通知を出す」はリマインダーの設定に引き継ぐ
async function cleanupTodoNotifications() {
  for (const a of await chrome.alarms.getAll()) {
    if (a.name.startsWith('todo|')) await chrome.alarms.clear(a.name);
  }
  const old = await chrome.storage.local.get(['device:todoNotify', 'device:reminderNotify']);
  if (old['device:todoNotify'] !== undefined && old['device:reminderNotify'] === undefined) {
    await chrome.storage.local.set({ 'device:reminderNotify': old['device:todoNotify'] });
  }
  await chrome.storage.local.remove(['todo:lastCheck', 'device:todoNotify']);
}

// ---------- 通知 ----------

const notificationsOn = async () => (await store.loadDevicePrefs()).reminderNotify;

const timeText = (ms) => new Date(ms).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });

function showItem(list, item, when = Date.now()) {
  return chrome.notifications.create(`${NOTIFICATION_PREFIX}${list.id}|${item.id}`, {
    type: 'basic',
    iconUrl: ICON,
    title: item.text,
    message: item.repeat ? `${timeText(when)}(${repeatLabel(item.repeat)})` : timeText(when),
    contextMessage: list.cfg.title,
    buttons: [{ title: t('reminder_notify_snooze', { n: list.cfg.snooze }) }, ...(item.repeat ? [{ title: t('reminder_notify_stop') }] : [])],
    priority: 2,
    requireInteraction: true, // 閉じるまで残す
  });
}

// アラームの時刻(when)が今もそのリマインダーの通知の時刻なら通知する(その間に編集・一時停止されていれば出さない)
async function notifyItem(listId, itemId, when = Date.now()) {
  await chrome.storage.local.set({ [LAST_CHECK]: Date.now() });
  if (!(await notificationsOn())) return;
  const { list, item } = await findItem(listId, itemId);
  if (!item || !notifyTimes(item, when - 1).some((t) => t.at === when)) return;
  await showItem(list, item, when);
}

// 前回の確認から今までに通知するはずだったリマインダーをまとめて通知する(Chrome を閉じていた間の分)
async function checkMissed() {
  const now = Date.now();
  const { [LAST_CHECK]: last } = await chrome.storage.local.get(LAST_CHECK);
  await chrome.storage.local.set({ [LAST_CHECK]: now });
  if (!last || !(await notificationsOn())) return; // 初回(インストール直後)は過去の分を通知しない

  const found = [];
  for (const list of await loadLists()) {
    for (const item of list.items) {
      if (missed(item, last, now)) found.push({ list, item });
    }
  }
  if (found.length === 1) {
    await showItem(found[0].list, found[0].item);
  } else if (found.length > 1) {
    await chrome.notifications.create(SUMMARY_ID, {
      type: 'basic',
      iconUrl: ICON,
      title: t('reminder_missed', { n: found.length }),
      message: found.slice(0, 3).map(({ item }) => t('reminder_missed_item', { text: item.text })).join('\n') + (found.length > 3 ? '\n…' : ''),
      priority: 2,
      requireInteraction: true,
    });
  }
}

async function onButton(notificationId, index) {
  if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
  const [, listId, itemId] = notificationId.split('|');
  const { list } = await findItem(listId, itemId);
  if (list) {
    // 0: 再通知、1: 今後は通知しない(一時停止。ウィジェットのベルで再開できる)
    const patch = index === 0 ? { snooze: Date.now() + Number(list.cfg.snooze) * 60_000 } : { paused: true, snooze: 0 };
    const value = (await store.loadData(listId)) ?? { items: [] };
    await store.saveData(listId, { ...value, items: value.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) });
  }
  await chrome.notifications.clear(notificationId);
}

// ---------- イベント ----------

chrome.alarms.onAlarm.addListener((alarm) => {
  // タイマー(ポモドーロ / カウントダウン)の終了。新規タブが先に処理していれば何もしない
  if (alarm.name.startsWith(timer.ALARM_PREFIX)) {
    const [, id, mode] = alarm.name.split('|');
    timer.completeTimer(id, mode);
    return;
  }
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const [, listId, itemId] = alarm.name.split('|');
  // Chrome を閉じていた間に過ぎたアラームは、起動時にまとめて来る。1 件ずつ通知せず、まとめて 1 件にする
  if (Date.now() - alarm.scheduledTime > LATE) serial(checkMissed);
  else serial(() => notifyItem(listId, itemId, alarm.scheduledTime));
  // 繰り返しの次の回を登録する
  serial(() => reschedule(Math.max(Date.now(), alarm.scheduledTime)));
});

chrome.notifications.onButtonClicked.addListener((id, index) => {
  if (id.startsWith(timer.ALARM_PREFIX)) {
    timer.startFromNotification(id).then(() => chrome.notifications.clear(id));
    return;
  }
  onButton(id, index);
});

chrome.notifications.onClicked.addListener((id) => {
  if (!id.startsWith(NOTIFICATION_PREFIX) && !id.startsWith(timer.ALARM_PREFIX) && id !== SUMMARY_ID) return;
  chrome.tabs.create({}); // 新しいタブ(このダッシュボード)を開く
  chrome.notifications.clear(id);
});

let rescheduleTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (!Object.keys(changes).some((k) => k === 'layouts' || k === 'layout' || k.startsWith('layout:') || k.startsWith('cfg:') || k.startsWith('data:'))) return;
  clearTimeout(rescheduleTimer);
  rescheduleTimer = setTimeout(() => {
    reschedule();
    clearStaleNotifications();
  }, 300);
});

chrome.runtime.onStartup.addListener(() => serial(checkMissed).then(() => reschedule()));
chrome.runtime.onInstalled.addListener(() => serial(cleanupTodoNotifications).then(checkMissed).then(() => reschedule()));

// テストから呼べるようにしておく
globalThis.reminderBackground = { reschedule, checkMissed, notifyItem, onButton };
globalThis.timerBackground = { completeTimer: timer.completeTimer, startFromNotification: timer.startFromNotification };
