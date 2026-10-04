// ToDo の計算: 繰り返しの次回・期限の表示・並び順
// 画面(js/widgets/todo.js)で使う。日付と繰り返しの計算は js/repeat-core.js(リマインダーと共有)。
// DOM や chrome.* は使わない(Node で単体テストできるように)。仕様は docs/todo-spec.md
//
// ToDo 1 件:
// {
//   id, text,
//   due: null | 'YYYY-MM-DD' | 'YYYY-MM-DDTHH:MM'   その PC の時計(ローカル時刻)で解釈する
//   repeat: null | 繰り返しのルール(js/repeat-core.js)
//   done: 0 | 完了時刻(ms)
// }
// 通知は無い(リマインダーに集約した)。以前のデータに残っている remind / snooze は使わない

import { dateKey, parseDate, addDays, startOfDay, splitDue, joinDue, dueAt, firstMatch } from './repeat-core.js';
import { t } from './i18n.js';

export { dateKey, parseDate, splitDue, joinDue, dueAt, dueLabel, repeatLabel } from './repeat-core.js';

// リストの設定(ウィジェットの設定 cfg:<id>)の初期値
export const LIST_DEFAULTS = {
  title: t('todo_name'),
  sort: 'manual',     // manual | due
  hideDone: false,
};

export const MAX_ITEMS = 50;
export const MAX_BYTES = 7800; // chrome.storage.sync は 1 項目 8KB まで(キー名を含む)

// 繰り返しの次回の期限。今の期限より後で、かつ今日以降の最初の回(溜まった分は飛ばす)。
// 終了日を過ぎるなら null
export function nextDue(item, now = Date.now()) {
  const rule = item.repeat;
  if (!rule || !item.due) return null;
  const { date, time } = splitDue(item.due);
  const tomorrow = addDays(parseDate(date), 1);
  const today = startOfDay(now);
  const d = firstMatch(rule, tomorrow > today ? tomorrow : today);
  return d ? joinDue(dateKey(d), time) : null;
}

// 完了にする。繰り返しなら期限が次回に進む(完了にはならない)。次回が無ければ完了
export function complete(item, now = Date.now()) {
  const next = nextDue(item, now);
  if (next) return { ...item, due: next, done: 0 };
  return { ...item, done: now };
}

// 期限切れか。日付だけの期限は、その日が終わるまでは期限切れにしない
export function isOverdue(item, now = Date.now()) {
  if (item.done || !item.due) return false;
  const { date, time } = splitDue(item.due);
  return time ? dueAt(item.due) <= now : parseDate(date) < startOfDay(now);
}

// 表示順。未完了が先、完了済みは後(新しく完了したものが上)。
// sort: 'manual' は保存順、'due' は期限が近い順(期限なしは最後)
export function sortItems(items, sort) {
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done).sort((a, b) => b.done - a.done);
  if (sort === 'due') {
    const key = (i) => (i.due ? dueAt(i.due) : Infinity); // 日付だけの期限はその日の 0:00 として並べる
    open.sort((a, b) => key(a) - key(b)); // sort は安定なので、同じ期限なら保存順
  }
  return [...open, ...done];
}

// 保存したときの大きさ(バイト)。chrome.storage.sync の 1 項目の上限を超えないか確かめる
export const storedSize = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;
