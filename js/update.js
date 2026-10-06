// 更新の確認(パッケージ化しないで読み込んで配った人向け)。確認先は配布用の公開リポジトリ(tools/release.mjs で作る)
//
// GitHub の main にある manifest.json の version と、今の version を比べる。新しければツールバーで知らせ、
// 更新のしかた(git pull か ZIP の上書き)と「再読み込み」ボタンを出す。ファイルの入れ替えは利用者が行う
// (拡張機能は自分のフォルダを書き換えられないため)。
// 確認は新規タブを開くたびではなく、UPDATE_INTERVAL ごと(chrome.storage.local にキャッシュ)。
// 配るときは manifest.json の version を上げること(上げないと知らせが出ない)。
// テストでは globalThis.UPDATE_MANIFEST_URL で確認先を変える
import { t } from './i18n.js';

export const REPO_URL = 'https://github.com/hatopoppoppo/widget-newtab';
export const ZIP_URL = `${REPO_URL}/archive/refs/heads/main.zip`;
export const FEEDBACK_URL = 'https://forms.gle/cfhFQ6WW6g3RCLGK9'; // 不具合の報告(Google フォーム)
const MANIFEST_URL = () => globalThis.UPDATE_MANIFEST_URL ?? 'https://raw.githubusercontent.com/hatopoppoppo/widget-newtab/main/manifest.json';
const CACHE_KEY = 'update:check';       // { at, latest }(latest は確認できなければ null)
const DISMISS_KEY = 'update:dismissed'; // 「このバージョンは知らせない」を選んだ version
const UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
const TIMEOUT = 8000;

export const currentVersion = () => chrome.runtime.getManifest().version;

// '2.10.0' と '2.9.1' のような version を比べる(a が新しければ正、同じなら 0)
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

// { current, latest, available, dismissed, error }。force で間隔を待たずに確認する
export async function checkForUpdate({ force = false } = {}) {
  const current = currentVersion();
  const cached = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY];
  let latest = cached?.latest ?? null;
  let error = null;
  if (force || !cached || Date.now() - cached.at > UPDATE_INTERVAL) {
    try {
      const res = await fetch(MANIFEST_URL(), { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      latest = (await res.json()).version ?? null;
    } catch (err) {
      console.warn('更新を確認できませんでした', err);
      latest = null;
      error = t('update_check_failed');
    }
    // 失敗も覚えておき、次の確認まで何度も問い合わせない
    await chrome.storage.local.set({ [CACHE_KEY]: { at: Date.now(), latest } });
  }
  const available = !!latest && compareVersions(latest, current) > 0;
  const dismissed = (await chrome.storage.local.get(DISMISS_KEY))[DISMISS_KEY] === latest;
  return { current, latest, available, dismissed, error };
}

export const dismissUpdate = (version) => chrome.storage.local.set({ [DISMISS_KEY]: version });

// ---- 更新ヘルパー(native/。Windows 用の Native Messaging のホスト) ----
// 利用者が native\install.bat で登録しておくと、「今すぐ更新」でファイルの入れ替えまでできる。
// 登録していなければ(Mac など)手動で入れ替える手順を出す
const HELPER = 'com.hatopoppoppo.widget_newtab';

// ヘルパーが登録されていて応答するか
export async function helperAvailable() {
  try {
    return (await chrome.runtime.sendNativeMessage(HELPER, { command: 'version' }))?.ok === true;
  } catch {
    return false;
  }
}

// ヘルパーに最新版への入れ替えを頼む。入れ替えたあとの version を返す
export async function updateWithHelper() {
  const reply = await chrome.runtime.sendNativeMessage(HELPER, { command: 'update' });
  if (!reply?.ok) throw new Error(reply?.error ?? 'no reply');
  return reply.version;
}

// ファイルを入れ替えたあとに、拡張機能を読み込み直す(開いている新規タブも読み込み直される)
export const reloadExtension = () => chrome.runtime.reload();
