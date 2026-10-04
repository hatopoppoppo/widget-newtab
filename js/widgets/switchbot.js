import { el, icon } from '../ui.js';
import { t } from '../i18n.js';
import { listRemotes, sendCommand, hasCredentials, acParameter, AC_MODES, AC_FANS, AC_TEMP } from '../switchbot.js';

// SwitchBot: ハブに赤外線リモコンとして登録した照明・エアコンを操作する。
// 赤外線の機器は今の状態を返さないので、最後に送った設定をウィジェットのデータ(sync の data:<id>)に残して表示する。
//   { [deviceId]: { power, temp, mode, fan, at } }(照明は power と at だけ)
// エアコンの温度・モード・風量は、続けて押したときにまとめて 1 回で送る(API の回数と、リモコンの信号の連打を減らす)

const SEND_DELAY = 700;
const MIN_ROW_GAP = 6; // カードの中の行の間隔(css の .sb-card の gap と同じ)
const AC_DEFAULT = { power: false, temp: 26, mode: 'cool', fan: 'auto' };

const kindLabel = (kind) => t(`switchbot_kind_${kind}`);
const timeLabel = (at) => {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return d.toLocaleString(t('locale'), today ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default {
  type: 'switchbot',
  name: 'SwitchBot',
  description: t('switchbot_description'),
  size: { w: 6, h: 6, minW: 4, minH: 3 },
  defaults: { devices: [] },
  fields: [
    {
      key: 'devices', label: t('switchbot_devices'), type: 'multicheck', hint: t('switchbot_devices_hint'), empty: t('switchbot_no_remotes'),
      // 設定を開いたときは、アプリで登録し直した分も出るように取り直す
      options: async () => (await listRemotes({ force: true }))
        .map((r) => ({ value: r.id, label: t('switchbot_device_label', { name: r.name, kind: kindLabel(r.kind) }) })),
    },
  ],

  mount(root, config, ctx) {
    let alive = true;
    let states = {};
    const cards = new Map(); // deviceId -> { render() }
    const message = (text) => {
      list = null;
      ctx.requireHeight(0);
      root.replaceChildren(el('p', { className: 'wg-message', textContent: text }));
    };

    async function start() {
      if (!(await hasCredentials())) return message(t('switchbot_no_token'));
      if (!config.devices.length) return message(t('switchbot_no_devices'));
      let remotes;
      try {
        remotes = await listRemotes();
      } catch (err) {
        return message(err.message);
      }
      if (!alive) return;
      const shown = remotes.filter((r) => config.devices.includes(r.id));
      if (!shown.length) return message(t('switchbot_missing'));
      states = (await ctx.data.load()) ?? {};
      list = el('div', { className: `sb-list${shown.length === 1 ? ' single' : ''}` }, shown.map((r) => deviceCard(r)));
      root.replaceChildren(list);
      fit();
    }

    // カードはウィジェットいっぱいに伸ばす(CSS)。
    // 入りきらない高さには縮められないよう、行を詰めたときに必要な高さを伝える(スクロールさせない)
    let list = null;
    function fit() {
      if (!list?.isConnected) return ctx.requireHeight(0);
      const cards = [...list.children];
      const style = getComputedStyle(list);
      const columns = style.gridTemplateColumns.split(' ').length;
      // カードの中身の高さ(伸ばす前)
      const contentHeight = (card) => {
        const cs = getComputedStyle(card);
        const parts = [...card.children];
        return parts.reduce((sum, c) => sum + c.offsetHeight, 0) + MIN_ROW_GAP * (parts.length - 1)
          + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      };
      // 行ごとに、その行でいちばん高いカードの分だけ要る(照明だけの行は低くてよい)
      let total = 0;
      for (let i = 0; i < cards.length; i += columns) total += Math.max(...cards.slice(i, i + columns).map(contentHeight));
      const rows = Math.ceil(cards.length / columns);
      const gap = parseFloat(style.rowGap) || 0;
      ctx.requireHeight(Math.ceil(total + (rows - 1) * gap + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)));
    }
    // 幅が変わると 1 行に並ぶカードの数が変わる
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(root);

    const saveState = (id, state) => {
      states = { ...states, [id]: state };
      return ctx.data.save(states);
    };

    function deviceCard(remote) {
      const isAc = remote.kind === 'ac' || remote.kind === 'diy_ac';
      const status = el('p', { className: 'sb-status' });
      const card = el('section', { className: `sb-card sb-${remote.kind}` },
        el('header', { className: 'sb-head' },
          el('h3', { className: 'sb-name', textContent: remote.name }),
          el('span', { className: 'sb-kind', textContent: kindLabel(remote.kind) })));
      card.dataset.id = remote.id;
      const state = () => ({ ...(isAc ? AC_DEFAULT : { power: false }), ...states[remote.id] });

      // 送る。成功したら state を保存する
      let pending = null; // 送る前の、まとめている途中のエアコンの設定
      let timer = null;
      async function send(command, parameter, next) {
        status.textContent = t('switchbot_sending');
        status.classList.remove('error');
        card.classList.add('busy');
        try {
          await sendCommand(remote.id, command, parameter);
          await saveState(remote.id, { ...next, at: Date.now() });
        } catch (err) {
          if (!alive) return;
          status.textContent = err.message;
          status.classList.add('error');
          card.classList.remove('busy');
          return;
        }
        if (!alive) return;
        card.classList.remove('busy');
        render();
      }
      const sendAc = (next) => send('setAll', acParameter(next), next);

      const button = (label, onClick, name = '') => {
        const b = el('button', { type: 'button', className: `sb-btn ${name}`.trim(), textContent: label });
        b.addEventListener('click', onClick);
        return b;
      };

      // 電源
      const onBtn = button(t('switchbot_on'), () => {
        clearTimeout(timer);
        pending = null;
        if (remote.kind === 'ac') sendAc({ ...state(), power: true });
        else send('turnOn', 'default', { ...state(), power: true });
      }, 'sb-on');
      const offBtn = button(t('switchbot_off'), () => {
        clearTimeout(timer);
        pending = null;
        send('turnOff', 'default', { ...state(), power: false });
      }, 'sb-off');
      card.append(el('div', { className: 'sb-row sb-power' }, onBtn, offBtn));

      // 照明の明るさ
      if (remote.kind === 'light') {
        card.append(el('div', { className: 'sb-row' },
          button(t('switchbot_brighter'), () => send('brightnessUp', 'default', { ...state(), power: true }), 'sb-brighter'),
          button(t('switchbot_darker'), () => send('brightnessDown', 'default', { ...state(), power: true }), 'sb-darker')));
      }

      // エアコンの温度・モード・風量。変えるとつけて送る(続けて変えたら最後の 1 回だけ)
      let tempOut;
      const segments = {};
      if (remote.kind === 'ac') {
        const change = (patch) => {
          pending = { ...(pending ?? state()), ...patch, power: true };
          render();
          clearTimeout(timer);
          timer = setTimeout(() => {
            const next = pending;
            pending = null;
            sendAc(next);
          }, SEND_DELAY);
        };
        tempOut = el('output', { className: 'sb-temp' });
        const step = (d) => {
          const cur = (pending ?? state()).temp;
          change({ temp: Math.min(AC_TEMP.max, Math.max(AC_TEMP.min, cur + d)) });
        };
        card.append(el('div', { className: 'sb-row sb-temp-row' },
          el('button', { type: 'button', className: 'sb-btn sb-step sb-temp-down', title: t('switchbot_temp_down'), textContent: '−' }),
          tempOut,
          el('button', { type: 'button', className: 'sb-btn sb-step sb-temp-up', title: t('switchbot_temp_up'), textContent: '+' })));
        card.querySelector('.sb-temp-down').addEventListener('click', () => step(-1));
        card.querySelector('.sb-temp-up').addEventListener('click', () => step(1));
        for (const [key, label, values] of [['mode', t('switchbot_mode'), Object.keys(AC_MODES)], ['fan', t('switchbot_fan'), Object.keys(AC_FANS)]]) {
          const group = el('div', { className: `sb-seg sb-${key}`, role: 'group', ariaLabel: label },
            values.map((v) => {
              const b = button(t(`switchbot_${key}_${v}`), () => change({ [key]: v }));
              b.dataset.value = v;
              return b;
            }));
          segments[key] = group;
          card.append(el('div', { className: 'sb-row' }, el('span', { className: 'sb-label', textContent: label }), group));
        }
      }
      card.append(status);

      function render() {
        const s = pending ?? state();
        const sent = states[remote.id];
        onBtn.classList.toggle('active', !!sent && s.power);
        offBtn.classList.toggle('active', !!sent && !s.power);
        if (tempOut) tempOut.value = t('switchbot_temp', { temp: s.temp });
        for (const [key, group] of Object.entries(segments)) {
          for (const b of group.children) b.classList.toggle('active', b.dataset.value === s[key]);
        }
        card.classList.toggle('pending', !!pending);
        if (!status.classList.contains('error') || pending) {
          status.classList.remove('error');
          status.textContent = pending ? '' : sent?.at ? t('switchbot_sent', { time: timeLabel(sent.at) }) : '';
        }
      }
      cards.set(remote.id, { render, cancel: () => clearTimeout(timer) });
      render();
      return card;
    }

    // 他のタブ・PC で操作したとき
    const unsubscribe = ctx.data.subscribe((value) => {
      states = value ?? {};
      for (const c of cards.values()) c.render();
    });
    // 全体設定でトークンを入れたとき
    const onStorage = (changes, area) => {
      if (area === 'local' && Object.keys(changes).some((k) => k.startsWith('device:switchbot'))) {
        cards.clear();
        start();
      }
    };
    chrome.storage.onChanged.addListener(onStorage);
    start();

    return {
      unmount() {
        alive = false;
        resizeObserver.disconnect();
        unsubscribe();
        chrome.storage.onChanged.removeListener(onStorage);
        for (const c of cards.values()) c.cancel();
      },
    };
  },
};
