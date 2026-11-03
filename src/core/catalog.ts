import manifest from '../data/manifest.json';
import schemesData from '../data/schemes.json';

export type Size = 'S' | 'L';
export type Kind = 'main' | 'bg';
export type Preset = 'assembled' | 'offset' | 'underTitle';

export interface Asset {
  id: string;
  slug: string;
  nameRu: string;
  kind: Kind;
  size: Size;
  figmaNode: string;
  file: string;
  bbox: { w: number; h: number };
  colorRoles: Record<string, number>;
  fixedColors: string[];
  synonyms: string[];
  tags: string[];
}

export interface Scheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

export const ASSETS = manifest as unknown as Asset[];
export const SCHEMES = schemesData.schemes as Scheme[];
export const SOURCE_SCHEME = SCHEMES.find((s) => s.id === schemesData.source)!;
export const CANVAS_ROLE = schemesData.canvasRole;
export const ROLES = schemesData.roles as Record<string, 'background' | 'object'>;

export const FORMATS = [
  { id: '1000x1000', w: 1000, h: 1000 },
  { id: '1200x630', w: 1200, h: 630 },
  { id: '800x1200', w: 800, h: 1200 },
] as const;
export type Format = (typeof FORMATS)[number];

export const PRESETS: { id: Preset; name: string }[] = [
  { id: 'assembled', name: 'Собранно' },
  { id: 'offset', name: 'Со смещением' },
  { id: 'underTitle', name: 'Под заголовок' },
];

/** Один объект каталога (без учёта вида и размера) — для поиска и списка библиотеки. */
export interface CatalogObject {
  slug: string;
  nameRu: string;
  synonyms: string[];
  tags: string[];
}
export const OBJECTS: CatalogObject[] = [...new Map(ASSETS.map((a) => [a.slug, a])).values()].map(
  ({ slug, nameRu, synonyms, tags }) => ({ slug, nameRu, synonyms, tags }),
);
export const SLUGS = new Set(OBJECTS.map((o) => o.slug));

export function getAsset(slug: string, size: Size, kind: Kind): Asset {
  const a = ASSETS.find((x) => x.slug === slug && x.size === size && x.kind === kind);
  if (!a) throw new Error(`Нет ассета ${slug}-${size}-${kind}`);
  return a;
}

/** S-элементы в Figma нарисованы в масштабе 1:2 к L, поэтому при смене размера общий масштаб умножается на это число. */
export const S_TO_L = 2;
