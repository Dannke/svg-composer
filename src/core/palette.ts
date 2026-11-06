import { ROLES, SCHEMES, SOURCE_SCHEME, type Scheme } from './catalog';
import schemesData from '../data/schemes.json';

/** Свои цвета схемы; чёрный и белый (ink, white) общие для всех схем и не задаются. */
export const OWN_ROLES = ['bg1', 'bg2', 'bg3', 'obj1', 'obj2', 'obj3'] as const;
const BUILT_IN = new Set(schemesData.schemes.map((s) => s.id));

const hex6 = (v: unknown) => {
  if (typeof v !== 'string' || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) return null;
  const h = v.trim().toLowerCase();
  return h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h;
};

/**
 * Проверка одной палитры из JSON (формат записи в src/data/schemes.json: {id?, name, colors: {bg1…obj3}}).
 * Правило библиотеки Figma: цвета объектов не могут использоваться в фонах — поэтому цвета фона и объектов не пересекаются.
 */
export function validateScheme(raw: unknown, n = 1): Scheme {
  if (!raw || typeof raw !== 'object') throw new Error('Палитра должна быть JSON-объектом {"name", "colors"}');
  const { id, name, colors } = raw as Record<string, unknown>;
  if (!colors || typeof colors !== 'object') throw new Error('Нет поля "colors" с цветами bg1, bg2, bg3, obj1, obj2, obj3');
  const extra = Object.keys(colors).filter((k) => !(OWN_ROLES as readonly string[]).includes(k));
  if (extra.length) throw new Error(`Неизвестные роли цвета: ${extra.join(', ')}. Нужны только bg1–bg3 и obj1–obj3 (чёрный и белый общие)`);
  const own: Record<string, string> = {};
  for (const role of OWN_ROLES) {
    const v = hex6((colors as Record<string, unknown>)[role]);
    if (!v) throw new Error(`Цвет ${role}: нужен #rrggbb`);
    own[role] = v;
  }
  const full = { ...schemesData.neutrals, ...own };
  const roles = Object.keys(ROLES);
  const bg = new Set(roles.filter((r) => ROLES[r] === 'background').map((r) => full[r as keyof typeof full]));
  const clash = roles.filter((r) => ROLES[r] === 'object').map((r) => full[r as keyof typeof full]).find((c) => bg.has(c));
  if (clash) throw new Error(`Цвет ${clash} есть и среди цветов фона, и среди цветов объектов: цвета объектов нельзя использовать в фонах`);
  const title = typeof name === 'string' && name.trim() ? name.trim().slice(0, 40) : `Своя палитра ${n}`;
  const sid = typeof id === 'string' && /^[a-z0-9-]{1,32}$/.test(id) ? id : `custom-${OWN_ROLES.map((r) => own[r].slice(1)).join('').slice(0, 24)}`;
  if (BUILT_IN.has(sid)) throw new Error(`id «${sid}» занят встроенной схемой — укажите другой`);
  return { id: sid, name: title, colors: full };
}

/** JSON-файл: одна палитра или {schemes: [...]} как src/data/schemes.json. */
export function parsePalettes(text: string): Scheme[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл не читается как JSON');
  }
  const list = data && typeof data === 'object' && Array.isArray((data as { schemes?: unknown }).schemes) ? (data as { schemes: unknown[] }).schemes : [data];
  if (!list.length || list.length > 20) throw new Error('В файле должно быть от 1 до 20 палитр');
  return list.map((s, i) => validateScheme(s, i + 1));
}

/** Добавить палитры в работающий сервис (встроенные не меняются, своя с тем же id заменяется). */
export function addSchemes(list: Scheme[]) {
  for (const s of list) {
    const i = SCHEMES.findIndex((x) => x.id === s.id);
    if (i >= 0) SCHEMES[i] = s;
    else SCHEMES.push(s);
  }
}

export const customSchemes = () => SCHEMES.filter((s) => !BUILT_IN.has(s.id));

// WCAG 2.1: относительная яркость и контраст
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** color-mix(in srgb, a p, b) — как токен --primary в src/styles.css */
export const mix = (a: string, b: string, p: number) =>
  '#' + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, '0')).join('');

/**
 * Акцент интерфейса из bg3 схемы. Если у загруженной палитры он не даёт контраст WCAG AA
 * (белый текст на кнопке ≥ 4,5:1, рамка на холсте ≥ 3:1), интерфейс берёт акцент исходной схемы — холст при этом в цветах палитры.
 */
export function uiAccent(s: Scheme) {
  const primary = mix(s.colors.bg3, '#181817', 0.6);
  const ok = contrast('#ffffff', primary) >= 4.5 && contrast(primary, '#f6f5f4') >= 3 && contrast(primary, s.colors.bg1) >= 3;
  return ok ? s.colors.bg3 : SOURCE_SCHEME.colors.bg3;
}
