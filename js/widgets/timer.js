import { el } from '../ui.js';
import { t as tr } from '../i18n.js'; // この中では t がタイマーの状態の変数名なので tr にする
import {
  TIMER_DEFAULTS, PHASES, loadTimer, updateTimer, completeTimer, timerKey,
  totalOf, remaining, isRunning, start, pause, reset, nextPhase, formatClock,
  MAX_DIGITS, digitsToDuration, durationToDigits,
} from '../timer-core.js';

// タイマー。上のタブで「カウントダウン」と「ポモドーロ」を切り替える(両方を同時に動かすこともできる)。
// 計算・保存・通知は js/timer-core.js。状態は chrome.storage.local に置き、開いている新規タブで揃える。
// 新規タブを閉じていても、終了はバックグラウンド(chrome.alarms)が処理して通知する

const MODES = { countdown: tr('timer_mode_countdown'), pomodoro: tr('timer_mode_pomodoro') }; // タブの並び順
const PRESETS = [1, 3, 5, 10, 30]; // カウントダウンの時間(分)
const MAX_DURATION = (99 * 3600 + 59 * 60 + 59) * 1000;
const RING = 2 * Math.PI * 45; // 円の周の長さ(viewBox 100 の半径 45)

// 時間になったときの音(表示中のタブだけで鳴らす)
function chime() {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < 3; i++) {
      const t = ctx.currentTime + i * 0.35;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    }
    setTimeout(() => ctx.close(), 1500);
  } catch (err) {
    console.error(err);
  }
}

