import { CANVAS_ROLE, SCHEMES, SOURCE_SCHEME, getAsset, type Decor, type Format, type Kind, type Size } from './catalog';

export interface Item {
  uid: string;
  slug: string;
  kind: Kind;
  /** центр объекта в координатах холста */
  cx: number;
  cy: number;
  rotation: number;
}

export interface Composition {
  format: Format;
  size: Size;
  scheme: string;
  /** единственный коэффициент масштаба для всех объектов композиции */
  scale: number;
  /** декоративный фон; нет — однотонный фон схемы */
  decor?: Decor;
  items: Item[];
}

/** Тело SVG-файла объекта (без корневого <svg>). */
export function svgBody(svg: string): string {
  const m = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/);
  if (!m) throw new Error('bad asset svg');
  return m[1].trim();
}

/** Перекраска: цвет схемы-источника → роль → цвет целевой схемы. Остальные цвета не трогаются. */
export function recolor(body: string, schemeId: string): string {
  const target = SCHEMES.find((s) => s.id === schemeId);
  if (!target) throw new Error(`Нет схемы ${schemeId}`);
  const map = new Map(Object.entries(SOURCE_SCHEME.colors).map(([role, hex]) => [hex, target.colors[role]]));
  return body.replace(/#[0-9a-f]{6}\b/g, (c) => map.get(c) ?? c);
}

export function canvasColor(schemeId: string): string {
  return SCHEMES.find((s) => s.id === schemeId)!.colors[CANVAS_ROLE];
}

export function itemSize(item: Pick<Item, 'slug' | 'kind'>, comp: Pick<Composition, 'size' | 'scale'>) {
  const { w, h } = getAsset(item.slug, comp.size, item.kind).bbox;
  return { w: w * comp.scale, h: h * comp.scale };
}

export function itemTransform(item: Item, comp: Pick<Composition, 'size' | 'scale'>): string {
  const { w, h } = getAsset(item.slug, comp.size, item.kind).bbox;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return `translate(${r(item.cx)} ${r(item.cy)}) rotate(${r(item.rotation)}) scale(${r(comp.scale)}) translate(${r(-w / 2)} ${r(-h / 2)})`;
}

/** Разметка объекта: исходные пути из Figma, перекрашенные, с уникальным префиксом id (clipPath/mask). */
export function itemMarkup(item: Item, comp: Pick<Composition, 'size' | 'scheme'>, bodies: Record<string, string>, idPrefix: string) {
  const asset = getAsset(item.slug, comp.size, item.kind);
  const body = bodies[asset.file];
  if (body === undefined) throw new Error(`Нет SVG ${asset.file}`);
  return recolor(body, comp.scheme).replace(/__ID__/g, `${idPrefix}-`);
}

/** Декоративный фон в цветах схемы (линии, конфетти, пятно — из цветов фона); '' — без декора. */
export function decorMarkup(comp: Pick<Composition, 'decor' | 'format' | 'scheme'>, bodies: Record<string, string>) {
  if (!comp.decor) return '';
  const file = `decor-${comp.decor}-${comp.format.id}.svg`;
  if (bodies[file] === undefined) throw new Error(`Нет SVG ${file}`);
  return recolor(bodies[file], comp.scheme).replace(/__ID__/g, 'decor-');
}

/** Полный SVG композиции — используется и для экспорта, и для превью. */
export function renderSvg(comp: Composition, bodies: Record<string, string>): string {
  const { w, h } = comp.format;
  const seen: Record<string, number> = {};
  const layers = comp.items.map((it) => {
    seen[it.slug] = (seen[it.slug] ?? 0) + 1;
    const name = seen[it.slug] > 1 ? `${it.slug}-${seen[it.slug]}` : it.slug;
    return `<g id="${name}" transform="${itemTransform(it, comp)}">\n${itemMarkup(it, comp, bodies, name)}\n</g>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">`,
    `<rect id="background" width="${w}" height="${h}" fill="${canvasColor(comp.scheme)}"/>`,
    ...(comp.decor ? [`<g id="decor">
${decorMarkup(comp, bodies)}
</g>`] : []),
    ...layers,
    '</svg>',
    '',
  ].join('\n');
}
