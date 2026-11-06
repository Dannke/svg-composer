import { describe, expect, it } from 'vitest';
import { ASSETS, FORMATS, getAsset, PRESETS, type Kind, type Size } from '../src/core/catalog';
import { layout, titleFreeArea } from '../src/core/layout';
import masks from '../src/data/masks.json';

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

  for (const f of FORMATS)
    it(`«Со смещением» ${f.id} разносит объекты шире, чем «Собранно»`, () => {
    // размах центров по обеим осям в единицах объектов (без масштаба): при нескольких рядах крайние объекты могут стоять в одном столбце
    const spread = (r: ReturnType<typeof layout>) =>
      (['cx', 'cy'] as const).reduce((sum, k) => sum + (Math.max(...r.items.map((i) => i[k])) - Math.min(...r.items.map((i) => i[k]))), 0) / r.scale;
    expect(spread(layout(inputs, 'L', f, 'offset', uid))).toBeGreaterThan(spread(layout(inputs, 'L', f, 'assembled', uid)));
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

  // доля силуэта объекта (маска из masks.json), закрытая объектами слоями выше
  const hidden = (r: ReturnType<typeof layout>) =>
    r.items.map((it, i) => {
      const cells = (o: (typeof r.items)[0]) => {
        const { w, h } = getAsset(o.slug, 'L', o.kind).bbox;
        const m = (masks as Record<string, string[]>)[`${o.slug}-L-${o.kind}`];
        const cell = Math.max(w, h) / Math.max(m.length, m[0].length);
        return { m, cell, x0: o.cx - (w * r.scale) / 2, y0: o.cy - (h * r.scale) / 2 };
      };
      const me = cells(it);
      const above = r.items.slice(i + 1).map(cells);
      let total = 0;
      let covered = 0;
      me.m.forEach((row, ry) =>
        [...row].forEach((ch, cx) => {
          if (ch !== '#') return;
          total++;
          const x = me.x0 + (cx + 0.5) * me.cell * r.scale;
          const y = me.y0 + (ry + 0.5) * me.cell * r.scale;
          const hit = above.some((o) => o.m[Math.floor((y - o.y0) / (o.cell * r.scale))]?.[Math.floor((x - o.x0) / (o.cell * r.scale))] === '#');
          if (hit) covered++;
        }),
      );
      return covered / total;
    });

  it('«Собранно»: соседи налегают друг на друга, но каждый объект виден минимум на 75 %', () => {
    for (const f of FORMATS) {
      const r = layout(set, 'L', f, 'assembled', uid);
      const h = hidden(r);
      for (const x of h) expect(x).toBeLessThan(0.25);
      expect(Math.max(...h)).toBeGreaterThan(0); // хоть кто-то налегает — это не ряд с промежутками
    }
  });

  it('«Со смещением»: объекты не перекрывают друг друга (допуск — край клетки маски)', () => {
    for (const f of FORMATS) for (const x of hidden(layout(set, 'L', f, 'offset', uid))) expect(x).toBeLessThan(0.05);
  });
});

describe('фоновые объекты (как в «Примерах композиций» Figma)', () => {
  const f = FORMATS[0];
  const ins = (...xs: [string, Kind][]) => xs.map(([slug, kind]) => ({ slug, kind }));

  it('фоновый — слоем позади, выше главных на 0.4 своей высоты, в том же масштабе; на холсте всё, кроме его верхней половины', () => {
    const r = layout(ins(['headphones', 'main'], ['tulips', 'bg'], ['coin', 'main']), 'L', f, 'assembled', uid);
    expect(r.items.map((i) => `${i.slug}-${i.kind}`)[0]).toBe('tulips-bg');
    expect(r.items).toHaveLength(3);
    const mains = box(r.items.filter((i) => i.kind === 'main'), r.scale);
    const top = Math.min(...mains.map((b) => b.y0));
    const [bg] = r.items;
    const bgH = getAsset('tulips', 'L', 'bg').bbox.h * r.scale;
    expect(bg.cy).toBeCloseTo(top - 0.4 * bgH, 6);
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
