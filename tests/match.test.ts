import { describe, expect, it } from 'vitest';
import { OBJECTS } from '../src/core/catalog';
import { matchNames, matchTags, wordMatches } from '../src/core/match';

describe('сценарий Б: разбор названий', () => {
  it('синонимы, словоформы, регистр и ё', () => {
    expect(matchNames('Лампа, наушниками и КНИЖКУ', OBJECTS).slugs).toEqual(['lamp', 'headphones', 'book']);
    expect(matchNames('смартфон; кошелёк + букет', OBJECTS).slugs).toEqual(['phone', 'wallet', 'tulips']);
  });
  it('опечатки', () => {
    expect(matchNames('лмпа нушники телфон тюльпнаы', OBJECTS).slugs).toEqual(['lamp', 'headphones', 'phone', 'tulips']);
  });
  it('неизвестные слова возвращаются отдельно, повторы схлопываются', () => {
    const r = matchNames('ручка ручку самолёт', OBJECTS);
    expect(r.slugs).toEqual(['pen']);
    expect(r.unknown).toEqual(['самолет']);
  });
  it('«фон», «фоновый», «фоновые» делают следующий объект фоновым', () => {
    expect(matchNames('наушники, фоновые тюльпаны', OBJECTS)).toMatchObject({ slugs: ['headphones'], background: ['tulips'], unknown: [] });
    expect(matchNames('фон: лампа; кошелёк и монета', OBJECTS)).toMatchObject({ slugs: ['wallet', 'coin'], background: ['lamp'] });
    expect(matchNames('фоновая книга, пазлы, ручка, книга', OBJECTS)).toMatchObject({ slugs: ['puzzle', 'pen'], background: ['book'] });
  });
  it('нет ложных совпадений между похожими словами', () => {
    expect(wordMatches('телевизор', 'телефон')).toBe(false);
    expect(wordMatches('папка', 'пазл')).toBe(false);
  });
});

describe('запасной режим сценария А: теги', () => {
  it('метафора → подходящие объекты', () => {
    expect(matchTags('Как накопить деньги и не тратить на покупки', OBJECTS)).toEqual(expect.arrayContaining(['coin', 'wallet']));
    expect(matchTags('Идея, которая решает задачу', OBJECTS)).toEqual(expect.arrayContaining(['lamp', 'puzzle']));
    expect(matchTags('абракадабра', OBJECTS)).toEqual([]);
  });
});
