import masks from '../data/masks.json';
import stacking from '../data/stacking.json';
import { getAsset, type Format, type Kind, type Preset, type Size } from './catalog';
import type { Item } from './render';

export interface LayoutInput {
  slug: string;
  kind: Kind;
}

/** Центр и размер, в исходных единицах Figma. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placed extends LayoutInput, Box {
  /** фоновый объект позади группы: верхней половиной может уходить за край кадра */
  back?: boolean;
}

const PAD = 0.06;

/**
 * Для каждого объекта — на какой объект набора он кладётся (пары из эталонов Figma) или null. Один guest на host.
 * Кладутся только главные объекты; основанием может быть и фоновый (пазлы на фоновой книге).
 */
function stackHosts(inputs: LayoutInput[]) {
  const busy = new Set<number>();
  return inputs.map((it, i) => {
    if (it.kind !== 'main') return null;
    for (const p of stacking.pairs) {
      if (p.guest !== it.slug) continue;
      const host = inputs.findIndex((x, j) => j !== i && x.slug === p.host && !busy.has(j));
      if (host >= 0) {
        busy.add(host);
        return { host, dx: p.dx, dy: p.dy };
      }
    }
    return null;
  });
}

/**
 * Силуэт блока сеткой (scripts/build-masks.mjs растеризует каждый объект из Figma): у изометрических объектов
 * углы рамки пустые, поэтому соседей прикладываем по силуэтам, а не по рамкам. Координаты — от центра рамки блока.
 */
interface Sil {
  cell: number;
  cols: number;
  rows: number;
  occ: Uint8Array;
  /** центры занятых клеток */
  pts: number[][];
  area: number;
  /** нижний край силуэта — по нему считается глубина сцены */
  bottom: number;
}
interface Shape extends Box {
  sil: Sil;
}

const N = 20; // клеток по длинной стороне, как в build-masks.mjs
const MASKS = masks as Record<string, string[]>;

function partAt(p: Placed, size: Size, px: number, py: number) {
  const m = MASKS[`${p.slug}-${size}-${p.kind}`];
  const cell = Math.max(p.w, p.h) / Math.max(m.length, m[0].length);
  const r = Math.floor((py - p.y + p.h / 2) / cell);
  const c = Math.floor((px - p.x + p.w / 2) / cell);
  return r >= 0 && c >= 0 && r < m.length && c < m[0].length && m[r][c] === '#';
}

const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Выпуклая оболочка точек (монотонная цепь), обход в одном направлении. */
function convexHull(points: number[][]) {
  const ps = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list: number[][]) => {
    const h: number[][] = [];
    for (const p of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(ps), ...half([...ps].reverse())];
}

/**
 * Занятость клеток для упаковки — выпуклая оболочка силуэта, а не сам силуэт: под абажур лампы, внутрь
 * дуги наушников, под цветы тюльпанов другой объект не заходит (ручка «на лампе» нелогична).
 * flip — силуэт, отражённый по горизонтали относительно центра блока (для зеркальной раскладки).
 */
function silhouette(parts: Placed[], size: Size, b: ReturnType<typeof bounds>, flip: boolean): Sil {
  const cell = Math.max(b.w, b.h) / N;
  const cols = Math.ceil(b.w / cell);
  const rows = Math.ceil(b.h / cell);
  const corners: number[][] = [];
  let bottom = -Infinity;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = b.x0 + (c + 0.5) * cell;
      const y = b.y0 + (r + 0.5) * cell;
      if (!parts.some((p) => partAt(p, size, flip ? 2 * b.cx - x : x, y))) continue;
      corners.push([c, r], [c + 1, r], [c, r + 1], [c + 1, r + 1]);
      bottom = Math.max(bottom, y - b.cy + cell / 2);
    }
  const hull = convexHull(corners);
  const occ = new Uint8Array(cols * rows);
  const pts: number[][] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const q = [c + 0.5, r + 0.5];
      const side = hull.map((p, i) => cross(p, hull[(i + 1) % hull.length], q));
      if (!(side.every((s) => s >= 0) || side.every((s) => s <= 0))) continue;
      occ[r * cols + c] = 1;
      pts.push([b.x0 + q[0] * cell - b.cx, b.y0 + q[1] * cell - b.cy]);
    }
  return { cell, cols, rows, occ, pts, area: pts.length * cell * cell, bottom };
}

