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
