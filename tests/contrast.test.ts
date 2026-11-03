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
// color-mix(in srgb, accent 60%, #181817) — токен --primary
const mix = (a: string, b: string, p: number) =>
  '#' + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

// ink — чёрный 95 % на белом; SCHEME_INK — чернила схем, с которыми смешивается --primary
const INK = '#0d0d0d', SECONDARY = '#31302e', MUTED = '#615d59', WHITE = '#ffffff', BG = '#f6f5f4', DANGER = '#b42318', SCHEME_INK = '#181817';

describe('контраст интерфейса (WCAG AA)', () => {
  it('нейтральные цвета текста', () => {
    for (const bg of [WHITE, BG]) for (const fg of [INK, SECONDARY, MUTED, DANGER]) expect(contrast(fg, bg), `${fg} на ${bg}`).toBeGreaterThanOrEqual(4.5);
  });

  for (const s of SCHEMES)
    it(`схема ${s.name}`, () => {
      const primary = mix(s.colors.bg3, SCHEME_INK, 0.6);
      expect(contrast(WHITE, primary), 'белый текст на основной кнопке').toBeGreaterThanOrEqual(4.5);
      expect(contrast(primary, BG), 'индикатор/фокус на тёплом фоне').toBeGreaterThanOrEqual(3);
      expect(contrast(primary, s.colors.bg1), 'рамка выделения на холсте').toBeGreaterThanOrEqual(3);
      expect(contrast(SECONDARY, s.colors.bg1), 'текст пустого состояния на холсте').toBeGreaterThanOrEqual(4.5);
    });
});
