// assets/objects/*.svg → src/data/masks.json: силуэт каждого объекта сеткой (до 20 клеток по длинной стороне).
// Раскладка прикладывает объекты друг к другу по силуэтам, а не по рамкам: у изометрических объектов углы рамки пустые.
// Растеризация — в Chromium из Playwright (devDependency), только при сборке данных; в рантайме масок не считаем.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('src/data/manifest.json', root), 'utf8'));
const N = 20; // клеток по длинной стороне
const PX = 8; // пикселей растра на клетку

const browser = await chromium.launch();
const page = await browser.newPage();
const masks = {};
for (const a of manifest) {
  const svg = await readFile(new URL(`assets/objects/${a.file}`, root), 'utf8');
  const cell = Math.max(a.bbox.w, a.bbox.h) / N;
  const cols = Math.ceil(a.bbox.w / cell);
  const rows = Math.ceil(a.bbox.h / cell);
  // клетка занята, если непрозрачна хотя бы четверть её пикселей
  masks[a.id] = await page.evaluate(
    async ({ svg, cols, rows, w, h, cell, PX }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = cols * PX;
      c.height = rows * PX;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, (w / cell) * PX, (h / cell) * PX);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const out = [];
      for (let r = 0; r < rows; r++) {
        let line = '';
        for (let k = 0; k < cols; k++) {
          let n = 0;
          for (let y = r * PX; y < (r + 1) * PX; y++) for (let x = k * PX; x < (k + 1) * PX; x++) n += data[(y * c.width + x) * 4 + 3] > 16 ? 1 : 0;
          line += n >= (PX * PX) / 4 ? '#' : '.';
        }
        out.push(line);
      }
      return out;
    },
    { svg, cols, rows, w: a.bbox.w, h: a.bbox.h, cell, PX },
  );
}
await browser.close();
await writeFile(new URL('src/data/masks.json', root), JSON.stringify(masks, null, 1) + '\n');
console.log(`masks: ${Object.keys(masks).length}`);
