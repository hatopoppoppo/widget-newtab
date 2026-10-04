import { el, icon, editSettings } from '../ui.js';
import { t } from '../i18n.js';
import {
  LIST_DEFAULTS, MAX_ITEMS, MAX_BYTES,
  complete, isOverdue, dueLabel, repeatLabel, sortItems, splitDue, joinDue, storedSize,
} from '../todo-core.js';
import { repeatFields, repeatValues, readRepeat, matches, firstMatch, parseDate, dateKey } from '../repeat-core.js';
import { addReminderFromElsewhere } from './reminder.js';

// ToDo リスト。仕様は docs/todo-spec.md、計算は js/todo-core.js
// 中身は ctx.data(chrome.storage.sync の data:<id>)に { items: [...] } で保存する。
// 通知は無い(リマインダーに集約した)。行の 🔔 から、内容と期限を引き継いでリマインダーを作れる

const newId = () => crypto.randomUUID().slice(0, 8);

// ToDo の編集ダイアログ。保存されたら新しい ToDo、キャンセルなら null
async function editItem(item) {
  const due = splitDue(item.due);
  const hasDate = (v) => !!v.date;
  const values = await editSettings({
    title: t('todo_edit'),
    fields: [
      { key: 'text', label: t('field_text'), type: 'text' },
      { key: 'date', label: t('todo_due'), type: 'date' },
      { key: 'time', label: t('todo_due_time'), type: 'time', when: hasDate },
      ...repeatFields(hasDate),
    ],
    values: { text: item.text, date: due?.date ?? '', time: due?.time ?? '', ...repeatValues(item.repeat, due?.date) },
  });
  if (!values) return null;

  const text = values.text.trim() || item.text;
  let date = values.date || null;
  const repeat = readRepeat(values, date, item.repeat, due?.date);
  // 期限が繰り返しの回に当たらなければ(毎月第 2 火曜なのに 10/2 など)、その日以降の最初の回にする
  if (repeat && !matches(repeat, parseDate(date))) {
    const first = firstMatch(repeat, parseDate(date));
    if (first) {
      if (repeat.anchor === date) repeat.anchor = dateKey(first);
      date = dateKey(first);
    }
  }
  return {
    ...item,
    text: text.slice(0, 200),
    due: joinDue(date, date ? values.time || null : null),
    repeat,
  };
}

