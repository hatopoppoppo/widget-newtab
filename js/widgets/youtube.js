import { el } from '../ui.js';
import { t } from '../i18n.js';

// プレーヤーの埋め込みは 1 つで 150MB 以上メモリを使う。そこで自動再生でなければ、最初はサムネイルと ▶ だけを出し、
// クリックされてから埋め込む(YouTube の「Lite embed」と同じ考え方)

// 拡張機能のページから YouTube を埋め込むと Referer が付かず、プレイヤーが「エラー 153(動画プレーヤーの設定エラー)」になる。
// そこで declarativeNetRequest のセッションルールで、この拡張機能から出た埋め込みのリクエストにだけ Referer を付ける。
// 拡張機能の ID は環境ごとに違うので、静的ルールではなく実行時に登録する(ブラウザを閉じると消えるので毎回登録し直す)
const RULE_ID = 1;
let ruleReady = null;
function ensureRefererRule() {
  ruleReady ??= chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [RULE_ID],
    addRules: [{
      id: RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'referer', operation: 'set', value: `chrome-extension://${chrome.runtime.id}/` }],
      },
      condition: {
        requestDomains: ['www.youtube.com', 'www.youtube-nocookie.com'],
        initiatorDomains: [chrome.runtime.id], // 他のサイトに埋め込まれた YouTube には影響させない
        resourceTypes: ['sub_frame'],
      },
    }],
  });
  return ruleReady;
}

// "90" / "1m30s" / "1h2m3s" -> 秒
function parseTime(t) {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0) : 0;
}

const VIDEO_ID = /^[\w-]{11}$/;

// YouTube の各種 URL から { videoId, listId, start } を取り出す。動画 ID だけの入力も受け付ける
export function parseYouTubeUrl(text) {
  const s = text.trim();
  if (VIDEO_ID.test(s)) return { videoId: s, listId: null, start: 0 };
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const params = url.searchParams;
  const start = parseTime(params.get('t') ?? params.get('start'));
  const listId = params.get('list');
  let videoId = null;

  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, id] = url.pathname.split('/');
    if (kind === 'watch') videoId = params.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(kind) && id !== 'videoseries') videoId = id;
  } else {
    return null;
  }
  if (videoId && !VIDEO_ID.test(videoId)) videoId = null;
  if (!videoId && !listId) return null;
  return { videoId, listId, start };
}

// 埋め込み用の URL を組み立てる
export function embedUrl({ videoId, listId, start }, cfg) {
  const host = cfg.privacy ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com';
  const url = new URL(videoId ? `${host}/embed/${videoId}` : `${host}/embed/videoseries`);
  const p = url.searchParams;
  if (listId) p.set('list', listId);
  if (start) p.set('start', start);
  if (cfg.autoplay) p.set('autoplay', '1');
  if (cfg.mute) p.set('mute', '1');
  if (cfg.loop) {
    p.set('loop', '1');
    if (videoId && !listId) p.set('playlist', videoId); // 1 本の動画をループするには playlist に自分を指定する
  }
  if (!cfg.controls) p.set('controls', '0');
  p.set('rel', '0'); // 終了後の関連動画を同じチャンネルのものに限る
  return url.href;
}

// サムネイル。maxresdefault(1280×720)は無い動画もあるので、読めなければ hqdefault(480×360、上下に黒帯)にする。
// hqdefault の黒帯は、16:9 の枠に object-fit: cover で入れるとちょうど切り落とされる
const thumbnailUrl = (videoId, size) => `https://i.ytimg.com/vi/${videoId}/${size}.jpg`;

// 動画のタイトル(oEmbed。API キー不要)。取れなければ null
async function fetchTitle(url) {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
    return res.ok ? (await res.json()).title ?? null : null;
  } catch {
    return null;
  }
}

export default {
  type: 'youtube',
  name: 'YouTube',
  description: t('youtube_description'),
  size: { w: 8, h: 5, minW: 4, minH: 3 },
  defaults: {
    url: '',
    autoplay: false,
    mute: false,
    loop: false,
    controls: true,
    privacy: false,
  },
  fields: [
    {
      key: 'url', label: t('youtube_url'), type: 'text',
      placeholder: 'https://www.youtube.com/watch?v=...',
      hint: t('youtube_url_hint'),
    },
    { key: 'autoplay', label: t('youtube_autoplay'), type: 'checkbox', hint: t('youtube_autoplay_hint') },
    { key: 'mute', label: t('youtube_mute'), type: 'checkbox' },
    { key: 'loop', label: t('youtube_loop'), type: 'checkbox' },
    { key: 'controls', label: t('youtube_controls'), type: 'checkbox' },
    { key: 'privacy', label: t('youtube_privacy'), type: 'checkbox', hint: t('youtube_privacy_hint') },
  ],

  mount(root, config) {
    const target = config.url ? parseYouTubeUrl(config.url) : null;
    if (!target) {
      root.append(el('p', {
        className: 'wg-message',
        textContent: config.url ? t('youtube_bad_url') : t('youtube_no_url'),
      }));
      return {};
    }
    // manifest に権限を追加した後、chrome://extensions で再読み込みしていないと API が無い
    if (!chrome.declarativeNetRequest) {
      root.append(el('p', {
        className: 'wg-message',
        textContent: t('youtube_no_permission'),
      }));
      return {};
    }
    let alive = true;
    let frame = null;
    // プレーヤーを埋め込む。サムネイルから再生するときは autoplay を付ける(クリックしたのに止まったままにならないように)
    const play = (cfg) => {
      frame = el('iframe', {
        className: 'yt-frame',
        title: 'YouTube',
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write',
        allowFullscreen: true,
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      root.replaceChildren(frame);
      // ルールの登録が終わる前に読み込むとエラー 153 になるので、待ってから src を入れる
      ensureRefererRule().catch((err) => console.error('Referer ルールを登録できませんでした', err)).then(() => {
        if (alive) frame.src = embedUrl(target, cfg);
      });
    };

    if (config.autoplay) {
      play(config);
    } else {
      const poster = el('button', { type: 'button', className: 'yt-poster', title: t('youtube_play') });
      if (target.videoId) {
        const img = el('img', { className: 'yt-thumb', alt: '', src: thumbnailUrl(target.videoId, 'maxresdefault') });
        const fallback = () => {
          if (!img.src.includes('hqdefault')) img.src = thumbnailUrl(target.videoId, 'hqdefault');
          else img.remove(); // オフラインなど。黒い背景と ▶ だけにする
        };
        img.addEventListener('error', fallback);
        // 無いサイズは 404 でも灰色の仮の画像(120×90)が返ってきて表示されてしまうので、大きさで見分ける
        img.addEventListener('load', () => { if (img.naturalWidth <= 120) fallback(); });
        poster.append(img);
      }
      const title = el('span', { className: 'yt-title', textContent: target.videoId ? '' : t('youtube_playlist') });
      const icon = el('span', { className: 'yt-play' });
      icon.setAttribute('aria-hidden', 'true');
      poster.append(title, icon);
      poster.addEventListener('click', () => play({ ...config, autoplay: true }));
      root.append(poster);
      fetchTitle(config.url).then((t) => {
        if (t && alive) title.textContent = t;
      });
    }
    return {
      unmount() {
        alive = false;
        if (frame) frame.src = 'about:blank';
      },
    };
  },
};
