import { el, loadScript } from '../ui.js';
import { t } from '../i18n.js';

/* global Tone */ // vendor/tone/Tone.js(ピアノを置いているときだけ loadTone() で読み込む)
const loadTone = () => loadScript('vendor/tone/Tone.js');

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

// PC キーボードの割り当て(キー配列に依存しないよう KeyboardEvent.code で判定)
// 下段 Z 行 = 1 オクターブ目、上段 Q 行 = 2 オクターブ目
const KEYMAP = [
  'KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM',
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU',
  'KeyI',
];
const KEY_LABELS = 'ZSXDCVGBHNJMQ2W3ER5T6Y7UI';

const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
// "D#4" -> 63(Tone.Frequency は呼ぶだけで既定コンテキストを作ってしまうので自前で計算)
const toMidi = (note) => {
  const [, name, octave] = note.match(/^([A-G]#?)(\d)$/);
  return 12 * (Number(octave) + 1) + NOTE_NAMES.indexOf(name);
};

// ---------- 音源 ----------

// Salamander Grand Piano のサンプル(短 3 度おき。間の音は Sampler が音程をずらして補う)
const SAMPLE_BASE = chrome.runtime.getURL('/assets/piano/');
const SAMPLES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4',
  'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'].map((file) => {
  const note = file.replace('s', '#');
  return { file: `${file}.mp3`, note, midi: toMidi(note) };
});

// サンプルはデコードすると 1 つ 2〜9MB(48kHz・ステレオ・13〜25 秒)。メモリを抑えるため
// - 鍵盤の音域に必要なサンプルだけ、最初に鍵盤を押したときに読み込む(押した音に近いものから。オクターブを移動したら足りない分を追加)
// - SAMPLE_SECONDS より長いサンプルは切り詰め、最後をフェードアウトする(既定の音域で約 51MB → 約 32MB)
// - IDLE_MS のあいだ弾かなければ音源を捨て、どのピアノも音源を持っていなければ AudioContext も閉じる
// - 設定の「音質: 省メモリ」ではモノラルにする(さらに半分。左右の広がりは無くなる)
const samplesFor = (low, high) => SAMPLES.filter((s) => s.midi >= low - 3 && s.midi <= high + 3);
const SAMPLE_SECONDS = 8;
const FADE_SECONDS = 1.5;
const IDLE_MS = () => globalThis.PIANO_IDLE_MS ?? 5 * 60_000; // テストでは短くする

export async function loadSample(file, { mono = false } = {}) {
  const rate = Tone.getContext().sampleRate;
  const decoder = new OfflineAudioContext({ length: 1, sampleRate: rate });
  const full = await decoder.decodeAudioData(await (await fetch(SAMPLE_BASE + file)).arrayBuffer());
  const length = Math.min(full.length, Math.round(SAMPLE_SECONDS * rate));
  const channels = mono ? 1 : full.numberOfChannels;
  if (length === full.length && channels === full.numberOfChannels) return full;
  const out = new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate });
  const fade = length < full.length ? Math.round(FADE_SECONDS * rate) : 0;
  const read = (c) => full.getChannelData(c).slice(0, length);
  for (let c = 0; c < channels; c++) {
    let data = read(c);
    if (mono && full.numberOfChannels > 1) {
      // 全チャンネルの平均(左右を混ぜる)
      for (let k = 1; k < full.numberOfChannels; k++) {
        const other = read(k);
        for (let i = 0; i < length; i++) data[i] += other[i];
      }
      for (let i = 0; i < length; i++) data[i] /= full.numberOfChannels;
    }
    for (let i = length - fade; i < length; i++) data[i] *= (length - i) / fade;
    out.copyToChannel(data, c);
  }
  return out; // 元の長いバッファは捨てる(GC される)
}

// 開始オクターブの範囲。最高音がサンプルの最高音 C8 を超えないようにする
const MIN_OCTAVE = 1;
const maxOctave = (octaves) => 8 - octaves;
const clampOctave = (o, octaves) => Math.min(maxOctave(octaves), Math.max(MIN_OCTAVE, o));

const SOUNDS = [
  { value: 'piano', label: t('piano_sound_piano') },
  { value: 'epiano', label: t('piano_sound_epiano') },
  { value: 'organ', label: t('piano_sound_organ') },
  { value: 'triangle', label: t('piano_sound_triangle') },
  { value: 'sine', label: t('piano_sound_sine') },
  { value: 'square', label: t('piano_sound_square') },
  { value: 'sawtooth', label: t('piano_sound_sawtooth') },
];

