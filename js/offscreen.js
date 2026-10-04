// 画面に出ない拡張機能のページ(offscreen document)。バックグラウンドから頼まれて音を鳴らす。
// 新規タブを開いていなくても、ほかのタブを見ていても鳴らせる(バックグラウンドの service worker では音を出せないため)
import { chime } from './chime.js';

// 同じ終了を新規タブとバックグラウンドの両方が処理して 2 回頼まれても、1 回だけ鳴らす
const rung = new Set();
let count = 0; // 鳴らした回数(テストで確かめる)
globalThis.chimeCount = () => count;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'timer-chime' || rung.has(message.key)) return;
  rung.add(message.key);
  count++;
  try {
    chime();
  } catch (err) {
    console.error(err);
  }
});
