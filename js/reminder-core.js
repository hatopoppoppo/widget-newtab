// リマインダーの計算: 次に通知する時刻・終わったか・並び順
// 画面(js/widgets/reminder.js)とバックグラウンド(background.js)で共有する。
// 日付と繰り返しの計算は js/repeat-core.js(ToDo と共有)。DOM や chrome.* は使わない(Node で単体テストできるように)
//
// リマインダー 1 件:
// {
//   id, text,
//   at: 'YYYY-MM-DDTHH:MM'   1 回目の日時(その PC の時計で解釈する)。繰り返しなら、この日以降で当たる日のこの時刻
//   repeat: null | 繰り返しのルール(js/repeat-core.js。anchor は at の日付。間隔・終了日は使わない)
//   paused: false            一時停止中(通知しない)
//   snooze: 0 | 再通知の時刻(ms)
// }
// 繰り返しでも at は書き換えない(時刻が来るたびに保存し直すと、PC ごとの通知と食い違うため)。次回は毎回計算する

import {
  parseDate, addDays, startOfDay, splitDue, dueAt, firstMatch, dateKey, repeatLabel, FREQ_OPTIONS, WEEKDAY_OPTIONS,
  nthWeekdayFields, nthWeekdayValues, readNthWeekday,
} from './repeat-core.js';
import { t, weekdayNames } from './i18n.js';

// ウィジェットの設定(cfg:<id>)の初期値。バックグラウンドでも使う
export const REMINDER_DEFAULTS = {
  title: t('reminder_name'),
  snooze: '10',       // 再通知までの分
  hideEnded: false,   // 終わったもの(1 回だけで時刻を過ぎたもの)を隠す
};

export const MAX_ITEMS = 50;
export const MAX_BYTES = 7800; // chrome.storage.sync は 1 項目 8KB まで(キー名を含む)

// after(ms)より後で最初の通知時刻(ms)。無ければ null。一時停止・再通知は考えない
export function nextTime(item, after = Date.now()) {
  const { date, time } = splitDue(item.at);
  if (!item.repeat) {
    const ms = dueAt(item.at);
    return ms > after ? ms : null;
  }
  const [h, m] = time.split(':').map(Number);
  const start = parseDate(date);
  let from = startOfDay(after);
  if (from < start) from = start;
  for (let i = 0; i < 3; i++) { // その日の時刻を過ぎていれば翌日以降を探す
    const d = firstMatch(item.repeat, from);
    if (!d) return null;
    const ms = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime();
    if (ms > after) return ms;
    from = addDays(d, 1);
  }
  return null;
}

// 通知する時刻の一覧(now より後のものだけ)。kind: 'at' | 'snooze'
export function notifyTimes(item, now = Date.now()) {
  if (item.paused) return [];
  const times = [];
  const next = nextTime(item, now);
  if (next) times.push({ kind: 'at', at: next });
  if (item.snooze > now) times.push({ kind: 'snooze', at: item.snooze });
  return times;
}

// (last, now] の間に通知するはずだったか(Chrome を閉じていた間の分)
export function missed(item, last, now = Date.now()) {
  if (item.paused) return false;
  const next = nextTime(item, last);
  return (next !== null && next <= now) || (item.snooze > last && item.snooze <= now);
}

// 終わったか(もう通知する時刻が無い)
export const isEnded = (item, now = Date.now()) => nextTime(item, now) === null && !(item.snooze > now);

// 表示順。次の通知が近い順、一時停止中はその後、終わったものは最後(新しい順)
export function sortItems(items, now = Date.now()) {
  const key = (i) => nextTime(i, now) ?? Infinity;
  const active = items.filter((i) => !i.paused && !isEnded(i, now)).sort((a, b) => key(a) - key(b));
  const paused = items.filter((i) => i.paused && !isEnded(i, now)).sort((a, b) => key(a) - key(b));
  const ended = items.filter((i) => isEnded(i, now)).sort((a, b) => dueAt(b.at) - dueAt(a.at));
  return [...active, ...paused, ...ended];
}

// ---------- 編集ダイアログ(ui.js の editSettings) ----------
// 内容 → 繰り返し → その繰り返しに要る欄だけを出す。
//   繰り返さない: 日付・時刻 / 毎日・平日: 時刻 / 毎週: 曜日・時刻 / 毎月(日付): 日・時刻
//   毎月(第 n ○曜日): 週(複数)・曜日(複数)・直近の日付・時刻 / 毎年: 月日・時刻

