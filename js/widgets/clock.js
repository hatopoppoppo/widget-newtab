import { el } from '../ui.js';
import { t } from '../i18n.js';

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function timeZoneOptions() {
  return [
    { value: '', label: t('clock_local_tz', { tz: LOCAL_TZ }) },
    ...Intl.supportedValuesOf('timeZone').map((tz) => ({ value: tz, label: tz })),
  ];
}

// "America/New_York" -> "New York"
const cityName = (tz) => tz.split('/').pop().replaceAll('_', ' ');

// 時刻の文字の幅の見積もり(em)。午前・午後(dayPeriod)は小さく(.clock-period)表示する
const PERIOD_SCALE = 0.45;
const charWidth = (c) => (c.charCodeAt(0) >= 0x3000 ? 1 : c === ':' ? 0.32 : c === ' ' ? 0.25 : 0.6);
const textWidth = (parts) => parts.reduce((sum, p) => sum + [...p.value].reduce((w, c) => w + charWidth(c), 0) * (p.type === 'dayPeriod' ? PERIOD_SCALE : 1), 0);
// 「00:00」の幅を 1 として、それより長い表示(秒・午前午後)は数字を縮めて枠に収める(--fit)
const BASE_WIDTH = textWidth([{ type: 'hour', value: '00:00' }]);

export default {
  type: 'clock',
  name: t('clock_name'),
  description: t('clock_description'),
  size: { w: 6, h: 2, minW: 3, minH: 1 },
  defaults: {
    timeZone: '',
    label: '',
    hour12: false,
    showSeconds: false,
    showDate: true,
    showOffset: true,
  },
  fields: [
    { key: 'timeZone', label: t('clock_timezone'), type: 'select', options: timeZoneOptions },
    { key: 'label', label: t('clock_label'), type: 'text', placeholder: t('clock_label_placeholder') },
    { key: 'hour12', label: t('clock_hour12'), type: 'checkbox' },
    { key: 'showSeconds', label: t('clock_show_seconds'), type: 'checkbox' },
    { key: 'showDate', label: t('clock_show_date'), type: 'checkbox' },
    { key: 'showOffset', label: t('clock_show_offset'), type: 'checkbox', when: (v) => !!v.timeZone },
  ],

  mount(root, config) {
    const label = el('div', { className: 'clock-label' });
    const time = el('div', { className: 'clock-time' });
    const date = el('div', { className: 'clock-date' });
    root.append(el('div', { className: 'clock' }, label, time, date));

    let timeFmt, dateFmt, offsetFmt, timer;

    const tick = () => {
      const now = new Date();
      time.replaceChildren(...timeFmt.formatToParts(now).map((p) => (p.type === 'dayPeriod' ? el('span', { className: 'clock-period', textContent: p.value }) : p.value)));
      if (config.showDate) date.textContent = dateFmt.format(now);
      if (offsetFmt) {
        const offset = offsetFmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value;
        label.dataset.offset = offset ?? '';
      }
    };

    const apply = (cfg) => {
      config = cfg;
      const timeZone = cfg.timeZone || undefined;
      timeFmt = new Intl.DateTimeFormat(t('locale'), {
        timeZone, hour: '2-digit', minute: '2-digit', hour12: cfg.hour12,
        ...(cfg.showSeconds && { second: '2-digit' }),
      });
      time.style.setProperty('--fit', Math.min(1, BASE_WIDTH / textWidth(timeFmt.formatToParts(new Date(2000, 0, 1, 23, 59, 59)))));
      dateFmt = new Intl.DateTimeFormat(t('locale'), { timeZone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      offsetFmt = cfg.timeZone && cfg.showOffset ? new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }) : null;

      label.textContent = cfg.label || (cfg.timeZone ? cityName(cfg.timeZone) : '');
      label.hidden = !label.textContent;
      if (!offsetFmt) delete label.dataset.offset;
      date.hidden = !cfg.showDate;

      clearInterval(timer);
      tick();
      // 秒を出さないときも 1 秒ごとに更新(分の切り替わりのズレを避けるため。処理は軽い)
      timer = setInterval(tick, 1000);
    };

    apply(config);
    return {
      update: apply,
      unmount: () => clearInterval(timer),
    };
  },
};
