// 列の数が違う配置へ写すときの並べ直し(広い画面の配置 ⇔ 狭い画面の配置)。
// 元の位置に置けるものはそのまま、置けないもの(はみ出す・重なる)は上から空いている場所に詰める。列より広いものは列の数に縮める。
// fixed: 先に置いてあって動かさないもの
export function packLayout(layout, columns, fixed = []) {
  const placed = [...fixed];
  const fits = (x, y, w, h) => placed.every((p) => x + w <= p.x || p.x + p.w <= x || y + h <= p.y || p.y + p.h <= y);
  const out = [];
  for (const item of [...layout].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const w = Math.min(item.w, columns);
    let pos = item.x + w <= columns && fits(item.x, item.y, w, item.h) ? { x: item.x, y: item.y } : null;
    for (let y = 0; !pos; y++) for (let x = 0; x + w <= columns; x++) if (fits(x, y, w, item.h)) { pos = { x, y }; break; }
    const next = { ...item, ...pos, w };
    placed.push(next);
    out.push(next);
  }
  return out;
}

// ウィジェットの組を source に合わせる(target の配置は保ち、無くなったものを外し、増えたものを空いている場所に置く)
export function mergeWidgets(target, source, columns) {
  const ids = new Set(source.map((i) => i.id));
  const kept = target.filter((i) => ids.has(i.id));
  const known = new Set(kept.map((i) => i.id));
  return [...kept, ...packLayout(source.filter((i) => !known.has(i.id)), columns, kept)];
}

export const sameWidgets = (a, b) => a.length === b.length && a.every((i) => b.some((j) => j.id === i.id));
