// タイマー(ポモドーロ / カウントダウン)の計算と保存。画面(js/widgets/timer.js)とバックグラウンド(background.js)で共有する
//
// 状態は chrome.storage.local の data:<ウィジェットの id> に置く(同期しない。別の PC で同時に鳴らないように)。
// ウィジェットを削除すると store.removeData で消える。
//   {
//     pomodoro:  { phase: 'work' | 'short' | 'long', round, endsAt, left },
//     countdown: { duration, endsAt, left },
//   }
//   endsAt: 動いている間の終了時刻(ms)。left: 一時停止中の残り(ms)。どちらも null なら止まっていて満タン
//
// 時間になったら completeTimer() で次の状態へ進めて通知する。開いている新規タブ(setTimeout)と
// バックグラウンド(chrome.alarms)の両方から呼ばれるが、「時間になっているか」を見てから進めるので 1 回しか進まない。
// 同時に呼ばれても、終了時刻だけから計算するので同じ結果になり、通知も同じ ID なので重ならない

// 文言。この中では t がタイマーの状態の変数名なので tr にする
import { t as tr } from './i18n.js';

export const TIMER_DEFAULTS = {
  mode: 'countdown', // 表示中のタブ: countdown | pomodoro
  work: 25,          // 分
  short: 5,
  long: 15,
  longEvery: 4,      // 何回の作業ごとに長い休憩にするか
  autoStart: false,  // 終わったら次(休憩 / 作業)を自動で始める
  notify: true,
  sound: true,       // 時間になったとき、表示中の新規タブで音を鳴らす
};

export const PHASES = {
  work: tr('timer_phase_work'),
  short: tr('timer_phase_short'),
  long: tr('timer_phase_long'),
};

const MINUTE = 60_000;
const LATE = 60_000; // これより遅れて気づいた終了(Chrome を閉じていた間など)は、通知も自動開始もしない
export const ALARM_PREFIX = 'timer|';        // アラーム名・通知 ID: timer|<ウィジェットの id>|<pomodoro | countdown>
const KEY = (id) => `data:${id}`;

export const initialState = () => ({
  pomodoro: { phase: 'work', round: 0, endsAt: null, left: null },
  countdown: { duration: 5 * MINUTE, endsAt: null, left: null },
});

export async function loadTimer(id) {
  const saved = (await chrome.storage.local.get(KEY(id)))[KEY(id)];
  const init = initialState();
  return { pomodoro: { ...init.pomodoro, ...saved?.pomodoro }, countdown: { ...init.countdown, ...saved?.countdown } };
}
export const saveTimer = (id, state) => chrome.storage.local.set({ [KEY(id)]: state });
export const timerKey = KEY;

// ---------- 計算 ----------

export const phaseLength = (phase, cfg) => Number(cfg[phase]) * MINUTE;
export const totalOf = (mode, t, cfg) => (mode === 'pomodoro' ? phaseLength(t.phase, cfg) : t.duration);
export const remaining = (t, total, now = Date.now()) => (t.endsAt ? Math.max(0, t.endsAt - now) : t.left ?? total);
export const isRunning = (t) => t.endsAt != null;
export const isDue = (t, now = Date.now()) => t.endsAt != null && t.endsAt <= now;

export const start = (t, total, now = Date.now()) => ({ ...t, endsAt: now + (t.left ?? total), left: null });
export const pause = (t, now = Date.now()) => ({ ...t, endsAt: null, left: Math.max(0, t.endsAt - now) });
export const reset = (t) => ({ ...t, endsAt: null, left: null });

// 作業が終わったら回数を増やし、longEvery 回ごとに長い休憩。休憩が終わったら作業
export function nextPhase(p, cfg) {
  if (p.phase !== 'work') return { ...p, phase: 'work', endsAt: null, left: null };
  const round = p.round + 1;
  return { ...p, phase: round % Number(cfg.longEvery) === 0 ? 'long' : 'short', round, endsAt: null, left: null };
}

