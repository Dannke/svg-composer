import { describe, expect, it } from 'vitest';
import { ASSETS, FORMATS, getAsset, PRESETS, type Kind, type Size } from '../src/core/catalog';
import { layout, titleFreeArea } from '../src/core/layout';
import masks from '../src/data/masks.json';
import stacking from '../src/data/stacking.json';

const slugs = [...new Set(ASSETS.filter((a) => a.size === 'L' && a.kind === 'main').map((a) => a.slug))].slice(0, 5);
const inputs = slugs.map((slug) => ({ slug, kind: 'main' as Kind }));
let n = 0;
const uid = () => `u${n++}`;

function box(items: ReturnType<typeof layout>['items'], scale: number, size: Size = 'L') {
  return items.map((i) => {
    const { w, h } = getAsset(i.slug, size, i.kind).bbox;
    return { x0: i.cx - (w * scale) / 2, x1: i.cx + (w * scale) / 2, y0: i.cy - (h * scale) / 2, y1: i.cy + (h * scale) / 2 };
  });
}

describe('пресеты раскладки', () => {
  for (const size of ['S', 'L'] as const)
    for (const f of FORMATS)
      for (const p of PRESETS)
        it(`${p.name} ${f.id} ${size}: все объекты на холсте`, () => {
          const { scale, items } = layout(inputs, size, f, p.id, uid);
          expect(items).toHaveLength(inputs.length);
          expect(scale).toBeGreaterThan(0);
          for (const b of box(items, scale, size)) {
            expect(b.x0).toBeGreaterThanOrEqual(-0.01);
            expect(b.y0).toBeGreaterThanOrEqual(-0.01);
            expect(b.x1).toBeLessThanOrEqual(f.w + 0.01);
            expect(b.y1).toBeLessThanOrEqual(f.h + 0.01);
          }
        });

  for (const f of FORMATS)
    it(`«Под заголовок» ${f.id} = «Собранно» × один коэффициент + сдвиг, в свободной от текста зоне`, () => {
      const a = layout(inputs, 'L', f, 'assembled', uid);
      const t = layout(inputs, 'L', f, 'underTitle', uid);
      const k = t.scale / a.scale;
      expect(k).toBeLessThan(1);
      for (let i = 1; i < a.items.length; i++) {
        expect(t.items[i].cx - t.items[0].cx).toBeCloseTo((a.items[i].cx - a.items[0].cx) * k, 6);
        expect(t.items[i].cy - t.items[0].cy).toBeCloseTo((a.items[i].cy - a.items[0].cy) * k, 6);
      }
      const area = titleFreeArea(f);
      for (const b of box(t.items, t.scale)) {
        expect(b.x0).toBeGreaterThanOrEqual(area.x - 0.01);
        expect(b.y0).toBeGreaterThanOrEqual(area.y - 0.01);
      }
    });

});

describe('укладка по эталону SVG-drop (телефон на книгу, пазлы на телефон)', () => {
  const main = (...slugs: string[]) => slugs.map((slug) => ({ slug, kind: 'main' as Kind }));
  const offset = (r: ReturnType<typeof layout>, host: string, guest: string) => {
    const h = r.items.find((i) => i.slug === host)!;
    const g = r.items.find((i) => i.slug === guest)!;
    const { w, h: hh } = getAsset(host, 'L', 'main').bbox;
    return { dx: (g.cx - h.cx) / (w * r.scale), dy: (g.cy - h.cy) / (hh * r.scale) };
  };

  it('телефон кладётся на книгу, пазлы на телефон, слоем сразу над основанием', () => {
    const r = layout(main('puzzle', 'lamp', 'phone', 'book'), 'L', FORMATS[1], 'assembled', uid);
    const order = r.items.map((i) => i.slug);
    expect(order.indexOf('phone')).toBe(order.indexOf('book') + 1);
    expect(order.indexOf('puzzle')).toBe(order.indexOf('phone') + 1);
    expect(offset(r, 'book', 'phone').dx).toBeCloseTo(-0.0102, 4);
    expect(offset(r, 'book', 'phone').dy).toBeCloseTo(-0.1499, 4);
    expect(offset(r, 'phone', 'puzzle').dy).toBeCloseTo(-0.1503, 4);
  });

  it('без основания объект встаёт в ряд; второй телефон на ту же книгу не кладётся', () => {
    expect(layout(main('phone', 'pen'), 'L', FORMATS[1], 'assembled', uid).items.map((i) => i.slug).sort()).toEqual(['pen', 'phone']);
    const r = layout(main('book', 'phone', 'phone'), 'L', FORMATS[1], 'assembled', uid);
    const b = r.items.findIndex((i) => i.slug === 'book');
    const [book, onBook] = [r.items[b], r.items[b + 1]];
    const second = r.items.find((i) => i.slug === 'phone' && i !== onBook)!;
    expect((onBook.cy - book.cy) / (getAsset('book', 'L', 'main').bbox.h * r.scale)).toBeCloseTo(-0.1499, 4);
    expect(Math.abs(second.cx - onBook.cx)).toBeGreaterThan(1);
  });
});

