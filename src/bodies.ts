import { svgBody } from './core/render';

// Все SVG объектов бандлятся как строки; ключ — имя файла из manifest.json.
const raw = import.meta.glob('../assets/objects/*.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const BODIES: Record<string, string> = Object.fromEntries(
  Object.entries(raw).map(([path, svg]) => [path.split('/').pop()!, svgBody(svg)]),
);
