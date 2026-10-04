import { el, icon } from '../ui.js';
import { t } from '../i18n.js';
import { dataKey } from '../store.js';
import * as photos from '../photo-store.js';

// 写真 / スライドショー。写真は IndexedDB(js/photo-store.js)に、この PC だけに保存する。
// 枠と写真の縦横比が違うときは、切り抜いて広げるか、全体を表示して余白に同じ写真のぼかしを敷く(chooseFit)。
// メモリを抑えるため、画像の object URL は表示中の 1 枚(切り替えの途中は 2 枚)だけ作り、使い終わったら解放する。
// 今どの写真かは chrome.storage.local の data:<id> に保存し、新しいタブでは続きの写真から始める

const INTERVALS = [0, 10, 30, 60, 300, 900, 3600];
const intervalLabel = (sec) => {
  if (!sec) return t('photo_interval_off');
  if (sec < 60) return t('photo_interval_seconds', { n: sec });
  if (sec < 3600) return t('photo_interval_minutes', { n: sec / 60 });
  return t('photo_interval_hours', { n: sec / 3600 });
};

// 次に見せる写真の番号。random のときは今の写真以外から選ぶ
export function nextIndex(index, count, step, order) {
  if (count <= 1) return 0;
  if (order === 'random') {
    const r = Math.floor(Math.random() * (count - 1));
    return r >= index ? r + 1 : r;
  }
  return (((index + step) % count) + count) % count;
}

function pickFiles() {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept: 'image/*', multiple: true });
    input.addEventListener('change', () => resolve([...input.files]));
    input.click();
  });
}

