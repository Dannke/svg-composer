import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSETS, CANVAS_ROLE, OBJECTS, ROLES, S_TO_L, SCHEMES, getAsset } from '../src/core/catalog';

describe('каталог объектов (manifest.json)', () => {
  it('10 объектов × 2 вида × 2 размера', () => {
    expect(OBJECTS).toHaveLength(10);
    for (const o of OBJECTS)
      for (const size of ['S', 'L'])
        for (const kind of ['main', 'bg'])
          expect(ASSETS.some((a) => a.slug === o.slug && a.size === size && a.kind === kind), `${o.slug}-${size}-${kind}`).toBe(true);
  });

  it('каждый SVG векторный: есть пути, нет <image> и base64', () => {
    for (const a of ASSETS) {
      const svg = readFileSync(`assets/objects/${a.file}`, 'utf8');
      expect(svg).toMatch(/<path\b/);
      expect(svg).not.toMatch(/<image\b|data:image/);
      expect(a.bbox.w).toBeGreaterThan(0);
      expect(a.bbox.h).toBeGreaterThan(0);
    }
  });

  it('S нарисованы ≈1:2 к L (S_TO_L): у монеты и тюльпанов в Figma 1,87 и 1,82, у остальных 2,0', () => {
    for (const a of ASSETS.filter((x) => x.size === 'L')) {
      const s = getAsset(a.slug, 'S', a.kind);
      const r = a.bbox.w / s.bbox.w;
      expect(r, a.id).toBeGreaterThan(['coin', 'tulips'].includes(a.slug) ? 1.8 : 1.9);
      expect(r, a.id).toBeLessThan(S_TO_L + 0.1);
    }
  });

  it('фоновые (монохромные) объекты используют только цвета фона', () => {
    for (const a of ASSETS.filter((x) => x.kind === 'bg'))
      for (const role of Object.keys(a.colorRoles)) expect(ROLES[role], `${a.id}: ${role}`).toBe('background');
  });
});

describe('цветовые схемы (schemes.json)', () => {
  it('у каждой схемы заданы все роли', () => {
    for (const s of SCHEMES) expect(Object.keys(s.colors).sort()).toEqual(Object.keys(ROLES).sort());
  });
  it('схема задаёт только свои 3 цвета фона и 3 цвета объектов; чёрный и белый — общие', () => {
    const raw = JSON.parse(readFileSync('src/data/schemes.json', 'utf8'));
    expect(Object.keys(raw.neutrals).sort()).toEqual(['ink', 'white']);
    for (const s of raw.schemes) expect(Object.keys(s.colors).sort()).toEqual(['bg1', 'bg2', 'bg3', 'obj1', 'obj2', 'obj3']);
  });
  it('фон холста — цвет из группы «фон»', () => {
    expect(ROLES[CANVAS_ROLE]).toBe('background');
  });
});
