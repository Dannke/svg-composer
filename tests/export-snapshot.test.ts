import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { ASSETS, FORMATS, SCHEMES, type Kind, type Size } from '../src/core/catalog';
import { layout } from '../src/core/layout';
import { renderSvg, svgBody, type Composition } from '../src/core/render';

// Снимок экспорта сделан до редизайна интерфейса: UI не должен менять ни байта в SVG.
const bodies = Object.fromEntries(ASSETS.map((a) => [a.file, svgBody(readFileSync(`assets/objects/${a.file}`, 'utf8'))]));

function fixed(size: Size, schemeIdx: number, formatIdx: number): Composition {
  let n = 0;
  const inputs = ['lamp', 'headphones', 'phone', 'book', 'puzzle', 'pen'].map((slug, i) => ({ slug, kind: (i % 3 ? 'main' : 'bg') as Kind }));
  const { scale, items } = layout(inputs, size, FORMATS[formatIdx], 'offset', () => `u${n++}`);
  items[1].rotation = 30;
  return { format: FORMATS[formatIdx], size, scheme: SCHEMES[schemeIdx].id, scale, items: [...items, { ...items[0], uid: 'dup', cx: items[0].cx + 30 }] };
}

it('renderSvg совпадает со снимком байт в байт', async () => {
  const svg = [fixed('L', 0, 1), fixed('S', 1, 0), fixed('L', 2, 2)].map((c) => renderSvg(c, bodies)).join('\n<!-- next -->\n');
  await expect(svg).toMatchFileSnapshot('__snapshots__/export.svg');
});