describe('упаковка кластером', () => {
  const set = ['lamp', 'headphones', 'wallet', 'coin', 'pen'].map((slug) => ({ slug, kind: 'main' as Kind }));
  const extent = (r: ReturnType<typeof layout>) => {
    const bs = box(r.items, r.scale);
    return { w: Math.max(...bs.map((b) => b.x1)) - Math.min(...bs.map((b) => b.x0)), h: Math.max(...bs.map((b) => b.y1)) - Math.min(...bs.map((b) => b.y0)) };
  };

  it('порядок слоёв — по глубине: чем ниже нижний край объекта, тем выше слой', () => {
    for (const f of FORMATS) {
      const bottoms = box(layout(set, 'L', f, 'assembled', uid).items, layout(set, 'L', f, 'assembled', uid).scale).map((b) => b.y1);
      for (let i = 1; i < bottoms.length; i++) expect(bottoms[i]).toBeGreaterThanOrEqual(bottoms[i - 1] - 1e-6);
    }
  });

  it('форма кластера следует формату: у 1200×630 шире, у 800×1200 выше', () => {
    const wide = extent(layout(set, 'L', FORMATS[1], 'assembled', uid));
    const tall = extent(layout(set, 'L', FORMATS[2], 'assembled', uid));
    expect(wide.w / wide.h).toBeGreaterThan(tall.w / tall.h);
  });

  it('композиция занимает кадр по одной из осей (без полей сверх отступа 6 %)', () => {
    for (const f of FORMATS)
      for (const p of ['assembled', 'offset'] as const) {
        const e = extent(layout(set, 'L', f, p, uid));
        expect(Math.max(e.w / (f.w * 0.88), e.h / (f.h * 0.88))).toBeCloseTo(1, 6);
      }
  });

  it('«Со смещением» — с зазором (силуэты, увеличенные на 5 %, не касаются), «Собранно» — плотнее', () => {
    // допуск 2 % — одна клетка маски, как в проверке наложений ниже
    const touching = (r: ReturnType<typeof layout>, k: number) => pairs(r, 'L', k).filter((p) => p.raw > 0.02).map((p) => `${p.a.slug}/${p.b.slug} ${p.raw.toFixed(3)}`);
    // во сколько раз надо увеличить силуэты, чтобы какие-то два коснулись
    const closeness = (r: ReturnType<typeof layout>) => [1, 1.05, 1.1, 1.15, 1.2, 1.3, 1.4, 1.6].find((k) => touching(r, k).length) ?? 2;
    for (const f of FORMATS) {
      const [a, o] = [layout(set, 'L', f, 'assembled', uid), layout(set, 'L', f, 'offset', uid)];
      expect(touching(o, 1.05), f.id).toEqual([]);
      expect(closeness(a), f.id).toBeLessThan(closeness(o));
    }
  });
});