export default {
  type: 'timer',
  name: tr('timer_name'),
  description: tr('timer_description'),
  size: { w: 5, h: 5, minW: 4, minH: 4 },
  defaults: { ...TIMER_DEFAULTS },
  fields: [
    { key: 'work', label: tr('timer_work_minutes'), type: 'number', min: 1, max: 180 },
    { key: 'short', label: tr('timer_short_minutes'), type: 'number', min: 1, max: 60 },
    { key: 'long', label: tr('timer_long_minutes'), type: 'number', min: 1, max: 120 },
    { key: 'longEvery', label: tr('timer_long_every'), type: 'number', min: 2, max: 10 },
    { key: 'autoStart', label: tr('timer_auto_start'), type: 'checkbox' },
    { key: 'notify', label: tr('timer_notify'), type: 'checkbox', hint: tr('timer_notify_hint') },
    { key: 'sound', label: tr('timer_sound'), type: 'checkbox', hint: tr('timer_sound_hint') },
  ],

  mount(root, config, ctx) {
    let cfg = config;
    let state = null;

    const tabs = Object.entries(MODES).map(([mode, label]) => {
      const tab = el('button', { type: 'button', className: 'tm-tab', role: 'tab', textContent: label });
      tab.dataset.mode = mode;
      tab.addEventListener('click', () => {
        if (cfg.mode === mode) return;
        cfg = { ...cfg, mode };
        ctx.save({ mode });
        render();
      });
      return tab;
    });

    const phase = el('div', { className: 'tm-phase' });
    const ring = el('div', { className: 'tm-ring' });
    ring.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="tm-track" cx="50" cy="50" r="45"/><circle class="tm-progress" cx="50" cy="50" r="45" stroke-dasharray="${RING}"/></svg>`;
    const progress = ring.querySelector('.tm-progress');
    const time = el('div', { className: 'tm-time' });

    // カウントダウンの時間の入力(止まっているときだけ)。数字を打つたびに右から押し込み、上の桁へ繰り上がる。
    // まだ入力していない桁は薄く表示する
    const setter = el('div', { className: 'tm-set', tabIndex: 0, role: 'textbox', title: tr('timer_input_title') });
    setter.ariaLabel = tr('timer_input_label');
    let digits = '';
    const renderDigits = () => {
      const padded = digits.padStart(MAX_DIGITS, '0');
      const firstEntered = MAX_DIGITS - digits.length;
      const parts = [];
      for (let i = 0; i < MAX_DIGITS; i++) {
        if (i && i % 2 === 0) parts.push(el('span', { className: i > firstEntered ? 'tm-colon on' : 'tm-colon', textContent: ':' }));
        parts.push(el('span', { className: i >= firstEntered ? 'tm-digit on' : 'tm-digit', textContent: padded[i] }));
      }
      setter.replaceChildren(...parts);
    };
    const setDigits = (next) => {
      digits = next.replace(/^0+/, '').slice(0, MAX_DIGITS);
      renderDigits();
      setDuration(digitsToDuration(digits));
    };
    const presets = el('div', { className: 'tm-presets' }, PRESETS.map((m) => {
      const b = el('button', { type: 'button', className: 'tm-preset', textContent: tr('timer_preset', { n: m }) });
      b.addEventListener('click', () => setDuration(m * 60_000));
      return b;
    }));

    const mainBtn = el('button', { type: 'button', className: 'tm-btn primary' });
    const resetBtn = el('button', { type: 'button', className: 'tm-btn', textContent: tr('timer_reset') });
    const skipBtn = el('button', { type: 'button', className: 'tm-btn', textContent: tr('timer_skip'), title: tr('timer_skip_title') });

    root.append(el('div', { className: 'tm' },
      el('div', { className: 'tm-tabs', role: 'tablist' }, tabs),
      phase,
      el('div', { className: 'tm-dial' }, ring, el('div', { className: 'tm-center' }, time, setter)),
      presets,
      el('div', { className: 'tm-controls' }, mainBtn, resetBtn, skipBtn)));

    const mode = () => cfg.mode;
    const current = () => state[mode()];

    const save = async (fn) => {
      state = await updateTimer(ctx.id, (s) => ({ ...s, [mode()]: fn(s[mode()]) }));
      render();
    };

    function setDuration(ms) {
      const duration = Math.min(MAX_DURATION, Math.max(0, ms));
      save((t) => ({ ...t, duration, endsAt: null, left: null }));
    }
    setter.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        if (digits.length < MAX_DIGITS) setDigits(digits + e.key);
      } else if (e.key === 'Backspace') {
        setDigits(digits.slice(0, -1));
      } else if (e.key === 'Delete') {
        setDigits('');
      } else if (e.key === 'Enter') {
        if (digits) mainBtn.click();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        setter.blur();
      } else {
        return;
      }
      e.preventDefault();
    });
    setter.addEventListener('paste', (e) => {
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
      if (!pasted) return;
      e.preventDefault();
      setDigits((digits + pasted).slice(-MAX_DIGITS));
    });
    // 入力を終えたら、"90" のような入力を "1:30" に整える
    setter.addEventListener('blur', () => render());

    mainBtn.addEventListener('click', () => {
      const t = current();
      if (isRunning(t)) save((x) => pause(x));
      else save((x) => start(x, totalOf(mode(), x, cfg)));
    });
    resetBtn.addEventListener('click', () => save((t) => reset(t)));
    skipBtn.addEventListener('click', () => save((t) => nextPhase(t, cfg)));

    // ---- 表示 ----
    const tick = () => {
      if (!state) return;
      const t = current();
      const total = totalOf(mode(), t, cfg);
      const left = remaining(t, total);
      time.textContent = formatClock(left);
      progress.style.strokeDashoffset = total ? RING * (1 - left / total) : 0;
    };

    function render() {
      if (!state) return;
      const t = current();
      const running = isRunning(t);
      const idle = !running && t.left == null;
      root.dataset.mode = mode();
      for (const tab of tabs) {
        tab.setAttribute('aria-selected', tab.dataset.mode === mode());
        tab.classList.toggle('running', isRunning(state[tab.dataset.mode])); // 裏で動いているタブに印を付ける
      }

      if (mode() === 'pomodoro') {
        const every = Number(cfg.longEvery);
        const done = t.round % every;
        phase.replaceChildren(
          el('span', { className: `tm-phase-name ${t.phase}`, textContent: PHASES[t.phase] }),
          el('span', { className: 'tm-dots', title: tr('timer_dots_title', { n: every }) },
            Array.from({ length: every }, (_, i) => el('span', { className: i < done ? 'tm-dot on' : 'tm-dot' }))));
        root.dataset.phase = t.phase;
      } else {
        phase.replaceChildren();
        delete root.dataset.phase;
      }

      // カウントダウンは、止まっていて満タンのときだけ時間を入力できる
      const editable = mode() === 'countdown' && idle;
      setter.hidden = !editable;
      time.hidden = editable;
      presets.hidden = !editable;
      if (editable && document.activeElement !== setter) { // 入力中は書き換えない
        digits = durationToDigits(t.duration);
        renderDigits();
      }

      mainBtn.textContent = running ? tr('timer_pause') : idle ? tr('timer_start') : tr('timer_resume');
      mainBtn.disabled = mode() === 'countdown' && !t.duration;
      resetBtn.disabled = idle;
      skipBtn.hidden = mode() !== 'pomodoro';
      ring.classList.toggle('paused', !running && !idle);
      tick();
      scheduleFinish();
    }

    // 時間になったら、表示中なら音を鳴らして次の状態へ進める(バックグラウンドのアラームより早く反映するため)
    const finishTimers = {};
    function scheduleFinish() {
      for (const m of Object.keys(MODES)) {
        clearTimeout(finishTimers[m]);
        const { endsAt } = state[m];
        if (!endsAt) continue;
        finishTimers[m] = setTimeout(() => {
          // タブを開いた時点ですでに過ぎていた分(閉じていた間に終わったもの)は鳴らさない
          const fresh = Date.now() - endsAt < 5000;
          if (fresh && cfg.sound && document.visibilityState === 'visible') chime();
          completeTimer(ctx.id, m);
        }, Math.max(0, endsAt - Date.now()) + 20); // 少し遅らせて、確実に終了時刻を過ぎてから処理する
      }
    }

    const interval = setInterval(() => {
      if (state && Object.values(state).some(isRunning)) tick();
    }, 250);

    // 他のタブ・バックグラウンド・通知の「開始」ボタンでの変更を反映する
    const onChanged = (changes, area) => {
      if (area !== 'local' || !changes[timerKey(ctx.id)]) return;
      loadTimer(ctx.id).then((s) => {
        state = s;
        render();
      });
    };
    chrome.storage.onChanged.addListener(onChanged);
    loadTimer(ctx.id).then((s) => {
      state = s;
      render();
    });

    return {
      update(next) {
        cfg = next;
        render();
      },
      unmount() {
        clearInterval(interval);
        for (const t of Object.values(finishTimers)) clearTimeout(t);
        chrome.storage.onChanged.removeListener(onChanged);
      },
    };
  },
};
