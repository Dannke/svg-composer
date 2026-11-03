import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const items = (page: Page) => page.locator('[data-testid=canvas] [data-uid]');

async function exportSvg(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export').click()]);
  return readFileSync((await download.path())!, 'utf8');
}

test('сценарий Б: названия с опечаткой и словоформой → композиция', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('preset-assembled')).toHaveAttribute('aria-pressed', 'false'); // пустой холст — пресет не горит
  await page.getByTestId('names').fill('лампу, нушники и книга');
  await page.getByTestId('names-go').click();
  await expect(items(page)).toHaveCount(3);
  await expect(page.getByTestId('preset-assembled')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('status')).toContainText('Лампа, Наушники, Книга');
  expect(await items(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-slug')))).toEqual(['lamp', 'headphones', 'book']);
});

test('сценарий А: метафора → объекты (LLM, локально без ключа — запасной поиск по смыслам)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('metaphor').fill('Как накопить деньги и не тратить лишнего на покупки');
  await page.getByTestId('metaphor-go').click();
  await expect(page.getByTestId('status')).toContainText(/ключевым словам|LLM/);
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
      await page.getByTestId(`preset-${preset}`).click();
      await page.waitForTimeout(500); // переход между пресетами анимирован
      await page.getByTestId('canvas').screenshot({ path: `test-results/shots/${scheme}-${preset}.png` });
    }
  }

  // выбор объекта, фоновый вид, поворот, дублирование, удаление
  // верхний слой: нижние объекты частично закрыты уложенными сверху (телефон на книге, пазлы на телефоне)
  const target = items(page).nth(5);
  await target.click();
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
    return { error: !!doc.querySelector('parsererror'), groups: doc.querySelectorAll('svg > g').length, paths: doc.querySelectorAll('path').length };
  }, svg);
  expect(check).toMatchObject({ error: false, groups: 6 });
  expect(check.paths).toBeGreaterThan(100);
});

test('библиотека: первый объект не на весь холст, следующие влезают; пресет горит только после раскладки', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-pen').click();
  await page.getByTestId('add-tulips').click();
  await expect(items(page)).toHaveCount(2);
  await page.waitForTimeout(500); // анимация появления
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  for (const box of await items(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
    expect(box.x).toBeGreaterThanOrEqual(canvas.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height + 1);
  }
  await expect(page.getByTestId('preset-assembled')).toHaveAttribute('aria-pressed', 'false');
  await page.getByTestId('preset-assembled').click();
  await expect(page.getByTestId('preset-assembled')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('add-lamp').click();
  await expect(page.getByTestId('preset-assembled')).toHaveAttribute('aria-pressed', 'false');
});
