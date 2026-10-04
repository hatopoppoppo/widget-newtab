// ウィジェットの登録
//
// 各ウィジェットは次の形のオブジェクトを default export する:
// {
//   type: 'clock',                    // 保存データに使う一意な名前(変更しないこと)
//   name: '日付時間',                  // 追加ダイアログ等での表示名
//   description: '...',
//   shareable?: true,                 // ほかのレイアウトにも同じもの(中身を共有)を置けるようにする(ToDo・メモなど中身を持つもの)
//   size: { w, h, minW?, minH?, maxW?, maxH? },   // 24 列の正方形グリッド上の初期サイズ(マス数)
//   defaults: { ... },                // 設定の初期値
//   fields: [...] | (config) => [...],// 設定項目(ui.js の editSettings 参照)
//   removed?(id),                     // ウィジェットが削除されたとき(sync・local の data:<id> 以外に置いたデータを消す)
//   mount(el, config, ctx) {          // el に描画する
//     return { update?(config), unmount?() };  // update が無い場合は設定変更時に再マウントされる
//   },
// }
// ctx: {
//   id,
//   save(patch),          ウィジェット自身が設定を書き換えたいとき用(検索エンジンの切り替えなど)
//   requireHeight(px),    中身に最低限必要な高さ(el の内側の px)。これより小さくリサイズできなくなり、
//                         足りなければ自動で伸びる。0 で解除(size.minH だけに戻る)
//   setMinSize({ w, h }), 最小のマス数。null で解除
//   gridSize(),           今のマス数と間隔 { w, h, margin }
//   data: { load(), save(value), subscribe(fn), key }
//                         ウィジェットごとのデータ(sync の data:<id>)。設定とは別に中身の多いデータを置く。
//                         ウィジェットを削除すると消える。subscribe には他のタブ・バックグラウンドでの変更も届く
// }

import clock from './clock.js';
import search from './search.js';
import bookmarks from './bookmarks.js';
import piano from './piano.js';
import links from './links.js';
import youtube from './youtube.js';
import weather from './weather.js';
import todo from './todo.js';
import memo from './memo.js';
import timer from './timer.js';
import reminder from './reminder.js';
import photo from './photo.js';
import switchbot from './switchbot.js';

export const WIDGETS = [clock, weather, todo, reminder, memo, timer, search, links, bookmarks, photo, youtube, piano, switchbot];

const byType = new Map(WIDGETS.map((w) => [w.type, w]));
export const getWidget = (type) => byType.get(type);
