// Генерирует examples/*.svg тем же кодом, что и веб-сервис (сценарии А и Б).
import { readFileSync, writeFileSync } from 'node:fs';
import { ASSETS, FORMATS, OBJECTS, type Kind, type Preset, type Size } from '../src/core/catalog';
import { layout } from '../src/core/layout';
import { matchNames } from '../src/core/match';
import { renderSvg, svgBody } from '../src/core/render';
import { compose } from '../src/server/compose';

const bodies = Object.fromEntries(ASSETS.map((a) => [a.file, svgBody(readFileSync(`assets/objects/${a.file}`, 'utf8'))]));

const examples: { file: string; scenario: 'А' | 'Б'; query: string; format: string; size: Size; scheme: string; preset?: Preset }[] = [
  { file: '01-finance-peach-1200x630.svg', scenario: 'А', query: 'Как накопить на мечту: деньги, бюджет и идеи для экономии', format: '1200x630', size: 'L', scheme: 'peach' },
  { file: '02-study-lilac-1000x1000.svg', scenario: 'Б', query: 'лампа, книга, ручка, наушники', format: '1000x1000', size: 'L', scheme: 'lilac', preset: 'offset' },
  { file: '03-spring-teal-800x1200.svg', scenario: 'А', query: 'Весенний вечер дома: цветы, музыка и открытка маме', format: '800x1200', size: 'S', scheme: 'teal', preset: 'underTitle' },
];

const lines = ['# Примеры композиций', '', 'Сгенерированы `npm run examples` тем же кодом, что и сервис.', ''];
for (const ex of examples) {
  const format = FORMATS.find((f) => f.id === ex.format)!;
  let slugs: string[];
  let preset = ex.preset ?? 'assembled';
  let note = '';
  if (ex.scenario === 'А') {
    const r = await compose(ex.query, { apiKey: process.env.OPENROUTER_API_KEY });
    slugs = r.slugs;
    preset = ex.preset ?? r.preset;
    note = r.source === 'llm' ? `LLM ${r.model}` : 'запасной режим: поиск по смысловым тегам';
  } else {
    slugs = matchNames(ex.query, OBJECTS).slugs;
    note = 'разбор названий';
  }
  const { scale, items } = layout(slugs.map((slug) => ({ slug, kind: 'main' as Kind })), ex.size, format, preset, () => '');
  writeFileSync(`examples/${ex.file}`, renderSvg({ format, size: ex.size, scheme: ex.scheme, scale, items }, bodies));
  lines.push(
    `## ${ex.file}`,
    '',
    `![](${ex.file})`,
    '',
    `- Сценарий ${ex.scenario}: «${ex.query}» (${note})`,
    `- Объекты: ${slugs.join(', ')} · пресет ${preset} · ${ex.format} · размер ${ex.size} · схема ${ex.scheme}`,
    '',
  );
  console.log(ex.file, slugs.join(','), preset);
}
writeFileSync('examples/README.md', lines.join('\n'));
