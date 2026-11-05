// figma-raw/*.svg → assets/objects/*.svg (нормализованные) + src/data/manifest.json.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { normalizeSvg } from './normalize-svg.mjs';

const root = new URL('../', import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const nodes = await read('scripts/figma-nodes.json');
const meta = await read('scripts/search-meta.json');
const schemes = await read('src/data/schemes.json');
const source = { ...schemes.neutrals, ...schemes.schemes.find((s) => s.id === schemes.source).colors };
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

// Декоративные фоны: кадр примера без объектов → assets/decor/decor-<стиль>-<формат>.svg
const decodeIds = (svg) =>
  svg.replace(/ id="([^"]*)"/g, (_, v) => ` id="${Buffer.from(v.replace(/&#(\d+);/g, (__, n) => String.fromCharCode(+n)), 'latin1').toString('utf8')}"`);

/** Удалить элемент <g id="name"> вместе со всем содержимым (вложенные <g> учитываются). */
function stripGroup(svg, name) {
  for (let at = svg.indexOf(`<g id="${name}"`); at >= 0; at = svg.indexOf(`<g id="${name}"`)) {
    const re = /<g\b[^>]*?(\/?)>|<\/g>/g;
    re.lastIndex = at;
    let depth = 0;
    for (let m; (m = re.exec(svg)); ) {
      if (m[0] === '</g>') depth--;
      else if (!m[1]) depth++;
      if (depth === 0) {
        svg = svg.slice(0, at) + svg.slice(re.lastIndex);
        break;
      }
    }
  }
  return svg;
}

const decorDir = new URL('assets/decor/', root);
await mkdir(decorDir, { recursive: true });
const bgHex = new Set(Object.entries(source).filter(([r]) => schemes.roles[r] === 'background').map(([, hex]) => hex));
for (const [style, formats] of Object.entries(nodes.decor.frames)) {
  for (const format of Object.keys(formats)) {
    const file = `decor-${style}-${format}.svg`;
    if (!present.has(file)) { console.warn(`НЕТ в figma-raw/: ${file}`); continue; }
    let svg = decodeIds(await readFile(new URL(file, rawDir), 'utf8'));
    for (const name of nodes.decor.stripLayers) svg = stripGroup(svg, name);
    const [w, h] = format.split('x');
    svg = svg.replace(new RegExp(`<rect width="${w}" height="${h}" fill="#[0-9A-Fa-f]{6}"/>`), ''); // фон кадра рисует сам холст
    const n = normalizeSvg(svg, roleByHex);
    // ТЗ: цвета объектов в фонах нельзя, а белый — цвет объектов. Белые фигуры (кусочек конфетти) убираются;
    // в <defs> белый — только заливка клипа, она не рисуется и тоже снимается
    const at = n.svg.includes('<defs>') ? n.svg.indexOf('<defs>') : n.svg.length;
    const art = n.svg.slice(0, at).replace(/<(?:path|rect|circle|ellipse|polygon)\b[^>]*\bfill="#ffffff"[^>]*\/>\n?/g, '');
    n.svg = art + n.svg.slice(at).replace(/ fill="#ffffff"/g, '');
    // защита: если объект не вырезался, в декоре окажутся цвета объектов или чёрный контур
    const bad = [...new Set(n.svg.match(/#[0-9a-f]{6}\b/g))].filter((c) => !bgHex.has(c));
    if (bad.length) throw new Error(`${file}: в декоре цвета не из фона: ${bad.join(', ')}`);
    await writeFile(new URL(file, decorDir), n.svg);
    console.log('decor', file, [...new Set(n.svg.match(/#[0-9a-f]{6}\b/g))].map((c) => roleByHex[c]).join(','));
  }
}
