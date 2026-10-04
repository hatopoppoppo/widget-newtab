import { el, icon, editSettings } from '../ui.js';
import * as store from '../store.js';
import { t } from '../i18n.js';
import { dateKey, timeKey, dueLabel, repeatLabel } from '../repeat-core.js';
import {
  REMINDER_DEFAULTS, MAX_ITEMS, MAX_BYTES, nextTime, isEnded, sortItems, storedSize, reminderFields, reminderFormValues, readReminderForm, scheduleLabel,
} from '../reminder-core.js';

// リマインダー。決めた日時(繰り返しも可)に通知する。計算は js/reminder-core.js、通知は background.js
// 中身は ctx.data(chrome.storage.sync の data:<id>)に { items: [...] } で保存する

const newId = () => crypto.randomUUID().slice(0, 8);
const msToDue = (ms) => {
  const d = new Date(ms);
  return `${dateKey(d)}T${timeKey(d)}`;
};
// 次の正時(新しいリマインダーの日時の初期値)
const nextHour = () => {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return msToDue(d.getTime());
};

// リマインダーの編集ダイアログ。内容 → 繰り返し → その繰り返しに要る欄だけ(js/reminder-core.js の reminderFields)。
// lists を渡すと(ToDo から作るときなど)追加先のリマインダーウィジェットも選べる。
// 保存されたら { item, listId }、キャンセルなら null
export async function editReminder(item, { title = t('reminder_edit'), lists = null } = {}) {
  const values = await editSettings({
    title,
    fields: [
      ...reminderFields(),
      ...(lists?.length > 1 ? [{ key: 'list', label: t('reminder_field_list'), type: 'select', options: lists.map((l) => ({ value: l.id, label: l.cfg.title || REMINDER_DEFAULTS.title })) }] : []),
    ],
    values: { ...reminderFormValues(item), list: lists?.[0]?.id ?? '' },
  });
  if (!values) return null;
  return { listId: values.list || lists?.[0]?.id, item: readReminderForm(values, item) };
}

export const newReminder = (text, at = nextHour()) => ({ id: newId(), text, at, repeat: null, paused: false, snooze: 0 });

// 置いてあるリマインダーウィジェットに、ダイアログで新しいリマインダーを追加する(ToDo から作るとき用)。
// 結果のお知らせの文を返す(キャンセルなら null)
export async function addReminderFromElsewhere(text, at) {
  const lists = await store.listWidgets('reminder');
  if (!lists.length) return t('reminder_no_widget');
  const result = await editReminder(newReminder(text, at), { title: t('reminder_create'), lists });
  if (!result) return null;
  const value = (await store.loadData(result.listId)) ?? { items: [] };
  const next = { ...value, items: [...value.items, result.item] };
  if (next.items.length > MAX_ITEMS || storedSize(store.dataKey(result.listId), next) > MAX_BYTES) {
    return t('reminder_full_elsewhere');
  }
  await store.saveData(result.listId, next);
  return t('reminder_created', { next: nextLabel(result.item) });
}

function nextLabel(item, now = Date.now()) {
  const next = nextTime(item, now);
  return next ? dueLabel(msToDue(next), now) : t('reminder_ended');
}