export default {
  type: 'photo',
  name: t('photo_name'),
  shareable: true, // 中身を持つので、ほかのレイアウトにも同じものを置く意味がある
  description: t('photo_description'),
  size: { w: 6, h: 4, minW: 2, minH: 2 },
  defaults: {
    fit: 'auto',
    interval: 60,
    order: 'sequential',
  },
  fields: [
    {
      key: 'fit', label: t('photo_fit'), type: 'select', hint: t('photo_fit_hint'), options: [
        { value: 'auto', label: t('photo_fit_auto') },
        { value: 'cover', label: t('photo_fit_cover') },
        { value: 'contain', label: t('photo_fit_contain') },
      ],
    },
    { key: 'interval', label: t('photo_interval'), type: 'select', options: INTERVALS.map((s) => ({ value: s, label: intervalLabel(s) })) },
    {
      key: 'order', label: t('photo_order'), type: 'select', options: [
        { value: 'sequential', label: t('photo_order_sequential') },
        { value: 'random', label: t('photo_order_random') },
      ],
    },
  ],

  // ウィジェットを削除したら写真も消す
  removed(id) {
    return photos.removeOwner(id);
  },

  mount(root, config, ctx) {
    let cfg = config;
    let list = [];           // 写真(Blob は IndexedDB から読んだときのまま。表示するまで展開しない)
    let index = 0;
    let current = null;      // { slide, photo, urls }
    let leaving = null;      // フェードで消えていく前の写真
    let leavingTimer = null;
    let timer = null;
    let alive = true;
    let busy = false;        // 追加の途中
    let showing = Promise.resolve();
    const posKey = dataKey(ctx.id);

    const stage = el('div', { className: 'ph-stage' });
    const counter = el('span', { className: 'ph-counter' });
    const prevBtn = el('button', { type: 'button', className: 'ph-nav ph-prev', title: t('photo_prev') }, icon('chevron'));
    const nextBtn = el('button', { type: 'button', className: 'ph-nav ph-next', title: t('photo_next') }, icon('chevron'));
    const addBtn = el('button', { type: 'button', className: 'ph-btn ph-add', title: t('photo_add') }, icon('plus'));
    const delBtn = el('button', { type: 'button', className: 'ph-btn ph-delete', title: t('photo_delete') }, icon('trash'));
    const tools = el('div', { className: 'ph-tools' }, counter, addBtn, delBtn);
    const status = el('p', { className: 'ph-status', hidden: true });
    const empty = el('div', { className: 'ph-empty', hidden: true },
      el('p', { className: 'wg-message', textContent: t('photo_empty') }),
      el('button', { type: 'button', className: 'btn ph-empty-add' }, icon('plus'), t('photo_add')),
      el('p', { className: 'ph-hint', textContent: t('photo_empty_hint') }));
    root.append(stage, prevBtn, nextBtn, tools, empty, status);

    // ---------- 表示 ----------

    const applyFit = (slide, photo) => {
      const fit = photos.chooseFit(cfg.fit, { width: root.clientWidth, height: root.clientHeight }, photo);
      slide.classList.toggle('contain', fit === 'contain');
    };

    function release(entry) {
      entry.slide.remove();
      for (const url of entry.urls) URL.revokeObjectURL(url);
    }

    // list[index] を表示する。前の写真からは重ねてフェードで切り替える
    function show() {
      showing = showing.then(async () => {
        if (!alive) return;
        const photo = list[index];
        if (!photo) {
          if (current) release(current);
          current = null;
          return;
        }
        if (current?.photo.id === photo.id) return;
        const urls = [URL.createObjectURL(photo.thumb), URL.createObjectURL(photo.image)];
        const blur = el('img', { className: 'ph-blur', alt: '', src: urls[0] });
        const img = el('img', { className: 'ph-img', alt: photo.name, src: urls[1] });
        const slide = el('div', { className: 'ph-slide' }, blur, img);
        applyFit(slide, photo);
        try {
          await img.decode(); // 読み込みが終わってから重ねる(途中の白い画面を見せない)
        } catch { /* 壊れた画像。そのまま出す */ }
        if (!alive) {
          for (const url of urls) URL.revokeObjectURL(url);
          return;
        }
        // 消えていく途中の写真は 1 枚だけにする(すばやく切り替えたときに重なり続けないように)
        if (leaving) release(leaving);
        clearTimeout(leavingTimer);
        leaving = current;
        current = { slide, photo, urls };
        stage.append(slide);
        if (leaving) {
          slide.classList.add('entering');
          slide.getBoundingClientRect(); // 透明な状態を描いてからフェードさせる
          slide.classList.remove('entering');
          leavingTimer = setTimeout(() => {
            release(leaving);
            leaving = null;
          }, 700);
        }
      });
      return showing;
    }

    function render() {
      const n = list.length;
      root.classList.toggle('has-photos', n > 0);
      root.classList.toggle('single', n <= 1);
      empty.hidden = n > 0 || busy;
      counter.textContent = n > 1 ? `${index + 1} / ${n}` : '';
      show();
      schedule();
    }

    function go(step) {
      if (list.length <= 1) return;
      index = nextIndex(index, list.length, step, step > 0 ? cfg.order : 'sequential');
      chrome.storage.local.set({ [posKey]: { id: list[index].id } });
      render();
    }

    // スライドショー。タブが見えていないときは止める(戻ったら続きから数え直す)
    function schedule() {
      clearTimeout(timer);
      timer = null;
      if (!alive || document.hidden || list.length <= 1 || !Number(cfg.interval)) return;
      timer = setTimeout(() => go(1), Number(cfg.interval) * 1000);
    }
    const onVisibility = () => schedule();
    document.addEventListener('visibilitychange', onVisibility);

    // 枠の大きさが変わったら収め方を選び直す
    const resizeObserver = new ResizeObserver(() => {
      if (current) applyFit(current.slide, current.photo);
    });
    resizeObserver.observe(root);

    // ---------- 読み込み ----------

    async function reload({ advance = false } = {}) {
      const keepId = list[index]?.id;
      list = await photos.listPhotos(ctx.id);
      if (!alive) return;
      let i = list.findIndex((p) => p.id === keepId);
      if (keepId == null) {
        // 新しいタブ: 前回の続きから。ランダムなら前回と違う写真から
        const saved = (await chrome.storage.local.get(posKey))[posKey];
        i = list.findIndex((p) => p.id === saved?.id);
        if (advance && i >= 0 && Number(cfg.interval)) i = nextIndex(i, list.length, 1, cfg.order);
      }
      index = Math.max(0, Math.min(i < 0 ? index : i, list.length - 1));
      render();
    }

    async function add(files) {
      const images = files.filter((f) => f.type.startsWith('image/'));
      if (!images.length || busy) return;
      busy = true;
      empty.hidden = true;
      status.hidden = false;
      status.textContent = t('photo_adding', { done: 0, total: images.length });
      const before = list.length;
      const { failed } = await photos.addPhotos(ctx.id, images, (d, total) => {
        status.textContent = t('photo_adding', { done: d, total });
      });
      busy = false;
      if (!alive) return;
      await reload();
      // 追加した最初の写真を見せる
      if (list.length > before) {
        index = before;
        chrome.storage.local.set({ [posKey]: { id: list[index].id } });
        render();
      }
      status.textContent = failed ? t('photo_add_failed', { n: failed }) : '';
      status.hidden = !failed;
      if (failed) setTimeout(() => { status.hidden = true; }, 5000);
    }

    const unsubscribe = photos.onPhotosChange((owner) => {
      if (owner === ctx.id && !busy) reload();
    });

    // ---------- 操作 ----------

    prevBtn.addEventListener('click', () => go(-1));
    nextBtn.addEventListener('click', () => go(1));
    const onAdd = async () => add(await pickFiles());
    addBtn.addEventListener('click', onAdd);
    empty.querySelector('.ph-empty-add').addEventListener('click', onAdd);
    delBtn.addEventListener('click', async () => {
      const photo = list[index];
      if (!photo || !confirm(t('photo_confirm_delete'))) return;
      await photos.removePhoto(photo.id); // onPhotosChange から読み直す
    });

    // ファイルのドロップ
    const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
    root.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      root.classList.add('dropping');
    });
    root.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget)) root.classList.remove('dropping');
    });
    root.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      root.classList.remove('dropping');
      add([...e.dataTransfer.files]);
    });

    reload({ advance: true });

    return {
      update(next) {
        cfg = next;
        if (current) applyFit(current.slide, current.photo);
        schedule();
      },
      unmount() {
        alive = false;
        clearTimeout(timer);
        unsubscribe();
        resizeObserver.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        clearTimeout(leavingTimer);
        if (leaving) release(leaving);
        if (current) release(current);
        current = leaving = null;
      },
    };
  },
};