// --- проверка наложений по силуэтам (masks.json) в координатах холста ---
type It = ReturnType<typeof layout>['items'][number];
const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** k — силуэт, увеличенный от центра объекта (для проверки зазора) */
function shapeOf(it: It, scale: number, size: Size, k = 1) {
  const { w, h } = getAsset(it.slug, size, it.kind).bbox;
  const m = (masks as Record<string, string[]>)[`${it.slug}-${size}-${it.kind}`];
  const cell = (Math.max(w, h) / Math.max(m.length, m[0].length)) * scale * k;
  const [x0, y0] = [it.cx - (w * scale * k) / 2, it.cy - (h * scale * k) / 2];
  const pts: number[][] = [];
  const corners: number[][] = [];
  m.forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch !== '#') return;
      pts.push([x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell]);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) corners.push([x0 + (c + dx) * cell, y0 + (r + dy) * cell]);
    }),
  );
  const ps = corners.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (l: number[][]) => {
    const hh: number[][] = [];
    for (const p of l) {
      while (hh.length >= 2 && cr(hh[hh.length - 2], hh[hh.length - 1], p) <= 0) hh.pop();
      hh.push(p);
    }
    return hh.slice(0, -1);
  };
  const hull = [...half(ps), ...half([...ps].reverse())];
  return {
    it,
    pts,
    cell,
    area: pts.length * cell * cell,
    inRaw: (x: number, y: number) => m[Math.floor((y - y0) / cell)]?.[Math.floor((x - x0) / cell)] === '#',
    inHull: (x: number, y: number) => {
      const s = hull.map((p, i) => cr(p, hull[(i + 1) % hull.length], [x, y]));
      return s.every((v) => v >= 0) || s.every((v) => v <= 0);
    },
  };
}
/** Пары объектов, кроме уложенных друг на друга (stacking.json, в том числе цепочкой: пазлы на телефоне на книге). */
function pairs(r: ReturnType<typeof layout>, size: Size, k = 1) {
  const sh = r.items.map((it) => shapeOf(it, r.scale, size, k));
  const onTop = (g: It, h: It) =>
    stacking.pairs.some((p) => {
      const { w, h: hh } = getAsset(h.slug, size, h.kind).bbox;
      return g.slug === p.guest && h.slug === p.host && Math.abs(g.cx - h.cx - p.dx * w * r.scale) < 1 && Math.abs(g.cy - h.cy - p.dy * hh * r.scale) < 1;
    });
  const grp = r.items.map((_, i) => i);
  const root = (i: number): number => (grp[i] === i ? i : (grp[i] = root(grp[i])));
  r.items.forEach((a, i) => r.items.forEach((b, j) => i !== j && onTop(a, b) && (grp[root(i)] = root(j))));
  const out: { a: It; b: It; ia: number; ib: number; raw: number; hull: number }[] = [];
  for (let i = 0; i < sh.length; i++)
    for (let j = i + 1; j < sh.length; j++) {
      if (root(i) === root(j)) continue;
      // доля меньшего силуэта; считаем по более мелкой сетке
      const [big, fine] = sh[i].cell >= sh[j].cell ? [sh[i], sh[j]] : [sh[j], sh[i]];
      const frac = (inside: (x: number, y: number) => boolean) => (fine.pts.filter(([x, y]) => inside(x, y)).length * fine.cell ** 2) / Math.min(big.area, fine.area);
      out.push({ a: sh[i].it, b: sh[j].it, ia: i, ib: j, raw: frac(big.inRaw), hull: frac(big.inHull) });
    }
  return out;
}
/** Нарушения правил наложения из «Примеров композиций» ТЗ (там силуэты пересекаются только у укладок). */
function violations(r: ReturnType<typeof layout>, size: Size) {
  const bad: string[] = [];
  for (const p of pairs(r, size)) {
    const kinds = [p.a.kind, p.b.kind].sort().join('-');
    const name = `${p.a.slug}(${p.a.kind})/${p.b.slug}(${p.b.kind})`;
    if (kinds === 'main-main' && p.raw > 0.02) bad.push(`главные налегают ${name}`);
    else if (kinds === 'main-main' && p.hull > 0.04) bad.push(`главный под навесом другого ${name}`);
    else if (kinds === 'bg-bg' && p.raw > 0.02) bad.push(`фоновые налегают ${name}`);
    else if (kinds === 'bg-main' && p.raw > 0.08) bad.push(`главный закрывает фоновый ${name}`);
    if (kinds === 'bg-main' && p.raw > 0.02 && (p.ia < p.ib ? p.a : p.b).kind === 'main') bad.push(`фоновый слоем выше главного ${name}`);
  }
  return bad;
}

describe('наложения — только по правилам «Примеров композиций» ТЗ', () => {
  const ins = (spec: string) => spec.split(',').map((s) => (s.startsWith('~') ? { slug: s.slice(1), kind: 'bg' as Kind } : { slug: s, kind: 'main' as Kind }));
  const SL = [...new Set(ASSETS.map((a) => a.slug))];

  it('все пары главных объектов во всех форматах и пресетах: не налегают и не заходят под навес (ручка под абажур лампы)', () => {
    const bad: string[] = [];
    for (let i = 0; i < SL.length; i++)
      for (let j = i + 1; j < SL.length; j++)
        for (const f of FORMATS)
          for (const p of ['assembled', 'offset'] as const) bad.push(...violations(layout(ins(`${SL[i]},${SL[j]}`), 'L', f, p, uid), 'L'));
    expect(bad).toEqual([]);
  });

  // в том числе случай из отчёта: несколько фоновых и главные пазлы на фоновом телефоне
  const mixed = [
    'tulips,lamp,coin,~phone,puzzle,~wallet,~headphones,~pen',
    // тот же набор в порядке добавления из библиотеки (новый фоновый — в начало списка)
    '~pen,~headphones,~wallet,~phone,tulips,lamp,coin,puzzle',
    '~pen,~book,~phone,~wallet,puzzle',
    '~tulips,~book,~pen,~folder,~lamp,phone,puzzle',
    'headphones,coin,~tulips,~lamp,~book',
    'book,phone,puzzle,headphones,lamp,pen',
    'lamp,pen,coin,wallet,tulips',
    'folder,wallet,coin,pen,book,phone,puzzle,lamp,tulips,headphones',
    '~lamp,wallet,coin',
    '~book,puzzle,pen,~coin,~wallet',
  ];
  for (const spec of mixed)
    it(`«${spec}»: ни одного нелогичного наложения во всех форматах, пресетах и размерах`, () => {
      const bad: string[] = [];
      for (const f of FORMATS)
        for (const p of ['assembled', 'offset'] as const) for (const size of ['L', 'S'] as const) bad.push(...violations(layout(ins(spec), size, f, p, uid), size).map((v) => `${f.id} ${p} ${size}: ${v}`));
      expect(bad).toEqual([]);
    });

  it('уложенные на фоновый объект главные (пазлы на фоновом телефоне) — слоем выше всех фоновых', () => {
    const r = layout(ins('tulips,lamp,coin,~phone,puzzle,~wallet,~headphones,~pen'), 'L', FORMATS[1], 'assembled', uid);
    const lastBg = Math.max(...r.items.map((i, k) => (i.kind === 'bg' ? k : -1)));
    expect(r.items.findIndex((i) => i.slug === 'puzzle')).toBeGreaterThan(lastBg);
  });
});