export default {
  type: 'todo',
  name: t('todo_name'),
  description: t('todo_description'),
  size: { w: 6, h: 6, minW: 4, minH: 3 },
  defaults: { ...LIST_DEFAULTS },
  fields: [
    { key: 'title', label: t('todo_list_title'), type: 'text' },
    {
      key: 'sort', label: t('todo_sort'), type: 'select', options: [
        { value: 'manual', label: t('todo_sort_manual') },
        { value: 'due', label: t('todo_sort_due') },
      ],
    },
    { key: 'hideDone', label: t('todo_hide_done'), type: 'checkbox' },
  ],

  mount(root, config, ctx) {
    let items = [];
    let loaded = false;

    const title = el('span', { className: 'td-title' });
    const count = el('span', { className: 'td-count' });
    const list = el('div', { className: 'td-list' });
    const input = el('input', { className: 'td-input', type: 'text', placeholder: t('todo_input'), maxLength: 200, spellcheck: false });
    const addForm = el('form', { className: 'td-add' }, icon('plus'), input);
    const clearBtn = el('button', { type: 'button', className: 'td-clear' });
    const flashEl = el('div', { className: 'td-flash', hidden: true });
    root.append(el('div', { className: 'td' },
      el('div', { className: 'td-head' }, title, count), list, addForm, el('div', { className: 'td-foot' }, clearBtn), flashEl));

    // 短いお知らせ。action を渡すとボタン(「元に戻す」など)を付ける
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
        flash(t('todo_full'));
        return false;
      }
      items = next;
      render();
      await ctx.data.save(value);
      return true;
    };
    const update = (id, fn) => save(items.map((i) => (i.id === id ? fn(i) : i)));

    const toggle = (item) => {
      if (item.done) {
        update(item.id, (i) => ({ ...i, done: 0 }));
        return;
      }
      const next = complete(item);
      update(item.id, () => next);
      if (!next.done) flash(t('common_next', { next: dueLabel(next.due) })); // 繰り返しは次回に進む
    };

    const remove = (item) => {
      const before = items;
      save(items.filter((i) => i.id !== item.id));
      flash(t('common_deleted', { name: item.text }), { label: t('common_undo'), run: () => save(before) });
    };

    const edit = async (item) => {
      const updated = await editItem(item);
      if (updated) update(item.id, () => updated);
    };

    // 内容と期限を引き継いでリマインダーを作る(日付だけの期限は 9:00、期限なしは次の正時)
    const remind = async (item) => {
      const due = splitDue(item.due);
      const message = await addReminderFromElsewhere(item.text, due ? joinDue(due.date, due.time ?? '09:00') : undefined);
      if (message) flash(message);
    };

    const renderItem = (item) => {
      const overdue = isOverdue(item);
      const check = el('button', {
        type: 'button', className: 'td-check',
        title: item.done ? t('todo_undone') : item.repeat ? t('todo_done_repeat') : t('todo_done'),
      }, icon('check'));
      check.setAttribute('aria-pressed', String(!!item.done));
      check.addEventListener('click', () => toggle(item));

      const text = el('span', { className: 'td-text', textContent: item.text, title: t('common_click_to_edit') });
      text.addEventListener('click', () => edit(item));

      const meta = el('span', { className: 'td-meta' },
        item.repeat && el('span', { className: 'td-repeat', textContent: '↻', title: repeatLabel(item.repeat) }),
        item.due && el('span', { className: overdue ? 'td-due overdue' : 'td-due', textContent: dueLabel(item.due) }));

      const editBtn = el('button', { type: 'button', className: 'td-btn', title: t('common_edit') }, icon('edit'));
      const remindBtn = el('button', { type: 'button', className: 'td-btn', title: t('reminder_create') }, icon('bell'));
      const delBtn = el('button', { type: 'button', className: 'td-btn', title: t('common_delete') }, icon('close'));
      editBtn.addEventListener('click', () => edit(item));
      remindBtn.addEventListener('click', () => remind(item));
      delBtn.addEventListener('click', () => remove(item));

      const row = el('div', {
        className: `td-item${item.done ? ' done' : ''}${overdue ? ' overdue' : ''}`,
        draggable: config.sort === 'manual' && !item.done,
      }, check, text, meta, el('span', { className: 'td-actions' }, editBtn, !item.done && remindBtn, delBtn));
      row.dataset.id = item.id;
      return row;
    };

    const render = () => {
      title.textContent = config.title || t('todo_name');
      const open = items.filter((i) => !i.done).length;
      const done = items.length - open;
      count.textContent = t('common_count', { n: open });
      let shown = sortItems(items, config.sort);
      if (config.hideDone) shown = shown.filter((i) => !i.done);
      list.replaceChildren(...(shown.length
        ? shown.map(renderItem)
        : [el('p', { className: 'td-empty', textContent: loaded ? (done ? t('todo_empty_open') : t('todo_empty')) : '' })]));
      clearBtn.textContent = t('todo_clear_done', { n: done });
      clearBtn.hidden = done === 0;
    };

    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const ok = await save([...items, { id: newId(), text: text.slice(0, 200), due: null, repeat: null, done: 0 }]);
      if (ok) {
        input.value = '';
        list.lastElementChild?.scrollIntoView({ block: 'nearest' });
      }
    });
    clearBtn.addEventListener('click', () => {
      const before = items;
      const removed = items.filter((i) => i.done).length;
      save(items.filter((i) => !i.done));
      flash(t('todo_cleared_done', { n: removed }), { label: t('common_undo'), run: () => save(before) });
    });

    // ---- ドラッグで並べ替え(手動の並び順のときだけ。完了済みは動かさない) ----
    let dragging = null;
    list.addEventListener('dragstart', (e) => {
      dragging = e.target.closest?.('.td-item');
      if (!dragging) return;
      dragging.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', items.find((i) => i.id === dragging.dataset.id)?.text ?? '');
    });
    list.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const target = e.target.closest('.td-item:not(.done)');
      if (!target || target === dragging) return;
      const rows = [...list.querySelectorAll('.td-item:not(.done)')];
      list.insertBefore(dragging, rows.indexOf(dragging) < rows.indexOf(target) ? target.nextSibling : target);
    });
    list.addEventListener('drop', (e) => { if (dragging) e.preventDefault(); });
    list.addEventListener('dragend', () => {
      if (!dragging) return;
      dragging.classList.remove('dragging');
      dragging = null;
      const order = [...list.querySelectorAll('.td-item:not(.done)')].map((r) => r.dataset.id);
      const byId = new Map(items.map((i) => [i.id, i]));
      const next = [...order.map((id) => byId.get(id)), ...items.filter((i) => i.done)];
      if (next.map((i) => i.id).join() !== items.map((i) => i.id).join()) save(next);
    });

    // 他のタブ・他の PC での変更を反映する
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

    // 「今日」「期限切れ」の表示を最新に保つ
    const timer = setInterval(render, 60_000);
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
