// SwitchBot の API(v1.1)
//
// トークンとシークレットは全体設定の「外部連携 → SwitchBot」で入力し、この PC だけに保存する(device:switchbotToken / Secret)。
// リクエストには、トークン + 時刻 + ランダムな文字列をシークレットで署名した HMAC-SHA256 を付ける(crypto.subtle)。
// API は 1 日 10,000 回まで。機器の一覧は chrome.storage.local にキャッシュし、操作はボタンを押したときだけ送る。
// テストでは globalThis.SWITCHBOT_API で送り先を変える
import { t } from './i18n.js';
import { loadDevicePrefs } from './store.js';

const API = () => globalThis.SWITCHBOT_API ?? 'https://api.switch-bot.com';
const CACHE_KEY = 'switchbot:remotes';
const CACHE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT = 10000;

// 扱う赤外線リモコンの種類。DIY(自分で学習させたもの)は電源の入り切りだけ
export const REMOTE_KINDS = {
  'Light': 'light',
  'DIY Light': 'diy_light',
  'Air Conditioner': 'ac',
  'DIY Air Conditioner': 'diy_ac',
};

// エアコンの setAll の値
export const AC_MODES = { auto: 1, cool: 2, dry: 3, fan: 4, heat: 5 };
export const AC_FANS = { auto: 1, low: 2, medium: 3, high: 4 };
export const AC_TEMP = { min: 16, max: 30 };
// '26,2,1,on'(温度,モード,風量,電源)
export const acParameter = ({ temp, mode, fan, power }) => `${temp},${AC_MODES[mode]},${AC_FANS[fan]},${power ? 'on' : 'off'}`;

// 署名(base64)
export async function sign(token, secret, time, nonce) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token + time + nonce));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

export async function hasCredentials() {
  const { switchbotToken, switchbotSecret } = await loadDevicePrefs();
  return !!(switchbotToken && switchbotSecret);
}

async function request(path, { method = 'GET', body } = {}) {
  const { switchbotToken: token, switchbotSecret: secret } = await loadDevicePrefs();
  if (!token || !secret) throw new Error(t('switchbot_no_token'));
  const time = String(Date.now());
  const nonce = crypto.randomUUID();
  let res;
  try {
    res = await fetch(API() + path, {
      method,
      headers: {
        'Authorization': token,
        'sign': await sign(token, secret, time, nonce),
        't': time,
        'nonce': nonce,
        'Content-Type': 'application/json; charset=utf8',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (err) {
    console.warn('SwitchBot に接続できませんでした', err);
    throw new Error(t('switchbot_network_error'));
  }
  if (res.status === 401 || res.status === 403) throw new Error(t('switchbot_auth_failed'));
  if (!res.ok) throw new Error(t('switchbot_error', { message: `HTTP ${res.status}` }));
  const json = await res.json();
  if (json.statusCode !== 100) throw new Error(t('switchbot_error', { message: `${json.statusCode} ${json.message ?? ''}`.trim() }));
  return json.body;
}

// 赤外線リモコンのうち扱えるもの [{ id, name, kind }]。force でキャッシュを使わない
export async function listRemotes({ force = false } = {}) {
  if (!force) {
    const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.list;
  }
  const body = await request('/v1.1/devices');
  const list = (body?.infraredRemoteList ?? [])
    .filter((r) => REMOTE_KINDS[r.remoteType])
    .map((r) => ({ id: r.deviceId, name: r.deviceName, kind: REMOTE_KINDS[r.remoteType] }));
  await chrome.storage.local.set({ [CACHE_KEY]: { at: Date.now(), list } });
  return list;
}

export const sendCommand = (deviceId, command, parameter = 'default') =>
  request(`/v1.1/devices/${encodeURIComponent(deviceId)}/commands`, {
    method: 'POST',
    body: { command, parameter, commandType: 'command' },
  });