// 音色ごとの音量補正(dB)。矩形波・ノコギリ波は聴感上かなり大きいので下げる
const GAIN_OFFSET = { square: -10, sawtooth: -10, organ: -6, epiano: -2 };

function createInstrument(cfg) {
  const release = cfg.release;
  let inst;
  switch (cfg.wave) {
    case 'piano':
      inst = new Tone.Sampler({ release }); // サンプルは loadSample() で読んで後から add する
      break;
    case 'epiano':
      inst = new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 8,
        envelope: { attack: 0.002, decay: 1.6, sustain: 0.15, release },
        modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release },
      });
      break;
    case 'organ':
      inst = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'custom', partials: [1, 0.7, 0, 0.45, 0, 0.3, 0, 0.2] },
        envelope: { attack: 0.01, decay: 0, sustain: 1, release },
      });
      break;
    default:
      inst = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: cfg.wave },
        envelope: { attack: 0.005, decay: 0.4, sustain: 0.35, release },
      });
  }
  inst.volume.value = cfg.volume > 0 ? Tone.gainToDb(cfg.volume / 100) + (GAIN_OFFSET[cfg.wave] ?? 0) : -Infinity;
  return inst.toDestination();
}

// Tone の既定コンテキストは内部クロックに Blob URL の Worker を使うが、拡張機能の CSP では
// 作れないので setTimeout 方式のクロックにする。鍵盤の反応を良くするため先読み(lookAhead)も 0 に
let contextReady = false;
function ensureContext() {
  if (contextReady) return;
  Tone.setContext(new Tone.Context({ clockSource: 'timeout', latencyHint: 'interactive', lookAhead: 0 }));
  contextReady = true;
}

// 音源を持っているピアノ。いなくなったら AudioContext を閉じる(オーディオの出力を止めてメモリを返す)。
// 同じページに複数のピアノを置いたとき、他のピアノが使っているコンテキストを閉じないように数える
const holders = new Set();
function releaseContext(holder) {
  holders.delete(holder);
  if (holders.size || !contextReady) return;
  contextReady = false;
  Tone.getContext().close().catch(() => {});
}

// ---------- ウィジェット ----------

