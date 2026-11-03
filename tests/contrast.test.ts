import { describe, expect, it } from 'vitest';
import { SCHEMES } from '../src/core/catalog';

// WCAG 2.1: относительная яркость и контраст. Пары повторяют токены из src/styles.css.
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// color-mix(in srgb, accent 60%, ink)
const mix = (a: string, b: string, p: number) =>
  '#' + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

const INK = '#181817', MUTED = '#5c5b57', WHITE = '#ffffff', BG = '#f4f4f2', DANGER = '#b42318';

describe('контраст интерфейса (WCAG AA)', () => {
  it('нейтральные цвета текста', () => {
    for (const bg of [WHITE, BG]) for (const fg of [INK, MUTED, DANGER]) expect(contrast(fg, bg), `${fg} на ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  for (const s of SCHEMES)
    it(`схема ${s.name}`, () => {
      const strong = mix(s.colors.bg3, INK, 0.6);
      expect(contrast(INK, s.colors.bg1), 'текст на активном элементе').toBeGreaterThanOrEqual(4.5);
      expect(contrast(strong, WHITE), 'рамка/фокус на белом').toBeGreaterThanOrEqual(4.5);
      expect(contrast(strong, s.colors.bg1), 'рамка выделения на холсте').toBeGreaterThanOrEqual(3);
    });
});
