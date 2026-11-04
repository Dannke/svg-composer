// Выгружает все объекты библиотеки из Figma в figma-raw/ одним запросом к REST API (/v1/images).
// Нужен FIGMA_TOKEN (personal access token, scope file_content:read) в переменных окружения.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const token = process.env.FIGMA_TOKEN;
if (!token) {
  console.error('FIGMA_TOKEN не задан');
  process.exit(1);
}
const { fileKey, objects, decor } = JSON.parse(await readFile(new URL('./figma-nodes.json', import.meta.url), 'utf8'));
// `node scripts/fetch-figma.mjs decor` — только декоративные фоны (кадры целиком, с id слоёв, чтобы вырезать объекты)
const onlyDecor = process.argv[2] === 'decor';
const targets = onlyDecor
  ? Object.entries(decor.frames).flatMap(([style, formats]) =>
      Object.entries(formats).map(([format, id]) => ({ id, file: `decor-${style}-${format}.svg` })),
    )
  : objects.flatMap((o) =>
      Object.entries(o.nodes).flatMap(([size, kinds]) =>
        Object.entries(kinds).map(([kind, id]) => ({ id, file: `${o.slug}-${size}-${kind}.svg` })),
      ),
    );

const url = `https://api.figma.com/v1/images/${fileKey}?format=svg&svg_outline_text=true${onlyDecor ? '&svg_include_id=true' : ''}&ids=${targets.map((t) => t.id).join(',')}`;
const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
if (!res.ok) throw new Error(`Figma API ${res.status}: ${await res.text()}`);
const { images, err } = await res.json();
if (err) throw new Error(err);

const outDir = new URL('../figma-raw/', import.meta.url);
await mkdir(outDir, { recursive: true });
for (const t of targets) {
  if (!images[t.id]) throw new Error(`Нет экспорта для ${t.id} (${t.file})`);
  const svg = await (await fetch(images[t.id])).text();
  await writeFile(new URL(t.file, outDir), svg);
  console.log('ok', t.file);
}
