import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCHEMES, SOURCE_SCHEME } from '../src/core/catalog';
import { addSchemes, parsePalettes, uiAccent, validateScheme } from '../src/core/palette';
import { canvasColor, recolor } from '../src/core/render';

const colors = { bg1: '#d4f0e4', bg2: '#9fdcc2', bg3: '#3f9f7c', obj1: '#ffe9a8', obj2: '#ff9e8a', obj3: '#ffd9cf' };

describe('загрузка своей палитры (JSON)', () => {
  it('пример из public/palette-example.json проходит проверку', () => {
    const [s] = parsePalettes(readFileSync('public/palette-example.json', 'utf8'));
    expect(s).toMatchObject({ id: 'mint', name: 'Мятная' });
    expect(s.colors).toMatchObject({ ...colors, ink: '#181817', white: '#ffffff' });
  });

  it('файл в формате schemes.json — несколько палитр; #rgb разворачивается, регистр не важен', () => {
    const list = parsePalettes(JSON.stringify({ schemes: [{ name: 'A', colors }, { name: 'B', colors: { ...colors, obj1: '#ABC' } }] }));
    expect(list.map((s) => s.name)).toEqual(['A', 'B']);
    expect(list[1].colors.obj1).toBe('#aabbcc');
    expect(list[0].id).toMatch(/^custom-/);
  });

  it.each([
    ['не JSON', '{oops', /JSON/],
    ['нет colors', '{"name":"x"}', /colors/],
    ['цвет не #rrggbb', JSON.stringify({ colors: { ...colors, bg2: 'green' } }), /bg2/],
    ['нет роли', JSON.stringify({ colors: { ...colors, obj3: undefined } }), /obj3/],
    ['лишняя роль (чёрный и белый общие)', JSON.stringify({ colors: { ...colors, white: '#fefefe' } }), /white/],
    ['цвет объекта среди цветов фона', JSON.stringify({ colors: { ...colors, obj2: colors.bg2 } }), /нельзя использовать в фонах/],
    ['белый (цвет объектов) в фоне', JSON.stringify({ colors: { ...colors, bg1: '#FFFFFF' } }), /#ffffff/],
    ['id встроенной схемы', JSON.stringify({ id: 'lilac', colors }), /встроенной/],
  ])('отклоняется: %s', (_, text, err) => {
    expect(() => parsePalettes(text)).toThrow(err);
  });

  it('добавленная палитра перекрашивает объекты и фон по ролям; повторная загрузка того же id заменяет её', () => {
    const s = validateScheme({ id: 'mint', name: 'Мятная', colors });
    addSchemes([s]);
    expect(canvasColor('mint')).toBe(colors.bg1);
    const src = SOURCE_SCHEME.colors;
    expect(recolor(`<path fill="${src.bg3}"/><path fill="${src.obj2}"/><path fill="${src.ink}"/>`, 'mint')).toBe(
      `<path fill="${colors.bg3}"/><path fill="${colors.obj2}"/><path fill="#181817"/>`,
    );
    addSchemes([validateScheme({ id: 'mint', name: 'Мятная 2', colors })]);
    expect(SCHEMES.filter((x) => x.id === 'mint').map((x) => x.name)).toEqual(['Мятная 2']);
  });

  it('акцент интерфейса: светлый bg3 без контраста AA заменяется акцентом исходной схемы', () => {
    expect(uiAccent(validateScheme({ colors }))).toBe(colors.bg3);
    expect(uiAccent(validateScheme({ colors: { ...colors, bg3: '#e8fff4' } }))).toBe(SOURCE_SCHEME.colors.bg3);
    for (const s of SCHEMES.slice(0, 3)) expect(uiAccent(s)).toBe(s.colors.bg3);
  });
});
