import type { CatalogObject } from './catalog';

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
}

export function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

/** Совпадение слова с термином: точно, по общей основе (словоформы) или с опечаткой. */
export function wordMatches(word: string, term: string): boolean {
  if (word === term) return true;
  const n = Math.min(word.length, term.length);
  if (n >= 4) {
    let p = 0;
    while (p < n && word[p] === term[p]) p++;
    if (p >= Math.max(4, n - 2)) return true;
  }
  const allowed = term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0;
  return allowed > 0 && Math.abs(word.length - term.length) <= allowed && levenshtein(word, term) <= allowed;
}

const words = (s: string) => normalize(s).split(' ').filter((w) => w.length >= 3);

/** Сценарий Б: названия объектов (с синонимами, словоформами, опечатками) → slug-и в порядке ввода. */
export function matchNames(text: string, catalog: CatalogObject[]) {
  const slugs: string[] = [];
  const unknown: string[] = [];
  for (const w of words(text)) {
    const hit = catalog.find((o) => o.synonyms.some((s) => wordMatches(w, normalize(s))));
    if (hit) {
      if (!slugs.includes(hit.slug)) slugs.push(hit.slug);
    } else unknown.push(w);
  }
  return { slugs, unknown };
}

/** Запасной режим сценария А: метафора → объекты по синонимам (вес 2) и смысловым тегам (вес 1). */
export function matchTags(text: string, catalog: CatalogObject[], limit = 4): string[] {
  const ws = words(text);
  return catalog
    .map((o) => ({
      slug: o.slug,
      score: ws.reduce(
        (sum, w) =>
          sum +
          (o.synonyms.some((s) => wordMatches(w, normalize(s))) ? 2 : 0) +
          (o.tags.some((t) => wordMatches(w, normalize(t))) ? 1 : 0),
        0,
      ),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.slug);
}