/** Какую долю меньшего из двух силуэтов закрывает их пересечение. Перебираются клетки более мелкой сетки — иначе крупные клетки большого объекта «проскакивают» маленький. */
function cover(a: Shape, b: Shape): number {
  if (b.sil.cell > a.sil.cell) return cover(b, a);
  const s = a.sil;
  let n = 0;
  for (const [px, py] of b.sil.pts) {
    const c = Math.floor((b.x + px - a.x + a.w / 2) / s.cell);
    const r = Math.floor((b.y + py - a.y + a.h / 2) / s.cell);
    if (r >= 0 && c >= 0 && r < s.rows && c < s.cols && s.occ[r * s.cols + c]) n++;
  }
  return (n * b.sil.cell ** 2) / Math.min(s.area, b.sil.area);
}

/** Ближайшее к a положение b вдоль единичного направления u, при котором их силуэты перекрываются не больше чем на target. */
function approach(a: Shape, b: Shape, u: number[], target: number) {
  let lo = 0;
  let hi = a.w + a.h + b.w + b.h;
  for (let k = 0; k < 14; k++) {
    const t = (lo + hi) / 2;
    if (cover(a, { ...b, x: a.x + u[0] * t, y: a.y + u[1] * t }) > target) lo = t;
    else hi = t;
  }
  return hi;
}

/**
 * Направления, по которым объекты прикладываются к соседям: изометрические оси (наклон 1:2, как сами объекты
 * и их расстановка в «Примерах композиций»), диагонали 45° и горизонталь. Строго по вертикали — нет:
 * объект «висел» бы над соседом.
 */
const DIRS = [26.57, -26.57, 153.43, -153.43, 45, -45, 135, -135, 0, 180].map((d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)]);

/**
 * Наложения — как в «Примерах композиций» ТЗ: силуэты пересекаются только у укладок (телефон на книге,
 * пазлы на книге / телефоне — src/data/stacking.json, они пакуются одним блоком), остальные объекты лишь касаются.
 * «Собранно» — вплотную по оболочкам (3 % на точность сетки маски), «Со смещением» — с зазором 15 % расстояния от касания.
 */
const DENSE = { target: 0, stretch: 1.03, others: 0, gap: 1 };
/** gap — силуэты обоих объектов, увеличенные на 6 % от своих центров, не пересекаются: зазор со всеми, не только с соседом */
const SPREAD = { target: 0, stretch: 1.15, others: 0, gap: 1.06 };

/** Силуэт, увеличенный от центра в k раз (та же сетка, крупнее клетки). */
const inflate = (s: Shape, k: number): Shape =>
  k === 1 ? s : { ...s, w: s.w * k, h: s.h * k, sil: { ...s.sil, cell: s.sil.cell * k, pts: s.sil.pts.map(([x, y]) => [x * k, y * k]), area: s.sil.area * k * k } };
/** Главный объект перед фоновым закрывает его не больше чем на 6 % (в примерах ТЗ — 1–5 %). */
const BG_COVER = 0.06;

