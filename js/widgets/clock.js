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
      time.textContent = timeFmt.format(now);
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
