import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSETS, FORMATS, SCHEMES, SOURCE_SCHEME, type Kind } from '../src/core/catalog';
import { layout } from '../src/core/layout';
import { renderSvg, svgBody, type Composition } from '../src/core/render';

const bodies = Object.fromEntries(ASSETS.map((a) => [a.file, svgBody(readFileSync(`assets/objects/${a.file}`, 'utf8'))]));
const slugs = [...new Set(ASSETS.filter((a) => a.size === 'L' && a.kind === 'main').map((a) => a.slug))].slice(0, 4);

function comp(scheme: string): Composition {
  const { scale, items } = layout(slugs.map((slug) => ({ slug, kind: 'main' as Kind })), 'L', FORMATS[1], 'assembled');
  return { format: FORMATS[1], size: 'L', scheme, scale, items: [...items, { ...items[0], uid: 'dup' }] };
}

describe('экспорт SVG', () => {
  for (const s of SCHEMES)
    it(`схема ${s.name}: валидный XML, только вектор, цвета схемы`, () => {
      const svg = renderSvg(comp(s.id), bodies);
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 1200 630');
      expect(svg).not.toMatch(/<image\b|data:image|<foreignObject/);
      const ids = [...doc.querySelectorAll('[id]')].map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(doc.querySelector('#background')!.getAttribute('fill')).toBe(s.colors.bg1);
      const used = new Set(svg.match(/#[0-9a-f]{6}\b/g));
      const palette = new Set(Object.values(s.colors));
      // цвета схемы-источника, которых нет в целевой схеме, после перекраски не остаются
      for (const c of Object.values(SOURCE_SCHEME.colors)) if (!palette.has(c)) expect(used.has(c), c).toBe(false);
    });

  it('пути объектов копируются без изменений', () => {
    const a = ASSETS.find((x) => x.slug === slugs[0] && x.size === 'L' && x.kind === 'main')!;
    const ds = bodies[a.file].match(/ d="[^"]+"/g)!;
    const svg = renderSvg(comp('teal'), bodies);
    for (const d of ds) expect(svg).toContain(d);
  });
});

describe('декоративные фоны', () => {
  const decor = Object.fromEntries(
    ['confetti', 'blob'].flatMap((d) => FORMATS.map((f) => `decor-${d}-${f.id}.svg`)).map((f) => [f, svgBody(readFileSync(`assets/decor/${f}`, 'utf8'))]),
  );
  for (const s of SCHEMES)
    for (const d of ['confetti', 'blob'] as const)
      it(`${d} · ${s.name}: под объектами, вектор, только цвета фона схемы`, () => {
        const svg = renderSvg({ ...comp(s.id), decor: d }, { ...bodies, ...decor });
        const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(doc.querySelector('parsererror')).toBeNull();
        const g = doc.querySelector('#decor')!;
        expect(g.previousElementSibling!.id).toBe('background');
        expect(g.querySelector('path')).not.toBeNull();
        expect(g.outerHTML).not.toMatch(/<image\b|data:image/);
        const allowed = [s.colors.bg1, s.colors.bg2, s.colors.bg3, s.colors.ink];
        for (const c of new Set(g.outerHTML.match(/#[0-9a-f]{6}\b/g))) expect(allowed, c).toContain(c);
      });
});