function bounds(ps: Box[]) {
  const x0 = Math.min(...ps.map((p) => p.x - p.w / 2));
  const x1 = Math.max(...ps.map((p) => p.x + p.w / 2));
  const y0 = Math.min(...ps.map((p) => p.y - p.h / 2));
  const y1 = Math.max(...ps.map((p) => p.y + p.h / 2));
  return { x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

const fitScale = (ps: Box[], area: { w: number; h: number }) => {
  const b = bounds(ps);
  return Math.min(area.w / b.w, area.h / b.h);
};

/**
 * Жадная упаковка в кластер: крупные объекты первыми, каждый следующий прикладывается к одному из уже
 * поставленных по одному из DIRS. Берётся вариант, при котором кластер впишется в формат крупнее всего,
 * при равенстве — ближе к центру. Поэтому у горизонтального формата кластер вытягивается вширь, у вертикального — ввысь.
 */
function pack(units: Shape[], area: { w: number; h: number }, mode: typeof DENSE): Shape[] {
  const bySize = units.map((_, i) => i).sort((a, b) => units[b].sil.area - units[a].sil.area);
  // жадный выбор зависит от первого объекта: пробуем первыми три крупнейших, остальные — от крупных к мелким
  return bySize
    .slice(0, 3)
    .map((first) => packFrom([first, ...bySize.filter((i) => i !== first)], units, area, mode))
    .reduce((best, r) => (fitScale(r, area) > fitScale(best, area) + 1e-9 ? r : best));
}

function packFrom(order: number[], units: Shape[], area: { w: number; h: number }, mode: typeof DENSE): Shape[] {
  const placed: Shape[] = [];
  const out: Shape[] = [];
  for (const i of order) {
    const u = units[i];
    let best: { box: Shape; score: number } | null = placed.length ? null : { box: { ...u, x: 0, y: 0 }, score: 0 };
    const b = placed.length ? bounds(placed) : null;
    for (const a of placed)
      for (const d of DIRS) {
        const t = approach(a, u, d, mode.target) * mode.stretch;
        const box = { ...u, x: a.x + d[0] * t, y: a.y + d[1] * t };
        // и с соседом проверяем заново: после отступа stretch силуэты с вогнутостями (лампа) могут снова сойтись
        const wide = inflate(box, mode.gap);
        if (placed.some((c) => cover(inflate(c, mode.gap), wide) > (c === a ? mode.target : mode.others) + 1e-9)) continue;
        const centred = 1 - (0.05 * Math.hypot(box.x - b!.cx, box.y - b!.cy)) / Math.hypot(b!.w, b!.h);
        // мелкий объект охотнее встаёт перед крупным (ниже по кадру), как монета перед кошельком в «Примерах композиций»
        const front = d[1] > 0 && u.sil.area < a.sil.area ? 1.03 : 1;
        const score = fitScale([...placed, box], area) * centred * front;
        if (!best || score > best.score + 1e-9) best = { box, score };
      }
    // все места вокруг заняты сильнее допустимого — справа от кластера
    best ??= { box: { ...u, x: b!.x0 + b!.w + u.w / 2, y: b!.cy }, score: 0 };
    placed.push(best.box);
    out[i] = best.box;
  }
  return out;
}

/**
 * Раскладка в исходных единицах. Уложенные на другой объект (телефон на книгу) едут вместе с основанием одним блоком.
 * Порядок слоёв — по глубине изометрической сцены: чем ниже нижний край блока, тем ближе он к зрителю и выше слой.
 * «Со смещением» — с зазорами и зеркально по горизонтали (как в эталонных кадрах SVG-drop).
 */
function arrange(inputs: LayoutInput[], size: Size, spread: boolean, area: { w: number; h: number }): Placed[] {
  const all = inputs.map((it) => ({ ...it, ...getAsset(it.slug, size, it.kind).bbox, x: 0, y: 0 }));
  const hosts = stackHosts(inputs);
  const free = all.map((_, i) => i).filter((i) => !hosts[i]);
  // фоновые встают позади главных; если главных нет, фоновые раскладываются как обычные
  const hasMain = free.some((i) => inputs[i].kind === 'main');
  const backRoots = hasMain ? free.filter((i) => inputs[i].kind === 'bg') : [];
  const roots = free.filter((i) => !backRoots.includes(i));

  // блок = основание и всё, что на него уложено, в координатах основания
  const group = (i: number, x = 0, y = 0): Placed[] => [
    { ...all[i], x, y },
    ...hosts.flatMap((s, j) => (s?.host === i ? group(j, x + s.dx * all[i].w, y + s.dy * all[i].h) : [])),
  ];
  const blocks = roots.map((i) => {
    const g = group(i);
    const b = bounds(g);
    return { g, box: { x: b.cx, y: b.cy, w: b.w, h: b.h, sil: silhouette(g, size, b, spread) } };
  });
  // зеркальная раскладка: упаковываем отражённые силуэты, затем отражаем расстановку блоков (сами объекты не отражаются)
  const boxes = pack(blocks.map((b) => b.box), area, spread ? SPREAD : DENSE);
  const flipX = spread ? -1 : 1;
  const front = blocks
    .map((b, k) => ({ b, at: boxes[k] }))
    .sort((p, q) => p.at.y + p.at.sil.bottom - (q.at.y + q.at.sil.bottom))
    .flatMap(({ b, at }) => b.g.map((p) => ({ ...p, x: flipX * at.x + p.x - b.box.x, y: at.y + p.y - b.box.y })));

  if (!backRoots.length) return front;

  // как в «Примерах композиций» Figma (24:3592, 24:2654, 24:2914 и их версии в других форматах):
  // центр фонового объекта выше верхнего края главных на ~0.4 его высоты и сдвинут вбок
  // (первый влево, второй вправо, дальше по очереди), слоем позади всех главных.
  // Фоновые не пересекаются друг с другом, главные закрывают фоновый не больше BG_COVER:
  // если место занято, фоновый отодвигается наружу (от центра), а при наложении на главные — вверх.
  const fb = bounds(front);
  const real = (b: (typeof blocks)[number], k: number): Shape => {
    const bb = bounds(b.g);
    return { x: flipX * boxes[k].x, y: boxes[k].y, w: bb.w, h: bb.h, sil: silhouette(b.g, size, bb, false) };
  };
  const mains = blocks.map(real);
  const placedBg: Shape[] = [];
  const behind: Placed[] = [];
  const guests: Placed[] = [];
  // рамки для вписывания: главные целиком, у фоновых — нижняя половина (fitBox)
  const fitOf = (ps: Box[]) => fitScale([...front, ...ps.map((p) => ({ x: p.x, y: p.y + p.h / 4, w: p.w, h: p.h / 2 }))], area);
  backRoots.forEach((i, k) => {
    const side = k % 2 ? 1 : -1;
    const g = group(i);
    const gb = bounds(g);
    const shape = { x: 0, y: 0, w: gb.w, h: gb.h, sil: silhouette(g, size, gb, false) };
    const step = 0.04 * Math.max(gb.w, gb.h);
    // занятое другим фоновым место обходим наружу (ряд вширь) или вверх (второй ряд) — что впишется крупнее
    const search = (outward: boolean) => {
      // (hx, hy) — центр самого фонового объекта (основания блока)
      let [hx, hy] = [fb.cx + side * 0.4 * fb.w, fb.y0 - 0.4 * all[i].h];
      for (let n = 0; n < 400; n++) {
        const at = { ...shape, x: hx + gb.cx, y: hy + gb.cy };
        if (placedBg.some((c) => cover(c, at) > 0)) outward ? (hx += side * step) : (hy -= step);
        else if (mains.some((m) => cover(m, at) > BG_COVER)) hy -= step;
        else break;
      }
      return { hx, hy };
    };
    const [a, b] = [search(true), search(false)];
    const score = (p: { hx: number; hy: number }) => fitOf([...placedBg, { ...shape, x: p.hx + gb.cx, y: p.hy + gb.cy }]);
    const { hx, hy } = score(b) > score(a) + 1e-9 ? b : a;
    placedBg.push({ ...shape, x: hx + gb.cx, y: hy + gb.cy });
    const [host, ...onTop] = g.map((p) => ({ ...p, x: p.x + hx, y: p.y + hy }));
    behind.push({ ...host, back: true });
    guests.push(...onTop);
  });
  // фоновые — по глубине между собой; уложенные на них главные (пазлы на фоновой книге) — над всеми фоновыми
  behind.sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2));
  return [...behind, ...guests, ...front];
}

