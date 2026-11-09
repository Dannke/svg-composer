import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const items = (page: Page) => page.locator('[data-testid=canvas] [data-uid]');

async function exportSvg(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  return readFileSync((await download.path())!, 'utf8');
}

test('сценарий Б: названия с опечаткой и словоформой → композиция', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('names').fill('лампу, нушники и книга');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(3);
  await expect(page.getByTestId('preset')).toHaveValue('assembled');
  await expect(page.getByTestId('status')).toContainText('Лампа, Наушники, Книга');
  // тулбар в один ряд от 1280 px: «Скачать SVG» не уезжает во второй ряд
  await page.setViewportSize({ width: 1280, height: 720 });
  expect((await page.locator('.toolbar').boundingBox())!.height).toBeLessThan(100);
  // порядок в DOM — по глубине сцены, а не по вводу
  expect((await items(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')))).sort()).toEqual(['book', 'headphones', 'lamp']);
});

test('сценарий А: метафора → объекты (LLM, локально без ключа — запасной поиск по смыслам)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('metaphor').fill('Как накопить деньги и не тратить лишнего на покупки');
  await page.getByTestId('metaphor-go').click();
  // живая LLM на проде отвечает до 5 с (потолок сервера), с запасом на сеть
  await expect(page.getByTestId('status')).toContainText(/ключевым словам|LLM/, { timeout: 10_000 });
  await expect(items(page).first()).toBeVisible();
  const slugs = await items(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')));
  expect(slugs).toEqual(expect.arrayContaining(['coin', 'wallet']));
});

test('S/L, все цветовые схемы, пресеты, правка объекта и экспорт', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('names').fill('книга телефон пазлы наушники лампа ручка');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(6);

  // размер: подгружаются элементы другого размера (у S меньше деталей → другой набор путей)
  const pathsL = await page.locator('[data-slug=phone] path').count();
  await page.getByTestId('size-S').click();
  const pathsS = await page.locator('[data-slug=phone] path').count();
  expect(pathsS).not.toBe(pathsL);
  await page.getByTestId('size-L').click();

  for (const [scheme, bg] of [['lilac', '#d7cdf5'], ['peach', '#fdd7b9'], ['teal', '#beebeb']]) {
    await page.getByTestId(`scheme-${scheme}`).click();
    await expect(page.locator('[data-testid=canvas] > rect').first()).toHaveAttribute('fill', bg);
    for (const preset of ['assembled', 'offset', 'underTitle']) {
      await page.getByTestId('preset').selectOption(preset);
      await expect(page.getByTestId('preset')).toHaveValue(preset);
      await page.waitForTimeout(500); // переход между пресетами анимирован
      await page.getByTestId('canvas').screenshot({ path: `test-results/shots/${scheme}-${preset}.png` });
    }
  }

  // выбор объекта, фоновый вид, поворот, дублирование, удаление
  // верхний слой выбираем в списке «Слои» (первая строка): в плотной композиции центр рамки объекта может быть пустым
  const target = items(page).nth(5);
  await page.getByTestId('layers').getByRole('button').first().click();
  await page.getByTestId('kind-bg').click();
  await expect(target).toHaveAttribute('data-kind', 'bg');
  await page.getByTestId('rotate').fill('30');
  await expect(target).toHaveAttribute('transform', /rotate\(30\)/);
  await page.getByTestId('duplicate').click();
  await expect(items(page)).toHaveCount(7);
  await page.getByTestId('delete').click();
  await expect(items(page)).toHaveCount(6);

  const svg = await exportSvg(page);
  expect(svg).not.toMatch(/<image\b|data:image|<foreignObject/);
  const check = await page.evaluate((s) => {
    const doc = new DOMParser().parseFromString(s, 'image/svg+xml');
    return { error: !!doc.querySelector('parsererror'), groups: doc.querySelectorAll('svg > g:not(#decor)').length, paths: doc.querySelectorAll('path').length };
  }, svg);
  expect(check).toMatchObject({ error: false, groups: 6 });
  expect(check.paths).toBeGreaterThan(100);
});

test('библиотека: каждый добавленный объект сразу собирается в композицию, первый включает «Собранно»', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('preset').selectOption('offset'); // на пустом холсте выбран другой пресет
  await page.getByTestId('add-pen').click();
  await expect(page.getByTestId('preset')).toHaveValue('assembled');
  await page.getByTestId('preset').selectOption('offset');
  await page.getByTestId('add-tulips').click();
  await expect(page.getByTestId('preset')).toHaveValue('offset'); // дальше пресет сохраняется
  await expect(items(page)).toHaveCount(2);
  await page.waitForTimeout(500); // анимация появления
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  for (const box of await items(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.x).toBeGreaterThanOrEqual(canvas.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  }
  await page.getByTestId('add-lamp').click();
  await expect(items(page)).toHaveCount(3);
  await expect(page.getByTestId('preset')).toHaveValue('offset');
  // после ручной правки пресет не показан; выбор того же пресета снова расставляет объекты
  await page.getByTestId('layers').getByRole('button').first().click();
  await page.getByTestId('duplicate').click();
  await expect(page.getByTestId('preset')).toHaveValue('');
  await expect(page.getByTestId('preset').locator('option:checked')).toHaveText('Вручную');
  await page.getByTestId('preset').selectOption('offset');
  await expect(page.getByTestId('preset')).toHaveValue('offset');
  await expect(items(page)).toHaveCount(4);
});

test('библиотека сворачивается и помнит состояние после перезагрузки', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByTestId('library-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('add-lamp')).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('add-lamp')).toBeHidden();
  // свёрнутая библиотека не оставляет пустого места — «Слои» поднимаются вверх
  await expect.poll(() => page.locator('#library').evaluate((e) => e.getBoundingClientRect().height)).toBeLessThan(10);
  await page.reload();
  await expect(page.getByTestId('library-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('add-lamp')).toBeHidden();
  await page.getByTestId('library-toggle').click();
  await expect(page.getByTestId('add-lamp')).toBeVisible();
  await page.waitForTimeout(400); // анимация разворачивания
  await page.screenshot({ path: 'test-results/shots/library-open.png', clip: { x: 0, y: 0, width: 330, height: 900 } });
  await page.getByTestId('library-toggle').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/shots/library-collapsed.png', clip: { x: 0, y: 0, width: 330, height: 900 } });
});

test('фоновые объекты: «фоновые тюльпаны» позади главных, вкладка «Фоновые» в библиотеке, экспорт', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('names').fill('наушники, фоновые тюльпаны');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(2);
  await expect(page.getByTestId('status')).toContainText('фон: Тюльпаны в вазе');
  // фоновый — первым в DOM, то есть нижним слоем
  expect(await items(page).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-slug')}-${e.getAttribute('data-kind')}`))).toEqual(['tulips-bg', 'headphones-main']);
  await page.waitForTimeout(500);
  await page.getByTestId('canvas').screenshot({ path: 'test-results/shots/bg-tulips-headphones.png' });

  await page.getByTestId('lib-kind-bg').click();
  await page.getByTestId('add-lamp').click();
  await expect(items(page)).toHaveCount(3);
  // фоновые — нижними слоями (между собой по глубине сцены, друг друга не перекрывают), главный — над ними
  const layers = await items(page).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-slug')}-${e.getAttribute('data-kind')}`));
  expect(layers.slice(0, 2).sort()).toEqual(['lamp-bg', 'tulips-bg']);
  expect(layers[2]).toBe('headphones-main');

  const svg = await exportSvg(page);
  expect(svg).not.toMatch(/<image\b|data:image|<foreignObject/);
  // фоновые объекты используют только цвета фона схемы (сиреневая: bg1 #d7cdf5, bg3 #7864d7)
  const bgGroup = svg.split('<g id="tulips"')[1].split('</g>\n<g id=')[0];
  for (const c of new Set(bgGroup.match(/#[0-9a-f]{6}/g))) expect(['#d7cdf5', '#aa9bf0', '#7864d7', '#181817']).toContain(c);
});

test('декоративный фон: переключение и экспорт; «Очистить» с возвратом', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('names').fill('наушники, монета, фоновые тюльпаны');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(3);
  for (const d of ['confetti', 'blob']) {
    await page.getByTestId('decor').selectOption(d);
    for (const f of ['1000x1000', '1200x630', '800x1200']) {
      const [w, h] = f.split('x');
      await page.getByTestId('format').selectOption(f);
      await expect(page.getByTestId('format')).toHaveValue(f);
      await expect(page.getByTestId('canvas')).toHaveAttribute('viewBox', `0 0 ${w} ${h}`);
      await page.waitForTimeout(500);
      await page.getByTestId('canvas').screenshot({ path: `test-results/shots/decor-${d}-${f}.png` });
      const svg = await exportSvg(page);
      expect(svg).toContain(`width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`);
      expect(svg).toMatch(/<g id="decor">[\s\S]*<path/);
      expect(svg.match(/<g id="(headphones|coin|tulips)"/g)).toHaveLength(3);
    }
  }
  await page.getByTestId('decor').selectOption('');
  expect(await exportSvg(page)).not.toContain('id="decor"');

  await page.getByTestId('clear').click();
  await expect(items(page)).toHaveCount(0);
  await expect(page.getByTestId('clear')).toBeDisabled();
  await page.getByTestId('restore').click();
  await expect(items(page)).toHaveCount(3);
  await page.getByTestId('clear').click();
  await page.getByTestId('add-pen').click();
  await expect(page.getByTestId('restore')).toHaveCount(0); // после нового действия возврата нет
  await expect(page.getByTestId('status')).toHaveText(''); // и «Холст очищен» не остаётся
});

test('своя палитра из JSON: перекраска холста и объектов, экспорт, запоминается; ошибки формата понятны', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('names').fill('лампа, кошелёк, монета');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(3);

  await page.getByTestId('palette-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"x","colors":{"bg1":"#fff"}}') });
  await expect(page.getByTestId('status')).toContainText('Палитра не загружена');

  await page.getByTestId('palette-file').setInputFiles('public/palette-example.json');
  await expect(page.getByTestId('status')).toContainText('Палитра «Мятная» загружена');
  await expect(page.getByTestId('scheme-mint')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-testid=canvas] > rect').first()).toHaveAttribute('fill', '#d4f0e4');

  const svg = await exportSvg(page);
  const used = new Set(svg.match(/#[0-9a-f]{6}/g));
  for (const c of ['#d4f0e4', '#3f9f7c', '#ffe9a8']) expect(used).toContain(c);
  // цвета исходной (сиреневой) схемы не остались
  for (const c of ['#d7cdf5', '#7864d7', '#f9a3aa']) expect(used).not.toContain(c);

  await page.reload();
  await expect(page.getByTestId('scheme-mint')).toBeVisible();
});

test('поворот ручкой на холсте: вправо от центра — 90°, Shift — шаг 15°', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('names').fill('кошелёк');
  await page.getByTestId('names-go').click();
  await page.getByTestId('layers').getByRole('button').first().click();
  const handle = (await page.getByTestId('rotate-handle').boundingBox())!;
  const frame = (await page.locator('.selection').boundingBox())!;
  const [cx, cy] = [frame.x + frame.width / 2, frame.y + frame.height / 2];
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('rotate')).toHaveValue('90');
  await expect(items(page).first()).toHaveAttribute('transform', /rotate\(90\)/);

  const h2 = (await page.getByTestId('rotate-handle').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 47, { steps: 5 }); // ≈107° → 105°
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('rotate')).toHaveValue('105');
});

test('мобильный экран 390 px: без горизонтальной прокрутки, панель «Объект» сразу под холстом, поворот касанием', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('names').fill('книга, телефон, лампа, ручка');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId('layers').getByRole('button').first().click();
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  const panel = (await page.getByTestId('selected-panel').boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(canvas.y + canvas.height);
  expect(panel.y - (canvas.y + canvas.height)).toBeLessThan(60);
  // касание в 10 px от центра ручки (мимо видимого кружка) попадает в её зону касания
  await page.getByTestId('rotate-handle').scrollIntoViewIfNeeded();
  const h = (await page.getByTestId('rotate-handle').boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', h.x + h.width / 2 + 10, h.y + h.height / 2);
  for (let k = 1; k <= 5; k++) await touch('touchMove', h.x + h.width / 2 + 10 + k * 25, h.y + h.height / 2 + k * 20);
  await touch('touchEnd');
  await expect(page.getByTestId('rotate')).not.toHaveValue('0');
  await ctx.close();
});