// 時間になったタイマーを次の状態へ進める。{ next, notice } を返す(notice は通知の内容。null なら通知しない)
export function finish(mode, t, cfg, now = Date.now()) {
  const late = now - t.endsAt > LATE;
  if (mode === 'countdown') {
    return {
      next: reset(t),
      notice: late ? null : { title: tr('timer_countdown_done_title'), message: tr('timer_countdown_done', { duration: formatDuration(t.duration) }) },
    };
  }
  let next = nextPhase(t, cfg);
  // 自動開始は、前の終了時刻から続けて数える(どこで計算しても同じ結果になるように)
  const auto = cfg.autoStart && !late;
  if (auto) next = start(next, phaseLength(next.phase, cfg), t.endsAt);
  const minutes = Number(cfg[next.phase]);
  const notice = late ? null : t.phase === 'work'
    ? { title: tr('timer_break_title', { phase: PHASES[next.phase] }), message: tr('timer_break_message', { round: next.round, phase: PHASES[next.phase], minutes }), startable: !auto }
    : { title: tr('timer_work_title'), message: tr('timer_work_message', { phase: PHASES[t.phase], minutes }), startable: !auto };
  return { next, notice };
}

// 01:05 / 1:02:03
export function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

// カウントダウンの入力。数字を右から押し込む形式(電卓や Google のタイマーと同じ)で、
// 下 2 桁が秒、次の 2 桁が分、その上が時間。"130" → 1 分 30 秒、"10000" → 1 時間。"90" のような 60 以上も秒として数える
export const MAX_DIGITS = 6;
export function digitsToDuration(digits) {
  const d = digits.padStart(MAX_DIGITS, '0');
  return (Number(d.slice(0, 2)) * 3600 + Number(d.slice(2, 4)) * 60 + Number(d.slice(4))) * 1000;
}
// 時間を入力の数字列に戻す(前の 0 は除く)。5 分 → "500"
export function durationToDigits(ms) {
  const s = Math.round(ms / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.min(99, Math.floor(s / 3600)))}${pad(Math.floor((s % 3600) / 60))}${pad(s % 60)}`.replace(/^0+/, '');
}

// 5分 / 1時間30分 / 45秒。単位どうしはそのままつなげる(区切りの空白が要る言語は、文言の末尾に空白を入れる)
export function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  const parts = [[Math.floor(s / 3600), 'timer_unit_hours'], [Math.floor((s % 3600) / 60), 'timer_unit_minutes'], [s % 60, 'timer_unit_seconds']];
  return parts.filter(([n]) => n).map(([n, key]) => tr(key, { n })).join('').trim() || tr('timer_unit_seconds', { n: 0 });
}

// ---------- 保存・アラーム・通知 ----------

const alarmName = (id, mode) => `${ALARM_PREFIX}${id}|${mode}`;

// 動いているタイマーの終了時刻にアラームを合わせる(新規タブを閉じていても、バックグラウンドで終了を処理するため)
export async function syncAlarms(id, state) {
  for (const mode of ['pomodoro', 'countdown']) {
    const { endsAt } = state[mode];
    if (endsAt) await chrome.alarms.create(alarmName(id, mode), { when: endsAt });
    else await chrome.alarms.clear(alarmName(id, mode));
  }
}

// 画面からの操作(開始・一時停止など)の保存
export async function updateTimer(id, fn) {
  const state = await loadTimer(id);
  const next = fn(state);
  await saveTimer(id, next);
  await syncAlarms(id, next);
  return next;
}

export async function loadTimerConfig(id) {
  const key = `cfg:${id}`;
  return { ...TIMER_DEFAULTS, ...(await chrome.storage.sync.get(key))[key] };
}

// 時間になっていれば次の状態へ進めて通知する。進めたら true
export async function completeTimer(id, mode, now = Date.now()) {
  const state = await loadTimer(id);
  const t = state[mode];
  if (!isDue(t, now)) return false;
  const cfg = await loadTimerConfig(id);
  const { next, notice } = finish(mode, t, cfg, now);
  const nextState = { ...state, [mode]: next };
  await saveTimer(id, nextState);
  await syncAlarms(id, nextState);
  if (notice && cfg.notify) {
    await chrome.notifications.create(alarmName(id, mode), {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: notice.title,
      message: notice.message,
      contextMessage: mode === 'pomodoro' ? tr('timer_mode_pomodoro') : tr('timer_mode_countdown'),
      buttons: notice.startable ? [{ title: tr('timer_start') }] : [],
      priority: 2,
    });
  }
  return true;
}

// 通知の「開始」ボタン
export async function startFromNotification(notificationId) {
  const [, id, mode] = notificationId.split('|');
  const cfg = await loadTimerConfig(id);
  await updateTimer(id, (state) => {
    const t = state[mode];
    return isRunning(t) ? state : { ...state, [mode]: start(t, totalOf(mode, t, cfg)) };
  });
}