/** Рамка для вписывания: у фонового объекта — только нижняя половина, верхняя может уйти за край кадра. */
const fitBox = (p: Placed) => (p.back ? { x: p.x, y: p.y + p.h / 4, w: p.w, h: p.h / 2 } : p);

/** Вписать группу в прямоугольник одним коэффициентом. */
function fit(ps: Placed[], area: { x: number; y: number; w: number; h: number }, uid: () => string) {
  const b = bounds(ps.map(fitBox));
  const scale = Math.min(area.w / b.w, area.h / b.h);
  const items: Item[] = ps.map((p) => ({
    uid: uid(),
    slug: p.slug,
    kind: p.kind,
    cx: area.x + area.w / 2 + (p.x - b.cx) * scale,
    cy: area.y + area.h / 2 + (p.y - b.cy) * scale,
    rotation: 0,
  }));
  return { scale, items };
}

/** Свободная от текста зона для «Под заголовок»: справа у горизонтальных форматов, снизу у остальных. */
export function titleFreeArea(format: Format) {
  const { w, h } = format;
  return w / h >= 1.3
    ? { x: w * 0.44, y: h * 0.12, w: w * 0.52, h: h * 0.76 }
    : { x: w * PAD, y: h * 0.46, w: w * (1 - 2 * PAD), h: h * 0.46 };
}

let counter = 0;
export const newUid = () => `i${Date.now().toString(36)}${(counter++).toString(36)}`;

/**
 * Пресет раскладки. Все объекты получают один общий масштаб (scale);
 * «Под заголовок» = раскладка «Собранно», уменьшенная одним коэффициентом и сдвинутая в свободную зону.
 */
export function layout(inputs: LayoutInput[], size: Size, format: Format, preset: Preset, uid = newUid) {
  if (!inputs.length) return { scale: 1, items: [] as Item[] };
  const full = { x: format.w * PAD, y: format.h * PAD, w: format.w * (1 - 2 * PAD), h: format.h * (1 - 2 * PAD) };
  const placed = arrange(inputs, size, preset === 'offset', full);
  return fit(placed, preset === 'underTitle' ? titleFreeArea(format) : full, uid);
}
