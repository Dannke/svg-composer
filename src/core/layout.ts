import stacking from '../data/stacking.json';
import { ASSETS, getAsset, type Format, type Kind, type Preset, type Size } from './catalog';
import type { Item } from './render';

export interface LayoutInput {
  slug: string;
  kind: Kind;
}

interface Placed extends LayoutInput {
  x: number; // центр, в исходных единицах Figma
  y: number;
  w: number;
  h: number;
  /** фоновый объект позади группы: верхней половиной может уходить за край кадра */
  back?: boolean;
}

const PAD = 0.08;

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
 * Раскладка в исходных единицах: объекты в ряд(ы); уложенные на другой объект (телефон на книгу)
 * места в ряду не занимают и идут слоем сразу над своим основанием.
 * «Собранно» — с наложением и лёгкой диагональной лесенкой, «Со смещением» — с промежутками,
 * сильнее разнесено по вертикали и зеркально по горизонтали (как в эталонных кадрах SVG-drop).
 */
function arrange(inputs: LayoutInput[], size: Size, spread: boolean, rowCount: number): Placed[] {
  const all = inputs.map((it) => ({ ...it, ...getAsset(it.slug, size, it.kind).bbox }));
  const hosts = stackHosts(inputs);
  const free = all.map((_, i) => i).filter((i) => !hosts[i]);
  // фоновые встают позади главных; если главных нет, фоновые раскладываются в ряд как обычные
  const hasMain = free.some((i) => inputs[i].kind === 'main');
  const backRoots = hasMain ? free.filter((i) => inputs[i].kind === 'bg') : [];
  const roots = free.filter((i) => !backRoots.includes(i));
  const sized = roots.map((i) => all[i]);
  const perRow = Math.ceil(sized.length / rowCount);
  const rows = Math.ceil(sized.length / perRow);
  const out: Placed[] = [];
  let rowTop = 0;
  for (let r = 0; r < rows; r++) {
    const row = sized.slice(r * perRow, (r + 1) * perRow);
    let x = 0;
    const placed = row.map((it, i) => {
      if (i > 0) {
        const prev = row[i - 1];
        // в эталоне «Собранно» соседние объекты лишь слегка заходят друг на друга
        const gap = spread ? 0.12 * (prev.w + it.w) / 2 : -0.05 * Math.min(prev.w, it.w);
        x += prev.w / 2 + gap + it.w / 2;
      }
      const stagger = (i % 2 ? 1 : -1) * (spread ? 0.18 : 0.08);
      return { ...it, x, y: stagger * it.h };
    });
    const rowH = Math.max(...row.map((it) => it.h));
    const midX = (placed[0].x + placed[placed.length - 1].x) / 2;
    for (const p of placed) out.push({ ...p, x: spread ? midX - p.x : p.x - midX, y: p.y + rowTop + rowH / 2 });
    rowTop += rowH * (spread ? 1.1 : 0.85);
  }
  const pos = new Map(roots.map((r, k) => [r, out[k]]));
  const emit = (i: number, into: Placed[]) => {
    const base = pos.get(i)!;
    into.push(base);
    hosts.forEach((s, j) => {
      if (s?.host !== i) return;
      pos.set(j, { ...all[j], x: base.x + s.dx * base.w, y: base.y + s.dy * base.h });
      emit(j, into);
    });
  };
  const front: Placed[] = [];
  roots.forEach((i) => emit(i, front));
  // как в «Примерах композиций» Figma (24:3592, 24:2654, 24:2914 и их версии в других форматах):
  // центр фонового объекта выше верхнего края главных на ~0.4 его высоты и сдвинут вбок
  // (первый влево, второй вправо); слоем позади всех главных
  const b = bounds(front);
  const behind: Placed[] = [];
  backRoots.forEach((i, k) => {
    pos.set(i, { ...all[i], x: b.cx + (k % 2 ? 0.4 : -0.4) * b.w, y: b.y0 - 0.4 * all[i].h, back: true });
    emit(i, behind);
  });
  return [...behind, ...front];
}

/** Рамка для вписывания: у фонового объекта — только нижняя половина, верхняя может уйти за край кадра. */
const fitBox = (p: Placed) => (p.back ? { x: p.x, y: p.y + p.h / 4, w: p.w, h: p.h / 2 } : p);

function bounds(ps: { x: number; y: number; w: number; h: number }[]) {
  const x0 = Math.min(...ps.map((p) => p.x - p.w / 2));
  const x1 = Math.max(...ps.map((p) => p.x + p.w / 2));
  const y0 = Math.min(...ps.map((p) => p.y - p.h / 2));
  const y1 = Math.max(...ps.map((p) => p.y + p.h / 2));
  return { x0, y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

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

/**
 * Масштаб для объектов, добавляемых из библиотеки на пустой холст: самый крупный объект
 * этого размера занимает не больше 60% меньшей стороны холста, так что влезает любой следующий.
 */
export function startScale(size: Size, format: Format) {
  const largest = Math.max(...ASSETS.filter((a) => a.size === size).map((a) => Math.max(a.bbox.w, a.bbox.h)));
  return (0.6 * Math.min(format.w, format.h)) / largest;
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
  // число рядов подбирается под формат: то, при котором объекты получаются крупнее всего
  const spread = preset === 'offset';
  const candidates = [1, 2, 3].filter((r) => r <= inputs.length).map((r) => arrange(inputs, size, spread, r));
  const fitScale = (ps: Placed[]) => {
    const b = bounds(ps.map(fitBox));
    return Math.min(full.w / b.w, full.h / b.h);
  };
  const placed = candidates.reduce((best, c) => (fitScale(c) > fitScale(best) ? c : best));
  return fit(placed, preset === 'underTitle' ? titleFreeArea(format) : full, uid);
}
