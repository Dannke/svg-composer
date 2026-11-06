import { describe, expect, it } from 'vitest';
import { SCHEMES } from '../src/core/catalog';
import { contrast, mix } from '../src/core/palette';

// WCAG-контраст и смесь как у токена --primary — те же функции, что проверяют загруженные палитры (src/core/palette.ts)
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
