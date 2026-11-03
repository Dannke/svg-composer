// Нормализация SVG из Figma: геометрия и порядок слоёв не меняются, только корень, id и запись цветов.
const NAMED = { white: '#ffffff', black: '#000000' };

export function normalizeSvg(raw, roleByHex) {
  const m = raw.match(/<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/);
  if (!m) throw new Error('not an svg');
  const vb = m[1].match(/viewBox="([^"]+)"/)[1].split(/[\s,]+/).map(Number);
  const [, , w, h] = vb;
  let body = m[2].trim();
  if (/<image\b/.test(body)) throw new Error('raster <image> inside');
  // цвета: именованные и HEX в верхнем регистре → #rrggbb в нижнем
  body = body.replace(/(fill|stroke|stop-color|flood-color)="([^"]+)"/g, (_, a, v) => {
    const c = NAMED[v.toLowerCase()] ?? v;
    return `${a}="${/^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : c}"`;
  });
  // id: ссылочные (clipPath, mask, gradient) получают плейсхолдер префикса, остальные (имена слоёв) удаляются
  const referenced = new Set([...body.matchAll(/(?:url\(#|href="#)([^)"]+)/g)].map((x) => x[1]));
  body = body.replace(/\sid="([^"]*)"/g, (_, id) => (referenced.has(id) ? ` id="__ID__${id}"` : ''));
  body = body.replace(/(url\(#|href="#)([^)"]+)/g, (_, p, id) => `${p}__ID__${id}`);
  const counts = {};
  const fixed = new Set();
  for (const [, c] of body.matchAll(/(?:fill|stroke|stop-color)="(#[0-9a-f]{6})"/g)) {
    const role = roleByHex[c];
    if (role) counts[role] = (counts[role] ?? 0) + 1;
    else fixed.add(c);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">\n${body}\n</svg>\n`;
  return { svg, w, h, colorRoles: counts, fixedColors: [...fixed] };
}
