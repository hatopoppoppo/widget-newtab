// 日付と繰り返しの計算。ToDo(js/todo-core.js)とリマインダー(js/reminder-core.js)で共有する。
// DOM は使わない(Node で単体テストできるように)。文言は js/i18n.js(Node のテストでは tests/i18n-node.js が chrome.i18n の代わりをする)
//
// 繰り返しのルール:
// { freq: 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'nthWeekday' | 'yearly',
//   every: 1,            間隔(2 なら 2 日 / 2 週 / 2 か月 / 2 年ごと)
//   days: [0-6],         毎週の曜日(0 = 日曜)
//   month: 1-12,         毎年の月(省略時は基準日の月)
//   day: 1-31,           毎月・毎年の日(省略時は基準日の日。その日が無い月は月末)
//   nths: [1-4 | -1],    nthWeekday の「第 n」(複数可。-1 は最終)
//   weekdays: [0-6],     nthWeekday の曜日(複数可)
//   (以前の nth / weekday(1 つだけ)も読める)
//   until: null | 'YYYY-MM-DD',
//   anchor: 'YYYY-MM-DD' 繰り返しの基準日(間隔・毎月の日付の計算に使う) }

import { t, weekdayNames } from './i18n.js';

const DAY = 24 * 60 * 60 * 1000;
const sep = () => t('list_separator'); // 「月・木」の「・」
const pad = (n) => String(n).padStart(2, '0');

