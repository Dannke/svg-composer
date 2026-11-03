// figma-raw/*.svg → assets/objects/*.svg (нормализованные) + src/data/manifest.json.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { normalizeSvg } from './normalize-svg.mjs';

const root = new URL('../', import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const nodes = await read('scripts/figma-nodes.json');
const meta = await read('scripts/search-meta.json');
const schemes = await read('src/data/schemes.json');
const source = schemes.schemes.find((s) => s.id === schemes.source).colors;
const roleByHex = Object.fromEntries(Object.entries(source).map(([role, hex]) => [hex, role]));

const rawDir = new URL('figma-raw/', root);
const outDir = new URL('assets/objects/', root);
await mkdir(outDir, { recursive: true });
const present = new Set(await readdir(rawDir).catch(() => []));
const manifest = [];
const missing = [];
for (const o of nodes.objects) {
  for (const [size, kinds] of Object.entries(o.nodes)) {
    for (const [kind, figmaNode] of Object.entries(kinds)) {
      const file = `${o.slug}-${size}-${kind}.svg`;
      if (!present.has(file)) { missing.push(file); continue; }
      const n = normalizeSvg(await readFile(new URL(file, rawDir), 'utf8'), roleByHex);
      await writeFile(new URL(file, outDir), n.svg);
      manifest.push({
        id: `${o.slug}-${size}-${kind}`, slug: o.slug, nameRu: o.nameRu, kind, size, figmaNode, file,
        bbox: { w: n.w, h: n.h }, colorRoles: n.colorRoles, fixedColors: n.fixedColors,
        synonyms: meta[o.slug].synonyms, tags: meta[o.slug].tags,
      });
    }
  }
}
await writeFile(new URL('src/data/manifest.json', root), JSON.stringify(manifest, null, 1) + '\n');
console.log(`manifest: ${manifest.length} assets`);
if (missing.length) console.warn(`НЕТ в figma-raw/ (${missing.length}): ${missing.join(', ')}`);
