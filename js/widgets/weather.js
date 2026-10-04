import { el } from '../ui.js';
import { t, weekdayNames } from '../i18n.js';

// 天気(Open-Meteo。API キー不要・CORS 対応)
// 取得結果は chrome.storage.local に 30 分キャッシュし、タブやウィジェットの間で共有する
const FORECAST_API = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_API = 'https://geocoding-api.open-meteo.com/v1/search';
const TTL = 30 * 60 * 1000;
const GEO_TTL = 60 * 60 * 1000;

// ---------- 天気コード(WMO)とアイコン ----------

const SUN = '<circle cx="32" cy="32" r="11" fill="#f6b73c"/><path d="M32 7v7M32 50v7M7 32h7M50 32h7M14.3 14.3l5 5M44.7 44.7l5 5M14.3 49.7l5-5M44.7 19.3l5-5" stroke="#f6b73c" stroke-width="4" stroke-linecap="round"/>';
const MOON = '<path d="M38 9a22 22 0 1 0 17 33A17 17 0 0 1 38 9z" fill="#f2c94c"/>';
const CLOUD = '<path d="M19 50h28a11 11 0 0 0 0-22 15 15 0 0 0-28.6 4.5A8.8 8.8 0 0 0 19 50z" fill="#d5dce6" stroke="#98a3b3" stroke-width="2.5" stroke-linejoin="round"/>';
const DARK_CLOUD = '<path d="M26 40h24a9 9 0 0 0 0-18 12 12 0 0 0-23 3.5" fill="#aeb8c6" stroke="#8792a3" stroke-width="2.5" stroke-linejoin="round"/>';
const up = (svg) => `<g transform="translate(0 -9)">${svg}</g>`;
const small = (svg) => `<g transform="translate(-2 -6) scale(.72)">${svg}</g>`;

const ICONS = {
  clear: (day) => (day ? SUN : MOON),
  partly: (day) => small(day ? SUN : MOON) + CLOUD,
  cloudy: () => DARK_CLOUD + CLOUD,
  fog: () => '<path d="M12 22h40M8 32h48M12 42h40" stroke="#98a3b3" stroke-width="4.5" stroke-linecap="round"/>',
  drizzle: () => up(CLOUD) + '<path d="M22 48v4M32 50v4M42 48v4" stroke="#4a90e2" stroke-width="3.5" stroke-linecap="round"/>',
  rain: () => up(CLOUD) + '<path d="M23 46l-3 9M33 46l-3 9M43 46l-3 9" stroke="#4a90e2" stroke-width="3.5" stroke-linecap="round"/>',
  snow: () => up(CLOUD) + '<g fill="#7fb2e5"><circle cx="21" cy="50" r="3"/><circle cx="32" cy="55" r="3"/><circle cx="43" cy="50" r="3"/></g>',
  thunder: () => up(CLOUD) + '<path d="M35 40l-9 12h7l-4 10 12-14h-7l4-8z" fill="#f6b73c" stroke="#d99a1e" stroke-width="1.5" stroke-linejoin="round"/>',
};

// 天気コード → [文言のキー(weather_code_<名前>), アイコン]
const CODES = {
  0: ['clear', 'clear'], 1: ['mainly_clear', 'clear'], 2: ['partly_cloudy', 'partly'], 3: ['overcast', 'cloudy'],
  45: ['fog', 'fog'], 48: ['rime_fog', 'fog'],
  51: ['light_drizzle', 'drizzle'], 53: ['drizzle', 'drizzle'], 55: ['dense_drizzle', 'drizzle'],
  56: ['freezing_drizzle', 'drizzle'], 57: ['freezing_drizzle', 'drizzle'],
  61: ['light_rain', 'rain'], 63: ['rain', 'rain'], 65: ['heavy_rain', 'rain'], 66: ['freezing_rain', 'rain'], 67: ['freezing_rain', 'rain'],
  71: ['light_snow', 'snow'], 73: ['snow', 'snow'], 75: ['heavy_snow', 'snow'], 77: ['snow_grains', 'snow'],
  80: ['showers', 'rain'], 81: ['showers', 'rain'], 82: ['violent_showers', 'rain'],
  85: ['snow_showers', 'snow'], 86: ['heavy_snow_showers', 'snow'],
  95: ['thunderstorm', 'thunder'], 96: ['thunderstorm_hail', 'thunder'], 99: ['thunderstorm_hail', 'thunder'],
};