export const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeKey = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function parseDate(text) {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
export const dayDiff = (a, b) => Math.round((b - a) / DAY); // 夏時間でずれても丸めれば日数になる
const mod = (a, n) => ((a % n) + n) % n;
export const startOfDay = (ms) => parseDate(dateKey(new Date(ms)));

// 'YYYY-MM-DD' または 'YYYY-MM-DDTHH:MM'
export function splitDue(due) {
  if (!due) return null;
  const [date, time = null] = due.split('T');
  return { date, time };
}
export const joinDue = (date, time) => (date ? (time ? `${date}T${time}` : date) : null);

// 日時(ms)。日付だけなら defaultTime とする
export function dueAt(due, defaultTime = '00:00') {
  const { date, time } = splitDue(due);
  const [h, m] = (time ?? defaultTime).split(':').map(Number);
  const d = parseDate(date);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// 第何週か(1〜5)と、その月の最後の週か
export const nthOfMonth = (date) => Math.ceil(date.getDate() / 7);
const isLastOfMonth = (date) => date.getDate() + 7 > daysInMonth(date.getFullYear(), date.getMonth());

// 第 n ○曜日の週と曜日(以前の 1 つだけの形も配列にする)
export const nthWeekdays = (rule) => ({
  nths: (rule.nths ?? [rule.nth]).map(Number),
  weekdays: (rule.weekdays ?? [rule.weekday]).map(Number),
});

// その日が繰り返しの回に当たるか
export function matches(rule, date) {
  const anchor = parseDate(rule.anchor);
  const every = Math.max(1, Number(rule.every) || 1);
  const months = () => (date.getFullYear() - anchor.getFullYear()) * 12 + date.getMonth() - anchor.getMonth();
  const day = Number(rule.day) || anchor.getDate();
  const sameDayOfMonth = () => date.getDate() === Math.min(day, daysInMonth(date.getFullYear(), date.getMonth()));
  switch (rule.freq) {
    case 'daily':
      return mod(dayDiff(anchor, date), every) === 0;
    case 'weekdays':
      return date.getDay() >= 1 && date.getDay() <= 5;
    case 'weekly': {
      const days = rule.days?.length ? rule.days : [anchor.getDay()];
      if (!days.includes(date.getDay())) return false;
      const weeks = dayDiff(addDays(anchor, -anchor.getDay()), addDays(date, -date.getDay())) / 7;
      return mod(weeks, every) === 0;
    }
    case 'monthly':
      return mod(months(), every) === 0 && sameDayOfMonth(); // 31 日が無い月は月末
    case 'nthWeekday': {
      if (mod(months(), every) !== 0 || !nthWeekdays(rule).weekdays.includes(date.getDay())) return false;
      return nthWeekdays(rule).nths.some((n) => (n === -1 ? isLastOfMonth(date) : nthOfMonth(date) === n));
    }
    case 'yearly':
      return mod(date.getFullYear() - anchor.getFullYear(), every) === 0
        && date.getMonth() === (Number(rule.month) || anchor.getMonth() + 1) - 1 && sameDayOfMonth(); // 2/29 は平年なら 2/28
    default:
      return false;
  }
}

// from(Date)以降で最初に繰り返しの回に当たる日。終了日を過ぎるなら null
export function firstMatch(rule, from) {
  const until = rule.until ? parseDate(rule.until) : null;
  let d = from;
  for (let i = 0; i < 366 * 12; i++, d = addDays(d, 1)) { // 「12 年ごと」でも見つかる範囲
    if (until && d > until) return null;
    if (matches(rule, d)) return d;
  }
  return null;
}

// 日付の表示:「昨日」「今日 15:00」「明日」「10/5(日)」「2027/1/3(日)」
export function dueLabel(due, now = Date.now()) {
  if (!due) return '';
  const { date, time } = splitDue(due);
  const today = startOfDay(now);
  const d = parseDate(date);
  const diff = dayDiff(today, d);
  let text;
  if (diff === 0) text = t('date_today');
  else if (diff === 1) text = t('date_tomorrow');
  else if (diff === -1) text = t('date_yesterday');
  else {
    const parts = { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), weekday: weekdayNames()[d.getDay()] };
    text = t(d.getFullYear() === today.getFullYear() ? 'date_md' : 'date_ymd', parts);
  }
  return time ? t('date_with_time', { date: text, time }) : text;
}

const weekdayList = (days) => [...days].sort().map((d) => weekdayNames()[d]).join(sep());
const nthName = (n) => (n === -1 ? t('repeat_nth_last') : t('repeat_nth', { n }));

// 繰り返しの説明:「毎日」「平日」「2 週間ごと(月・木)」「毎月 25 日」「毎月第 2 火曜」…
export function repeatLabel(rule) {
  if (!rule) return '';
  const n = Math.max(1, Number(rule.every) || 1);
  // 間隔の部分:「毎月」「3 か月ごと」(第 n ○曜日も月ごと)
  const unit = rule.freq === 'nthWeekday' ? 'monthly' : rule.freq;
  const every = rule.freq === 'weekdays' ? t('repeat_weekdays') : t(n === 1 ? `repeat_${unit}` : `repeat_${unit}_n`, { n });
  const anchor = parseDate(rule.anchor);
  let text = every;
  if (rule.freq === 'weekly' && rule.days?.length) text = t('repeat_weekly_days', { every, days: weekdayList(rule.days) });
  if (rule.freq === 'monthly') text = t('repeat_monthly_day', { every, day: rule.day ?? anchor.getDate() });
  if (rule.freq === 'yearly') text = t('repeat_yearly_date', { every, month: rule.month ?? anchor.getMonth() + 1, day: rule.day ?? anchor.getDate() });
  if (rule.freq === 'nthWeekday') {
    const { nths, weekdays } = nthWeekdays(rule);
    const sorted = [...nths].sort((a, b) => (a === -1) - (b === -1) || a - b); // 最終は最後
    text = t('repeat_nth_weekday', { every, nths: sorted.map(nthName).join(sep()), weekdays: weekdayList(weekdays) });
  }
  if (rule.until) text = t('repeat_until', { text, date: rule.until.replaceAll('-', '/') });
  return text;
}

// from(Date)から months か月分(from の月を含む)の繰り返しの日。1 か月ごとに
// 「10 月: 13(火)・27(火)」の行にする。確かめ用の表示(ダイアログの直近の日付)に使う
export function previewDates(rule, from, months = 3) {
  const end = new Date(from.getFullYear(), from.getMonth() + months, 1);
  const byMonth = new Map();
  for (let d = firstMatch(rule, from); d && d < end; d = firstMatch(rule, addDays(d, 1))) {
    const key = `${d.getFullYear()}/${d.getMonth() + 1}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(t('repeat_preview_day', { day: d.getDate(), weekday: weekdayNames()[d.getDay()] }));
  }
  const lines = [];
  for (let i = 0; i < months; i++) {
    const m = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const days = byMonth.get(`${m.getFullYear()}/${m.getMonth() + 1}`);
    lines.push(t('repeat_preview_line', { month: m.getMonth() + 1, days: days ? days.join(sep()) : t('repeat_preview_none') }));
  }
  return lines.join('\n');
}

// ---------- 編集ダイアログ(ui.js の editSettings)の項目 ----------

export const FREQ_OPTIONS = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'nthWeekday', 'yearly']
  .map((value) => ({ value, label: t(`repeat_option_${value.toLowerCase()}`) }));
export const WEEKDAY_OPTIONS = weekdayNames().map((label, i) => ({ value: String(i), label }));
export const NTH_OPTIONS = [1, 2, 3, 4, -1].map((n) => ({ value: String(n), label: nthName(n) }));

// 第 n ○曜日の欄(週・曜日をそれぞれ複数選べる)と、直近の日付。
// show(values) が true のときだけ表示し、rule(values) で今の入力のルールを作る(足りなければ null)
export function nthWeekdayFields(show, rule) {
  return [
    { key: 'nths', label: t('repeat_field_nths'), type: 'multicheck', inline: true, options: NTH_OPTIONS, when: show },
    { key: 'weekdays', label: t('repeat_field_weekdays'), type: 'multicheck', inline: true, options: WEEKDAY_OPTIONS, when: show },
    {
      key: 'nthPreview', label: t('repeat_field_preview'), type: 'preview', when: show,
      render: (v) => {
        if (!v.nths.length || !v.weekdays.length) return t('repeat_preview_choose');
        const r = rule(v);
        return r ? previewDates(r.rule, r.from) : '';
      },
    },
  ];
}

// 第 n ○曜日の欄の初期値。ルールが無ければ date の週と曜日(5 週目は「最終」)
export function nthWeekdayValues(rule, date) {
  if (rule?.freq === 'nthWeekday') {
    const { nths, weekdays } = nthWeekdays(rule);
    return { nths: nths.map(String), weekdays: weekdays.map(String) };
  }
  const nth = nthOfMonth(date);
  return { nths: [String(nth > 4 ? -1 : nth)], weekdays: [String(date.getDay())] };
}

// 選ばれていなければ date の週・曜日にする
export function readNthWeekday(values, date) {
  const fallback = nthWeekdayValues(null, date);
  return {
    nths: (values.nths.length ? values.nths : fallback.nths).map(Number),
    weekdays: (values.weekdays.length ? values.weekdays : fallback.weekdays).map(Number).sort(),
  };
}

// 繰り返しの項目。enabled(values) が true のときだけ表示する(ToDo なら期限があるとき)
export function repeatFields(enabled = () => true) {
  const on = (v, ...freqs) => enabled(v) && freqs.includes(v.freq);
  return [
    { key: 'freq', label: t('repeat_field_freq'), type: 'select', options: FREQ_OPTIONS, when: enabled },
    { key: 'every', label: t('repeat_field_every'), type: 'number', min: 1, max: 99, when: (v) => on(v, 'daily', 'weekly', 'monthly', 'nthWeekday', 'yearly') },
    { key: 'days', label: t('repeat_field_weekdays'), type: 'multicheck', inline: true, options: WEEKDAY_OPTIONS, when: (v) => on(v, 'weekly'), hint: t('repeat_field_days_hint') },
    ...nthWeekdayFields((v) => on(v, 'nthWeekday'), (v) => ({ rule: readRepeat(v, v.date), from: parseDate(v.date) })),
    { key: 'until', label: t('repeat_field_until'), type: 'date', when: (v) => enabled(v) && v.freq !== 'none' },
  ];
}

// ダイアログの初期値。date はいまの日付('YYYY-MM-DD')。第 n ○曜日の初期値はその日から決める
export function repeatValues(rule, date) {
  const d = date ? parseDate(date) : new Date();
  return {
    freq: rule?.freq ?? 'none',
    every: rule?.every ?? 1,
    days: (rule?.days ?? []).map(String),
    ...nthWeekdayValues(rule, d),
    until: rule?.until ?? '',
  };
}

// ダイアログの値から繰り返しのルールを作る(繰り返さないなら null)。old は編集前のルール、oldDate は編集前の日付
export function readRepeat(values, date, old = null, oldDate = null) {
  if (!date || values.freq === 'none') return null;
  return {
    freq: values.freq,
    every: Math.min(99, Math.max(1, values.every || 1)),
    days: values.freq === 'weekly' ? (values.days.length ? values.days.map(Number) : [parseDate(date).getDay()]) : [],
    ...(values.freq === 'nthWeekday' ? readNthWeekday(values, parseDate(date)) : {}),
    until: values.until || null,
    // 日付と種類が変わらなければ基準日はそのまま(間隔の数え方がずれないように)
    anchor: old && old.freq === values.freq && oldDate === date ? old.anchor : date,
  };
}
