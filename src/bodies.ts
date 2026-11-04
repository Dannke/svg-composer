import { svgBody } from './core/render';

// Все SVG объектов и декоративных фонов бандлятся как строки; ключ — имя файла (из manifest.json / decor-<стиль>-<формат>.svg).
const raw = import.meta.glob(['../assets/objects/*.svg', '../assets/decor/*.svg'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
export const BODIES: Record<string, string> = Object.fromEntries(
  Object.entries(raw).map(([path, svg]) => [path.split('/').pop()!, svgBody(svg)]),
);