// [天気の名前, アイコン]
export function describe(code) {
  const [name, icon] = CODES[code] ?? ['unknown', 'cloudy'];
  return [t(`weather_code_${name}`), icon];
}

function weatherIcon(code, day = true) {
  const span = el('span', { className: 'wx-svg', title: describe(code)[0] });
  span.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">${ICONS[describe(code)[1]](day)}</svg>`;
  return span;
}

// ---------- 取得 ----------

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function geocode(query) {
  const url = `${GEOCODING_API}?${new URLSearchParams({ name: query, count: 8, language: t('locale'), format: 'json' })}`;
  const { results = [] } = await getJSON(url);
  return results.map((r) => ({
    label: [r.name, r.admin1, r.country].filter(Boolean).join(t('weather_place_separator')),
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
  }));
}

function forecastUrl(lat, lon, units) {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: 7,
    wind_speed_unit: units === 'fahrenheit' ? 'mph' : 'ms',
    ...(units === 'fahrenheit' && { temperature_unit: 'fahrenheit' }),
  });
  return `${FORECAST_API}?${params}`;
}

// 同じ場所の同時取得は 1 回にまとめる
const inFlight = new Map();

// キャッシュがあれば返し、古ければ取得する。取得に失敗したら古いキャッシュに stale: true を付けて返す
async function loadForecast(lat, lon, units) {
  const key = `weather:${lat.toFixed(3)},${lon.toFixed(3)},${units}`;
  const cached = (await chrome.storage.local.get(key))[key];
  if (cached && Date.now() - cached.at < TTL) return cached;
  if (!inFlight.has(key)) {
    inFlight.set(key, getJSON(forecastUrl(lat, lon, units))
      .then(async (data) => {
        const entry = { at: Date.now(), data };
        await chrome.storage.local.set({ [key]: entry });
        return entry;
      })
      .finally(() => inFlight.delete(key)));
  }
  try {
    return await inFlight.get(key);
  } catch (err) {
    if (cached) return { ...cached, stale: true };
    throw err;
  }
}

// 現在地(manifest の geolocation 権限で、確認なしに取れる)。1 時間キャッシュする
async function currentPosition() {
  const { 'weather:geo': cached } = await chrome.storage.local.get('weather:geo');
  if (cached && Date.now() - cached.at < GEO_TTL) return cached;
  const pos = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000, maximumAge: GEO_TTL });
  });
  const entry = { lat: pos.coords.latitude, lon: pos.coords.longitude, at: Date.now() };
  await chrome.storage.local.set({ 'weather:geo': entry });
  return entry;
}

// ---------- ウィジェット ----------

const round = (t) => `${Math.round(t)}°`;
function dayLabel(dateText, i) {
  if (i === 0) return t('date_today');
  if (i === 1) return t('date_tomorrow');
  return weekdayNames()[new Date(`${dateText}T00:00`).getDay()];
}
const detail = (label, value, { optional = false } = {}) =>
  el('div', { className: optional ? 'wx-detail optional' : 'wx-detail' }, el('dt', { textContent: label }), el('dd', { textContent: value }));
const timeText = (ms) => new Date(ms).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });

export default {
  type: 'weather',
  name: t('weather_name'),
  description: t('weather_description'),
  size: { w: 6, h: 4, minW: 3, minH: 2 },
  defaults: {
    mode: 'search',  // search | current
    place: null,     // { label, name, lat, lon }
    label: '',
    units: 'celsius',
  },
  fields: [
    {
      key: 'mode', label: t('weather_mode'), type: 'select', options: [
        { value: 'search', label: t('weather_mode_search') },
        { value: 'current', label: t('weather_current_location') },
      ],
    },
    { key: 'place', label: t('weather_place'), type: 'search', placeholder: t('weather_place_placeholder'), search: geocode, when: (v) => v.mode === 'search' },
    { key: 'label', label: t('weather_label'), type: 'text', placeholder: t('weather_label_placeholder') },
    {
      key: 'units', label: t('weather_units'), type: 'select', options: [
        { value: 'celsius', label: t('weather_units_celsius') },
        { value: 'fahrenheit', label: t('weather_units_fahrenheit') },
      ],
    },
  ],

  mount(root, config) {
    const wrap = el('div', { className: 'wx' });
    root.append(wrap);
    let alive = true;
    let timer;

    const message = (text) => wrap.replaceChildren(el('p', { className: 'wg-message', textContent: text }));

    const render = ({ data, at, stale }, placeName) => {
      const c = data.current;
      const d = data.daily;
      const [desc] = describe(c.weather_code);
      const windUnit = config.units === 'fahrenheit' ? 'mph' : 'm/s';

      const head = el('div', { className: 'wx-head' },
        el('span', { className: 'wx-place', textContent: placeName }),
        el('span', { className: `wx-updated${stale ? ' stale' : ''}`, textContent: stale ? t('weather_stale', { time: timeText(at) }) : t('weather_updated', { time: timeText(at) }) }));

      const now = el('div', { className: 'wx-now' },
        weatherIcon(c.weather_code, c.is_day === 1),
        el('div', { className: 'wx-main' },
          el('div', { className: 'wx-temp', textContent: round(c.temperature_2m) }),
          el('div', { className: 'wx-desc', textContent: desc })),
        // optional の行は、高さが足りないとき(週間予報と並べるとき)に隠す
        el('dl', { className: 'wx-details' },
          detail(t('weather_high_low'), `${round(d.temperature_2m_max[0])} / ${round(d.temperature_2m_min[0])}`),
          detail(t('weather_feels_like'), round(c.apparent_temperature), { optional: true }),
          detail(t('weather_humidity'), `${Math.round(c.relative_humidity_2m)}%`),
          detail(t('weather_precipitation'), `${d.precipitation_probability_max[0] ?? '-'}%`),
          detail(t('weather_wind'), `${Math.round(c.wind_speed_10m)} ${windUnit}`, { optional: true })));

      // 入りきる日数だけ表示される(CSS で 1 行に収まらない分は隠す)
      const days = el('div', { className: 'wx-days' }, d.time.map((date, i) => el('div', { className: 'wx-day' },
        el('span', { className: 'wx-day-name', textContent: dayLabel(date, i) }),
        weatherIcon(d.weather_code[i]),
        el('span', { className: 'wx-day-temp' },
          el('b', { textContent: round(d.temperature_2m_max[i]) }), ' ', el('span', { textContent: round(d.temperature_2m_min[i]) })),
        el('span', { className: 'wx-day-pop', textContent: `${d.precipitation_probability_max[i] ?? '-'}%` }))));

      wrap.replaceChildren(head, now, days);
    };

    const load = async () => {
      try {
        let lat, lon, placeName;
        if (config.mode === 'current') {
          ({ lat, lon } = await currentPosition());
          placeName = config.label || t('weather_current_location');
        } else {
          if (!config.place) {
            message(t('weather_no_place'));
            return;
          }
          ({ lat, lon } = config.place);
          placeName = config.label || config.place.name;
        }
        if (!wrap.childElementCount) message(t('weather_loading'));
        const result = await loadForecast(lat, lon, config.units);
        if (alive) render(result, placeName);
      } catch (err) {
        if (!alive) return;
        if (err instanceof GeolocationPositionError) {
          message(err.code === 1
            ? t('weather_no_geo_permission')
            : t('weather_geo_failed'));
        } else {
          message(t('weather_failed', { message: err.message }));
        }
      }
    };

    // 新規タブを開いたままでも 30 分ごとに更新する。隠れている間は止め、表示されたときに古ければ取り直す
    const schedule = () => {
      clearInterval(timer);
      timer = setInterval(() => { if (!document.hidden) load(); }, TTL);
    };
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);

    load();
    schedule();
    return {
      unmount() {
        alive = false;
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisible);
      },
    };
  },
};