// 「毎月 {day} 日」のような文言を、ui.js の parts(文字とセレクトを並べる欄)に分ける。{名前} の所にセレクトを置く
function parts(key, selects) {
  return t(key).split(/(\{\w+\})/).filter((s) => s.trim()).map((s) => selects[s.slice(1, -1)] ?? s.trim());
}
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: String(from + i) }));

const now = () => Date.now();
const newItem = () => ({ id: '', text: '', at: `${dateKey(new Date())}T00:00`, repeat: null, paused: false, snooze: 0 });

export function reminderFields() {
  const is = (...freqs) => (v) => freqs.includes(v.freq);
  return [
    { key: 'text', label: t('field_text'), type: 'text' },
    { key: 'freq', label: t('repeat_field_freq'), type: 'select', options: FREQ_OPTIONS },
    { key: 'date', label: t('reminder_field_date'), type: 'date', when: is('none') },
    { key: 'days', label: t('repeat_field_weekdays'), type: 'multicheck', inline: true, options: WEEKDAY_OPTIONS, when: is('weekly') },
    { key: 'monthDay', label: t('reminder_field_day'), type: 'parts', parts: parts('reminder_month_day', { day: { key: 'mday', options: range(1, 31) } }), when: is('monthly'), hint: t('reminder_month_day_hint') },
    ...nthWeekdayFields(is('nthWeekday'), (v) => ({ rule: readReminderForm(v, newItem(), now()).repeat, from: new Date(now()) })),
    { key: 'yearDay', label: t('reminder_field_day'), type: 'parts', parts: parts('reminder_year_day', { month: { key: 'month', options: range(1, 12) }, day: { key: 'yday', options: range(1, 31) } }), when: is('yearly') },
    { key: 'time', label: t('reminder_field_time'), type: 'time' },
  ];
}

// ダイアログの初期値。繰り返しの欄は、今の設定か日付(無ければ今日)から決める
export function reminderFormValues(item, now = Date.now()) {
  const { date, time } = splitDue(item.at);
  const rule = item.repeat;
  const anchor = rule ? parseDate(rule.anchor) : parseDate(date);
  return {
    text: item.text,
    freq: rule?.freq ?? 'none',
    date: rule ? dateKey(new Date(Math.max(now, dueAt(item.at)))) : date,
    time,
    days: (rule?.days?.length ? rule.days : [anchor.getDay()]).map(String),
    mday: String(rule?.day ?? anchor.getDate()),
    ...nthWeekdayValues(rule, anchor),
    month: String(rule?.month ?? anchor.getMonth() + 1),
    yday: String(rule?.day ?? anchor.getDate()),
  };
}

// ダイアログの値からリマインダーを作る。繰り返しは今日から数える(at の日付 = 今日)
export function readReminderForm(values, item, now = Date.now()) {
  const old = splitDue(item.at);
  const time = values.time || old.time; // 日付・時刻は空にできない(空なら元のまま)
  const base = { ...item, text: (values.text.trim() || item.text).slice(0, 200), snooze: 0 }; // 変えたら再通知は取り消す
  if (values.freq === 'none') return { ...base, at: `${values.date || old.date}T${time}`, repeat: null };
  const today = dateKey(new Date(now));
  const rule = { freq: values.freq, every: 1, days: [], until: null, anchor: today };
  if (values.freq === 'weekly') rule.days = (values.days.length ? values.days : [String(new Date(now).getDay())]).map(Number).sort();
  if (values.freq === 'monthly') rule.day = Number(values.mday);
  if (values.freq === 'nthWeekday') Object.assign(rule, readNthWeekday(values, new Date(now)));
  if (values.freq === 'yearly') Object.assign(rule, { month: Number(values.month), day: Number(values.yday) });
  return { ...base, at: `${today}T${time}`, repeat: rule };
}

// 繰り返しと時刻の説明:「毎日 07:30」「毎月第 2 火曜 10:00」「10/2(金) 15:00」
export function scheduleLabel(item) {
  const { date, time } = splitDue(item.at);
  if (item.repeat) return t('date_with_time', { date: repeatLabel(item.repeat), time });
  const d = parseDate(date);
  return t('date_with_time', { date: t('date_ymd', { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: weekdayNames()[d.getDay()] }), time });
}

export const storedSize = (key, value) => new TextEncoder().encode(key + JSON.stringify(value)).length;