export default {
  type: 'piano',
  name: t('piano_name'),
  description: t('piano_description'),
  size: { w: 12, h: 4, minW: 6, minH: 3 },
  defaults: {
    startOctave: 4,
    octaves: 2,
    wave: 'piano',
    quality: 'stereo',
    volume: 70,
    release: 1,
    showNoteNames: false,
    showKeyLabels: true,
    showOctaveControls: true,
    rememberOctave: true,
  },
  fields: [
    { key: 'wave', label: t('piano_wave'), type: 'select', options: SOUNDS },
    {
      key: 'quality', label: t('piano_quality'), type: 'select', when: (v) => v.wave === 'piano',
      options: [
        { value: 'stereo', label: t('piano_quality_stereo') },
        { value: 'mono', label: t('piano_quality_mono') },
      ],
      hint: t('piano_quality_hint'),
    },
    { key: 'startOctave', label: t('piano_start_octave'), type: 'range', min: MIN_OCTAVE, max: 7 },
    { key: 'octaves', label: t('piano_octaves'), type: 'range', min: 1, max: 4 },
    { key: 'volume', label: t('piano_volume'), type: 'range', min: 0, max: 100, step: 5, unit: '%' },
    { key: 'release', label: t('piano_release'), type: 'range', min: 0.1, max: 4, step: 0.1, unit: t('piano_release_unit') },
    { key: 'showNoteNames', label: t('piano_show_note_names'), type: 'checkbox' },
    { key: 'showKeyLabels', label: t('piano_show_key_labels'), type: 'checkbox', hint: t('piano_show_key_labels_hint') },
    { key: 'showOctaveControls', label: t('piano_show_octave_controls'), type: 'checkbox' },
    { key: 'rememberOctave', label: t('piano_remember_octave'), type: 'checkbox', hint: t('piano_remember_octave_hint') },
  ],

  mount(root, config, ctx) {
    const down = el('button', { type: 'button', className: 'piano-shift', title: t('piano_octave_down'), textContent: '◀' });
    const up = el('button', { type: 'button', className: 'piano-shift', title: t('piano_octave_up'), textContent: '▶' });
    const rangeLabel = el('span', { className: 'piano-range' });
    const bar = el('div', { className: 'piano-bar' }, down, rangeLabel, up);
    const keys = el('div', { className: 'piano', tabIndex: 0 });
    const status = el('div', { className: 'piano-status' });
    root.append(bar, keys, status);

    let instrument = null;
    let loadedNotes = new Set();   // Sampler に読み込み済み(または読み込み中)のサンプル
    let pendingSamples = 0;
    let ready = false;             // 鳴らせるか(グランドピアノはサンプルが 1 つ以上届いたら)
    let idleTimer = 0;
    const holder = {};
    let octave = clampOctave(config.startOctave, config.octaves); // 現在の開始オクターブ
    let keyEls = new Map();        // midi -> element
    const sounding = new Map();    // midi -> 押している数(マウスとキーボードで同じ音を押した場合用)
    const pointers = new Map();    // pointerId -> midi
    const pressed = new Map();     // KeyboardEvent.code -> midi

    const range = () => {
      const low = 12 * (octave + 1); // C(octave) の MIDI 番号
      return { low, high: low + config.octaves * 12 };
    };

    const setStatus = (text) => {
      status.textContent = text;
      status.hidden = !text;
    };

    // 音源は最初に鍵盤を押したときに用意する(触れただけでは読み込まない)。
    // Tone.js 自体がまだ読み込まれていなければ null を返す
    const prepare = (midi) => {
      if (instrument) return instrument;
      if (!window.Tone) return null;
      ensureContext();
      holders.add(holder);
      instrument = createInstrument(config);
      ready = !(instrument instanceof Tone.Sampler);
      ensureSamples(midi);
      return instrument;
    };

    // 今の音域で足りないサンプルを読み込む。near(MIDI 番号)に近いものから順に 1 つずつ。
    // 最初の 1 つが届いた時点で、押したままの鍵盤を鳴らす(残りが届く前は、近いサンプルの音程をずらして鳴る)
    const ensureSamples = async (near = range().low) => {
      if (!(instrument instanceof Tone.Sampler)) return;
      const { low, high } = range();
      const missing = samplesFor(low, high).filter((s) => !loadedNotes.has(s.note))
        .sort((a, b) => Math.abs(a.midi - near) - Math.abs(b.midi - near));
      if (!missing.length) return;
      const mine = instrument;
      for (const s of missing) loadedNotes.add(s.note);
      pendingSamples += missing.length;
      setStatus(t('piano_loading'));
      for (const s of missing) {
        let buffer;
        try {
          buffer = await loadSample(s.file, { mono: config.quality === 'mono' });
        } catch (err) {
          console.error(err);
          if (instrument === mine) setStatus(t('piano_load_failed'));
          return;
        }
        if (instrument !== mine) return; // 読み込み中に捨てられた
        instrument.add(s.note, buffer);
        if (!ready) {
          ready = true;
          for (const [midi, velocity] of velocities) instrument.triggerAttack(noteName(midi), Tone.immediate(), velocity);
        }
        if (--pendingSamples === 0) setStatus('');
      }
    };

    const disposeInstrument = () => {
      clearTimeout(idleTimer);
      instrument?.releaseAll?.();
      instrument?.dispose();
      instrument = null;
      ready = false;
      loadedNotes = new Set();
      pendingSamples = 0;
      setStatus('');
      releaseContext(holder);
    };

    // しばらく弾かなければ音源を捨てる。次に押したときに読み込み直す
    const touch = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (sounding.size) touch(); // 押したままなら待つ
        else disposeInstrument();
      }, IDLE_MS());
    };

    const updateBar = () => {
      const { low, high } = range();
      rangeLabel.textContent = `${noteName(low)} – ${noteName(high)}`;
      down.disabled = octave <= MIN_OCTAVE;
      up.disabled = octave >= maxOctave(config.octaves);
      bar.hidden = !config.showOctaveControls;
    };

    const shiftOctave = (delta) => {
      const next = clampOctave(octave + delta, config.octaves);
      if (next === octave) return;
      octave = next;
      if (config.rememberOctave) {
        config.startOctave = octave;
        ctx.save({ startOctave: octave });
      }
      build();
      ensureSamples();
    };

    const velocities = new Map(); // midi -> 押している鍵盤の強さ(サンプルが届いたときに鳴らす用)
    const noteOn = (midi, velocity) => {
      const count = sounding.get(midi) ?? 0;
      sounding.set(midi, count + 1);
      keyEls.get(midi)?.classList.add('on');
      if (count > 0) return;
      velocities.set(midi, velocity);
      const inst = prepare(midi);
      if (!inst) return;
      touch();
      Tone.start(); // ユーザー操作の中で AudioContext を再開する(prepare でコンテキストを差し替えた後に呼ぶ)
      if (!ready) return; // サンプルが届いたら鳴らす
      inst.triggerAttack(noteName(midi), Tone.immediate(), velocity);
    };

    const noteOff = (midi) => {
      const count = sounding.get(midi) ?? 0;
      if (count === 0) return;
      if (count > 1) {
        sounding.set(midi, count - 1);
        return;
      }
      sounding.delete(midi);
      velocities.delete(midi);
      keyEls.get(midi)?.classList.remove('on');
      if (instrument && ready) instrument.triggerRelease(noteName(midi), Tone.immediate());
    };

    const allOff = () => {
      for (const midi of [...sounding.keys()]) {
        sounding.set(midi, 1);
        noteOff(midi);
      }
      pointers.clear();
      pressed.clear();
    };

    const build = () => {
      allOff();
      const { low, high } = range();
      const whiteCount = [...Array(high - low + 1).keys()].filter((i) => !BLACK.has(i % 12)).length;
      keys.style.setProperty('--white-count', whiteCount);
      keyEls = new Map();

      let whiteIndex = 0;
      const els = [];
      for (let midi = low; midi <= high; midi++) {
        const i = midi - low;
        const black = BLACK.has(i % 12);
        const key = el('div', { className: black ? 'pk pk-black' : 'pk pk-white' });
        key.dataset.midi = midi;
        if (black) key.style.setProperty('--pos', whiteIndex);
        else whiteIndex++;

        const labels = [];
        if (config.showKeyLabels && i < KEY_LABELS.length) labels.push(KEY_LABELS[i]);
        if (config.showNoteNames && !black) labels.push(noteName(midi));
        if (labels.length) key.append(el('span', { className: 'pk-label', textContent: labels.join('\n') }));

        keyEls.set(midi, key);
        els.push(key);
      }
      keys.replaceChildren(...els);
      updateBar();
    };

    for (const [btn, delta] of [[down, -1], [up, 1]]) {
      btn.addEventListener('click', () => {
        shiftOctave(delta);
        keys.focus(); // そのまま PC キーボードで弾けるように
      });
    }

    // 鍵盤の手前(下側)を押すほど強く鳴らす
    const velocityAt = (key, e) => {
      const r = key.getBoundingClientRect();
      return Math.min(1, Math.max(0.3, 0.3 + 0.7 * ((e.clientY - r.top) / r.height)));
    };

    // ---- マウス / タッチ(押したまま横になぞるとグリッサンド) ----
    keys.addEventListener('pointerdown', (e) => {
      const key = e.target.closest('.pk');
      if (!key || e.button !== 0) return;
      e.preventDefault();
      keys.focus();
      if (key.hasPointerCapture(e.pointerId)) key.releasePointerCapture(e.pointerId); // タッチでも pointerover を受け取るため
      const midi = Number(key.dataset.midi);
      pointers.set(e.pointerId, midi);
      noteOn(midi, velocityAt(key, e));
    });
    keys.addEventListener('pointerover', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const key = e.target.closest('.pk');
      const midi = Number(key?.dataset.midi);
      const prev = pointers.get(e.pointerId);
      if (!key || midi === prev) return;
      noteOff(prev);
      pointers.set(e.pointerId, midi);
      noteOn(midi, velocityAt(key, e));
    });
    const release = (e) => {
      if (!pointers.has(e.pointerId)) return;
      noteOff(pointers.get(e.pointerId));
      pointers.delete(e.pointerId);
    };
    keys.addEventListener('pointerleave', release);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    // ---- PC キーボード(ピアノにフォーカスがあるときだけ) ----
    keys.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        shiftOctave(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      const i = KEYMAP.indexOf(e.code);
      if (i === -1 || i > config.octaves * 12) return;
      e.preventDefault();
      if (pressed.has(e.code)) return;
      const midi = range().low + i;
      pressed.set(e.code, midi);
      noteOn(midi, 0.8);
    });
    keys.addEventListener('keyup', (e) => {
      if (!pressed.has(e.code)) return;
      noteOff(pressed.get(e.code));
      pressed.delete(e.code);
    });
    keys.addEventListener('blur', allOff);

    build();
    setStatus('');

    let mounted = true;
    // Tone.js(スクリプト)だけは先に読んでおく。音源(サンプル・AudioContext)は鍵盤を押すまで作らない
    loadTone()
      .catch((err) => {
        console.error(err);
        if (mounted) setStatus(t('piano_tone_failed'));
      });

    return {
      update(cfg) {
        config = cfg;
        octave = clampOctave(cfg.startOctave, cfg.octaves);
        disposeInstrument(); // 音色・音域・音量が変わり得るので作り直す(次に鍵盤を押したときに用意される)
        build();
      },
      unmount() {
        mounted = false;
        allOff();
        disposeInstrument();
        window.removeEventListener('pointerup', release);
        window.removeEventListener('pointercancel', release);
      },
    };
  },
};
