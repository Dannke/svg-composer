import { describe, expect, it } from 'vitest';
import { ASSETS, FORMATS, getAsset, PRESETS, type Kind } from '../src/core/catalog';
import { layout, titleFreeArea } from '../src/core/layout';

const slugs = [...new Set(ASSETS.filter((a) => a.size === 'L' && a.kind === 'main').map((a) => a.slug))].slice(0, 5);
const inputs = slugs.map((slug) => ({ slug, kind: 'main' as Kind }));
let n = 0;
const uid = () => `u${n++}`;

function box(items: ReturnType<typeof layout>['items'], scale: number) {
  return items.map((i) => {
    const { w, h } = getAsset(i.slug, 'L', i.kind).bbox;
    return { x0: i.cx - (w * scale) / 2, x1: i.cx + (w * scale) / 2, y0: i.cy - (h * scale) / 2, y1: i.cy + (h * scale) / 2 };
  });
}

describe('пресеты раскладки', () => {
  for (const f of FORMATS)
    for (const p of PRESETS)
      it(`${p.name} ${f.id}: все объекты на холсте`, () => {
        const { scale, items } = layout(inputs, 'L', f, p.id, uid);
        expect(items).toHaveLength(inputs.length);
        expect(scale).toBeGreaterThan(0);
        for (const b of box(items, scale)) {
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

  it('«Со смещением» разносит объекты шире, чем «Собранно»', () => {
    const f = FORMATS[1];
    const spread = (r: ReturnType<typeof layout>) => Math.abs(r.items[r.items.length - 1].cx - r.items[0].cx) / r.scale;
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

  it('телефон кладётся на книгу, пазлы на телефон, слоем выше основания', () => {
    const r = layout(main('puzzle', 'lamp', 'phone', 'book'), 'L', FORMATS[1], 'assembled', uid);
    expect(r.items.map((i) => i.slug)).toEqual(['lamp', 'book', 'phone', 'puzzle']);
    expect(offset(r, 'book', 'phone').dx).toBeCloseTo(-0.0102, 4);
    expect(offset(r, 'book', 'phone').dy).toBeCloseTo(-0.1499, 4);
    expect(offset(r, 'phone', 'puzzle').dy).toBeCloseTo(-0.1503, 4);
  });

  it('без основания объект встаёт в ряд; второй телефон на ту же книгу не кладётся', () => {
    expect(layout(main('phone', 'pen'), 'L', FORMATS[1], 'assembled', uid).items.map((i) => i.slug)).toEqual(['phone', 'pen']);
    const r = layout(main('book', 'phone', 'phone'), 'L', FORMATS[1], 'assembled', uid);
    const [, onBook, second] = r.items;
    expect(offset(r, 'book', 'phone').dy).toBeCloseTo(-0.1499, 4);
    expect(Math.abs(second.cx - onBook.cx)).toBeGreaterThan(1);
  });
});

describe('фоновые объекты (как в «Примерах композиций» Figma)', () => {
  const f = FORMATS[0];
  const ins = (...xs: [string, Kind][]) => xs.map(([slug, kind]) => ({ slug, kind }));

  it('фоновый — слоем позади, выше главных на 0.4 своей высоты, в том же масштабе; на холсте всё, кроме его верхней половины', () => {
    const r = layout(ins(['headphones', 'main'], ['tulips', 'bg'], ['coin', 'main']), 'L', f, 'assembled', uid);
    expect(r.items.map((i) => `${i.slug}-${i.kind}`)).toEqual(['tulips-bg', 'headphones-main', 'coin-main']);
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