export default {
  type: 'reminder',
  name: t('reminder_name'),
  description: t('reminder_description'),
  size: { w: 6, h: 5, minW: 4, minH: 3 },
  defaults: { ...REMINDER_DEFAULTS },
  fields: [
    { key: 'title', label: t('reminder_title'), type: 'text' },
    {
      key: 'snooze', label: t('reminder_snooze'), type: 'select', options: ['5', '10', '30', '60'].map((m) => ({ value: m, label: t('timer_unit_minutes', { n: m }) })),
    },
    { key: 'hideEnded', label: t('reminder_hide_ended'), type: 'checkbox' },
  ],

  mount(root, config, ctx) {
    let items = [];
    let loaded = false;

    const title = el('span', { className: 'td-title' });
    const count = el('span', { className: 'td-count' });
    const list = el('div', { className: 'td-list' });
    const input = el('input', { className: 'td-input', type: 'text', placeholder: t('reminder_input'), maxLength: 200, spellcheck: false });
    const addForm = el('form', { className: 'td-add' }, icon('plus'), input);
    const clearBtn = el('button', { type: 'button', className: 'td-clear' });
    const flashEl = el('div', { className: 'td-flash', hidden: true });
    root.append(el('div', { className: 'td rm' },
      el('div', { className: 'td-head' }, title, count), list, addForm, el('div', { className: 'td-foot' }, clearBtn), flashEl));

    let flashTimer;
    const flash = (text, action) => {
      flashEl.replaceChildren(el('span', { textContent: text }));
      if (action) {
        const b = el('button', { type: 'button', textContent: action.label });
        b.addEventListener('click', () => {
          flashEl.hidden = true;
          action.run();
        });
        flashEl.append(b);
      }
      flashEl.hidden = false;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashEl.hidden = true; }, action ? 5000 : 2500);
    };

    const save = async (next) => {
      const value = { items: next };
      if (next.length > MAX_ITEMS || storedSize(ctx.data.key, value) > MAX_BYTES) {
        flash(t('reminder_full'));
        return false;
      }
      items = next;
      render();
      await ctx.data.save(value);
      return true;
    };
    const update = (id, fn) => save(items.map((i) => (i.id === id ? fn(i) : i)));

    const togglePause = (item) => {
      const paused = !item.paused;
      update(item.id, (i) => ({ ...i, paused, snooze: 0 }));
      if (!paused && !isEnded(item)) flash(t('common_next', { next: nextLabel(item) }));
    };

    const remove = (item) => {
      const before = items;
      save(items.filter((i) => i.id !== item.id));
      flash(t('common_deleted', { name: item.text }), { label: t('common_undo'), run: () => save(before) });
    };

    const edit = async (item) => {
      const result = await editReminder(item);
      if (result) update(item.id, () => result.item);
    };

    const renderItem = (item) => {
      const now = Date.now();
      const ended = isEnded(item, now);
      const bell = el('button', {
        type: 'button', className: 'td-check rm-bell',
        title: ended ? t('reminder_bell_ended') : item.paused ? t('reminder_bell_resume') : t('reminder_bell_pause'),
        disabled: ended,
      }, icon('bell'));
      bell.setAttribute('aria-pressed', String(!item.paused && !ended));
      bell.addEventListener('click', () => togglePause(item));

      const text = el('span', { className: 'td-text', textContent: item.text, title: t('common_click_to_edit') });
      text.addEventListener('click', () => edit(item));

      const snoozing = item.snooze > now && !item.paused;
      const meta = el('span', { className: 'td-meta' },
        item.repeat && el('span', { className: 'td-repeat', textContent: '↻', title: repeatLabel(item.repeat) }),
        snoozing && el('span', { className: 'rm-snooze', textContent: t('reminder_snoozing', { time: timeKey(new Date(item.snooze)) }) }),
        el('span', { className: 'td-due', textContent: ended ? t('reminder_ended') : item.paused ? t('reminder_paused') : nextLabel(item, now) }));

      const editBtn = el('button', { type: 'button', className: 'td-btn', title: t('common_edit') }, icon('edit'));
      const delBtn = el('button', { type: 'button', className: 'td-btn', title: t('common_delete') }, icon('close'));
      editBtn.addEventListener('click', () => edit(item));
      delBtn.addEventListener('click', () => remove(item));

      const row = el('div', {
        className: `td-item${ended ? ' ended' : ''}${item.paused ? ' paused' : ''}`,
        title: scheduleLabel(item),
      }, bell, text, meta, el('span', { className: 'td-actions' }, editBtn, delBtn));
      row.dataset.id = item.id;
      return row;
    };

    const render = () => {
      const now = Date.now();
      title.textContent = config.title || REMINDER_DEFAULTS.title;
      const ended = items.filter((i) => isEnded(i, now)).length;
      count.textContent = t('common_count', { n: items.length - ended });
      let shown = sortItems(items, now);
      if (config.hideEnded) shown = shown.filter((i) => !isEnded(i, now));
      list.replaceChildren(...(shown.length
        ? shown.map(renderItem)
        : [el('p', { className: 'td-empty', textContent: loaded ? t('reminder_empty') : '' })]));
      clearBtn.textContent = t('reminder_clear_ended', { n: ended });
      clearBtn.hidden = ended === 0;
    };

    // 内容を入力して Enter → 日時を決めるダイアログ
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const result = await editReminder(newReminder(text.slice(0, 200)), { title: t('reminder_add') });
      if (!result) return;
      if (await save([...items, result.item])) {
        input.value = '';
        flash(t('common_next', { next: nextLabel(result.item) }));
      }
    });
    clearBtn.addEventListener('click', () => {
      const before = items;
      const now = Date.now();
      const removed = items.filter((i) => isEnded(i, now)).length;
      save(items.filter((i) => !isEnded(i, now)));
      flash(t('reminder_cleared_ended', { n: removed }), { label: t('common_undo'), run: () => save(before) });
    });

    // 他のタブ・他の PC・通知の「再通知」ボタンでの変更を反映する
    const unsubscribe = ctx.data.subscribe((value) => {
      const next = value?.items ?? [];
      if (JSON.stringify(next) === JSON.stringify(items)) return; // 自分の保存
      items = next;
      render();
    });
    ctx.data.load().then((value) => {
      items = value?.items ?? [];
      loaded = true;
      render();
    });

    // 「次回」「終了」の表示を最新に保つ
    const timer = setInterval(render, 30_000);
    render();
    return {
      update(cfg) {
        config = cfg;
        render();
      },
      unmount() {
        clearInterval(timer);
        clearTimeout(flashTimer);
        unsubscribe();
      },
    };
  },
};
