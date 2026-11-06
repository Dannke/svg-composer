// Короткая демонстрация для README: Playwright проходит оба сценария и правки, кадры склеиваются в APNG.
// Запуск: node scripts/record-demo.mjs [адрес сервиса] → docs/demo.png (анимированный PNG, без зависимостей кроме Playwright).
import { writeFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'https://svg-composer.svg-composer.workers.dev';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
const frames = [];
const shot = async (ms) => {
  await page.waitForTimeout(600); // переезды и появление объектов анимированы
  frames.push({ png: await page.screenshot(), ms });
};
const id = (t) => page.getByTestId(t);

await page.goto(base);
await shot(1200);
// сценарий А: метафора → LLM подбирает объекты
await id('metaphor').fill('Как накопить на мечту: бюджет и экономия');
await shot(900);
await id('metaphor-go').click();
await page.getByTestId('status').filter({ hasText: /LLM|ключевым/ }).waitFor({ timeout: 15_000 });
await shot(2200);
await id('format-800x1200').click();
await shot(1400);
await id('preset-offset').click();
await shot(1400);
// сценарий Б: названия с опечаткой и словоформой
await id('format-1200x630').click();
await id('names').fill('лампу, нушники, книга, телефон, пазлы, ручка');
await shot(900);
await id('names-go').click();
await shot(2200);
await id('size-S').click();
await shot(1300);
for (const s of ['peach', 'teal']) {
  await id(`scheme-${s}`).click();
  await shot(1300);
}
// правка: выбор слоя и поворот ручкой на холсте
await id('layers').getByRole('button').first().click();
await shot(1000);
const h = await id('rotate-handle').boundingBox();
const f = await page.locator('.selection').boundingBox();
await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
await page.mouse.down();
await page.mouse.move(f.x + f.width / 2 + 120, f.y + f.height / 2 - 70, { steps: 4 });
await page.mouse.up();
await shot(1300);
// своя палитра из JSON; панель — к статусу, чтобы было видно сообщение о загрузке
await page.locator('.panel').evaluate((el) => el.scrollTo(0, 0));
await id('palette-file').setInputFiles('public/palette-example.json');
await shot(2400);
await browser.close();

// APNG: IHDR первого кадра, acTL, на каждый кадр fcTL + IDAT (первый) / fdAT (остальные), IEND
const parse = (buf) => {
  const out = [];
  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    out.push({ type: buf.toString('ascii', p + 4, p + 8), data: buf.subarray(p + 8, p + 8 + len) });
    p += 12 + len;
  }
  return out;
};
const chunk = (type, data) => {
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const u32 = (...v) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeUInt32BE(x); return b; }));
const ihdr = parse(frames[0].png).find((c) => c.type === 'IHDR').data;
const [w, h2] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4)];
const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', u32(frames.length, 0))];
let seq = 0;
frames.forEach(({ png, ms }, i) => {
  const cs = parse(png);
  if (!cs.find((c) => c.type === 'IHDR').data.equals(ihdr)) throw new Error('кадры разного формата');
  const delay = Buffer.alloc(4);
  delay.writeUInt16BE(ms, 0);
  delay.writeUInt16BE(1000, 2);
  parts.push(chunk('fcTL', Buffer.concat([u32(seq++, w, h2, 0, 0), delay, Buffer.from([0, 0])])));
  for (const c of cs.filter((c) => c.type === 'IDAT')) parts.push(i === 0 ? chunk('IDAT', c.data) : chunk('fdAT', Buffer.concat([u32(seq++), c.data])));
});
parts.push(chunk('IEND', Buffer.alloc(0)));
const out = Buffer.concat(parts);
writeFileSync('docs/demo.png', out);
console.log(`docs/demo.png: ${frames.length} кадров, ${(out.length / 1e6).toFixed(1)} МБ`);
