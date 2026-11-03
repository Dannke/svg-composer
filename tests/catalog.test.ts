import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSETS, CANVAS_ROLE, OBJECTS, ROLES, SCHEMES } from '../src/core/catalog';

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

  it('фоновые (монохромные) объекты используют только цвета фона', () => {
    for (const a of ASSETS.filter((x) => x.kind === 'bg'))
      for (const role of Object.keys(a.colorRoles)) expect(ROLES[role], `${a.id}: ${role}`).toBe('background');
  });
});

describe('цветовые схемы (schemes.json)', () => {
  it('у каждой схемы заданы все роли', () => {
    for (const s of SCHEMES) expect(Object.keys(s.colors).sort()).toEqual(Object.keys(ROLES).sort());
  });
  it('фон холста — цвет из группы «фон»', () => {
    expect(ROLES[CANVAS_ROLE]).toBe('background');
  });
});