describe('фоновые объекты (как в «Примерах композиций» Figma)', () => {
  const f = FORMATS[0];
  const ins = (...xs: [string, Kind][]) => xs.map(([slug, kind]) => ({ slug, kind }));

  it('фоновый — слоем позади, слева и не ниже 0.4 своей высоты над главными, в том же масштабе; на холсте всё, кроме его верхней половины', () => {
    const r = layout(ins(['headphones', 'main'], ['tulips', 'bg'], ['coin', 'main']), 'L', f, 'assembled', uid);
    expect(r.items.map((i) => `${i.slug}-${i.kind}`)[0]).toBe('tulips-bg');
    expect(r.items).toHaveLength(3);
    const mains = box(r.items.filter((i) => i.kind === 'main'), r.scale);
    const top = Math.min(...mains.map((b) => b.y0));
    const [x0, x1] = [Math.min(...mains.map((b) => b.x0)), Math.max(...mains.map((b) => b.x1))];
    const [bg] = r.items;
    const bgH = getAsset('tulips', 'L', 'bg').bbox.h * r.scale;
    // точка из примеров ТЗ; если там главный закрыл бы фоновый больше чем на 6 %, фоновый поднимается выше
    expect(bg.cx).toBeCloseTo((x0 + x1) / 2 - 0.4 * (x1 - x0), 6);
    expect(bg.cy).toBeLessThanOrEqual(top - 0.4 * bgH + 1e-6);
    expect(bg.cy).toBeGreaterThanOrEqual(-0.01);
    expect(bg.cy + bgH / 2).toBeLessThanOrEqual(f.h + 0.01);
    for (const b of mains) {
      expect(b.x0).toBeGreaterThanOrEqual(-0.01);
      expect(b.y0).toBeGreaterThanOrEqual(-0.01);
      expect(b.x1).toBeLessThanOrEqual(f.w + 0.01);
      expect(b.y1).toBeLessThanOrEqual(f.h + 0.01);
    }
  });

  it('главные пазлы ложатся на фоновую книгу (левая страница)', () => {
    const r = layout(ins(['book', 'bg'], ['puzzle', 'main'], ['pen', 'main']), 'L', f, 'assembled', uid);
    expect(r.items.map((i) => `${i.slug}-${i.kind}`)).toEqual(['book-bg', 'puzzle-main', 'pen-main']);
    const [book, puzzle] = r.items;
    const { w, h } = getAsset('book', 'L', 'bg').bbox;
    expect((puzzle.cx - book.cx) / (w * r.scale)).toBeCloseTo(-0.1713, 4);
    expect((puzzle.cy - book.cy) / (h * r.scale)).toBeCloseTo(0.0005, 4);
  });

  it('фоновый объект ни на что не кладётся; без главных фоновые встают в ряд', () => {
    const r = layout(ins(['book', 'main'], ['phone', 'bg']), 'L', f, 'assembled', uid);
    expect(r.items.map((i) => i.slug)).toEqual(['phone', 'book']);
    const only = layout(ins(['lamp', 'bg'], ['wallet', 'bg']), 'L', f, 'assembled', uid);
    for (const b of box(only.items, only.scale)) expect(b.y0).toBeGreaterThanOrEqual(-0.01);
  });

  it('«Под заголовок» с фоновым — по-прежнему «Собранно» × один коэффициент + сдвиг', () => {
    const x = ins(['tulips', 'bg'], ['headphones', 'main'], ['lamp', 'main']);
    const a = layout(x, 'L', FORMATS[1], 'assembled', uid);
    const t = layout(x, 'L', FORMATS[1], 'underTitle', uid);
    const k = t.scale / a.scale;
    for (let i = 1; i < a.items.length; i++) expect(t.items[i].cx - t.items[0].cx).toBeCloseTo((a.items[i].cx - a.items[0].cx) * k, 6);
  });
});
