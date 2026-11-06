import { getAsset, OBJECTS, PRESETS, SLUGS, type Preset } from '../core/catalog';
import { matchTags } from '../core/match';

export interface ComposeResult {
  /** главные (цветные) объекты */
  slugs: string[];
  /** фоновые (монохромные) объекты — позади главных, 0–1 шт., как в «Примерах композиций» Figma */
  background: string[];
  preset: Preset;
  source: 'llm' | 'keywords' | 'default';
  model?: string;
  reason?: string;
  /** LLM пропущена: этот адрес превысил лимит запросов (Cloudflare Rate Limiting в worker/index.ts) */
  rateLimited?: boolean;
}

// по замерам scripts/bench-llm.ts (2026-11-04, без размышлений): Nemotron 0.7–1.2 с, Dots 1.8–2.7 с, все ответы валидны;
// Gemma часто 429. Dots вторым — другой провайдер на случай сбоя у Nvidia
export const DEFAULT_MODELS = [
  'nvidia/nemotron-3.5-lightning:free',
  'dots-studio/dots-3-note-preview:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
  'google/gemma-4-31b-it:free',
];
const DEFAULT_SET = ['book', 'lamp', 'headphones'];
/** Потолок ожидания LLM: дольше 5 с пользователь не ждёт — сразу запасной режим. */
const TIMEOUT_MS = 5_000;
/** Сколько ждать ответа модели, прежде чем подключить следующую (при ошибке — подключается сразу). */
export const HEDGE_MS = 2_000;

const SYSTEM = `Ты подбираешь готовые иллюстративные объекты под метафору или заголовок статьи.
Доступные объекты (id — название — смыслы):
${OBJECTS.map((o) => `${o.slug} — ${o.nameRu} — ${o.tags.slice(0, 8).join(', ')}`).join('\n')}
Пресеты раскладки: ${PRESETS.map((p) => `${p.id} (${p.name})`).join(', ')}.
Выбери от 2 до 5 главных объектов, которые вместе лучше всего передают смысл.
Бери только объекты, прямо связанные с темой: 2–3 точных лучше, чем 5 с натяжкой. Не добавляй объект
ради количества или «для баланса» — если связь надо долго объяснять, объект лишний.
Можно добавить 0 или 1 фоновый объект (background): крупный монохромный объект позади главных, задаёт контекст
(например, ваза с тюльпанами за наушниками или лампа за кошельком). Фоновый не повторяет главные
и тоже должен быть прямо связан с темой; если такого нет — "background": [].
Используй только id из списка. Ответь строго одним JSON-объектом без пояснений вокруг:
{"objects": ["id", ...], "background": [] или ["id"], "preset": "assembled", "reason": "одно короткое предложение"}`;

/** Тело запроса к OpenRouter — общее для сервиса и scripts/bench-llm.ts. */
export function llmRequest(model: string, query: string, extra: Record<string, unknown> = {}) {
  return {
    model,
    temperature: 0.2,
    // задача простая (выбрать 2–5 id): «размышления» модели только добавляют секунды
    max_tokens: 200,
    reasoning: { enabled: false },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: query.slice(0, 500) },
    ],
    ...extra,
  };
}

/** Строгая проверка ответа модели: только id из каталога, без повторов; главных 1–6, фоновый — не из главных, максимум 1. */
export function parseLlmAnswer(text: string): Pick<ComposeResult, 'slugs' | 'background' | 'preset' | 'reason'> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { objects, background, preset, reason } = data as Record<string, unknown>;
  if (!Array.isArray(objects)) return null;
  const slugs = [...new Set(objects.filter((x): x is string => typeof x === 'string' && SLUGS.has(x)))].slice(0, 6);
  if (!slugs.length) return null;
  const bg = Array.isArray(background) ? background.filter((x): x is string => typeof x === 'string' && SLUGS.has(x) && !slugs.includes(x)) : [];
  return {
    slugs,
    background: bg.slice(0, 1),
    preset: PRESETS.some((p) => p.id === preset) ? (preset as Preset) : 'assembled',
    reason: typeof reason === 'string' ? reason.slice(0, 300) : undefined,
  };
}

/**
 * Запасной режим: при 3+ совпадениях фоновым становится самый крупный объект (по bbox из Figma),
 * кроме лучшего совпадения — в примерах Figma фоновыми стоят крупные: тюльпаны, лампа, книга. Изменяет slugs.
 */
function fallbackBackground(slugs: string[]): string[] {
  if (slugs.length < 3) return [];
  const area = (s: string) => getAsset(s, 'L', 'bg').bbox.w * getAsset(s, 'L', 'bg').bbox.h;
  const bg = slugs.slice(1).reduce((a, b) => (area(b) > area(a) ? b : a));
  slugs.splice(slugs.indexOf(bg), 1);
  return [bg];
}

const cache = new Map<string, ComposeResult>();

interface Deps {
  apiKey?: string;
  models?: string[];
  fetch?: typeof fetch;
  /** превышен лимит запросов: без LLM, ответ запасного режима не кэшируется */
  rateLimited?: boolean;
}

/** Запросов к LLM с одного адреса за минуту. */
export const RATE_LIMIT = 6;
const hits = new Map<string, number[]>();
/**
 * Скользящее окно: true — адрес превысил RATE_LIMIT за 60 с (запрос засчитывается).
 * На проде вызывается внутри Durable Object ComposeLimiter (worker/index.ts), одного на адрес, —
 * в памяти обычного изолята счёт бесполезен: запросы Worker разлетаются по разным изолятам.
 */
export function overLimit(key: string, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.delete(key); // Map помнит порядок вставки: в начале — давно молчавшие адреса
  hits.set(key, recent);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return recent.length > RATE_LIMIT;
}

export async function compose(query: string, deps: Deps = {}): Promise<ComposeResult> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  let result: ComposeResult | null = null;
  if (deps.apiKey && !deps.rateLimited) {
    const doFetch = deps.fetch ?? fetch;
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const ask = async (model: string): Promise<ComposeResult> => {
      const res = await doFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(llmRequest(model, query)),
        signal,
      });
      if (!res.ok) throw new Error(`${model}: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = parseLlmAnswer(json.choices?.[0]?.message?.content ?? '');
      if (!parsed) throw new Error(`${model}: невалидный ответ`);
      return { ...parsed, source: 'llm', model };
    };
    // бережём дневной лимит :free (50 запросов): следующая модель стартует, только если предыдущая
    // упала или молчит дольше HEDGE_MS; первый валидный ответ побеждает, остальные запросы отменяются
    const models = deps.models?.length ? deps.models : DEFAULT_MODELS;
    result = await new Promise<ComposeResult | null>((resolve) => {
      let started = 0;
      let failed = 0;
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: ComposeResult | null) => {
        done = true;
        clearTimeout(timer);
        resolve(r);
      };
      const launch = () => {
        if (done || started === models.length) return;
        clearTimeout(timer);
        timer = setTimeout(launch, HEDGE_MS);
        ask(models[started++]).then(finish, () => (++failed === models.length ? finish(null) : launch()));
      };
      signal.addEventListener('abort', () => finish(null));
      launch();
    });
    stop.abort();
  }
  if (!result) {
    const slugs = matchTags(query, OBJECTS);
    result = slugs.length
      ? { slugs, background: fallbackBackground(slugs), preset: 'assembled', source: 'keywords' }
      : { slugs: DEFAULT_SET, background: [], preset: 'assembled', source: 'default' };
  }
  if (deps.rateLimited && result.source !== 'llm') result = { ...result, rateLimited: true };
  // запасной ответ при сбое или лимите LLM не кэшируем — следующая попытка может пройти
  if (result.source === 'llm' || (!deps.apiKey && !deps.rateLimited)) {
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
  }
  return result;
}

/** Общий HTTP-обработчик (Web Request/Response) — для Cloudflare Worker и для dev/preview-сервера Vite. */
export async function handleCompose(req: Request, env: Record<string, string | undefined>, rateLimited = false): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  let query = '';
  try {
    query = String(((await req.json()) as { query?: unknown }).query ?? '');
  } catch {
    // пустое или битое тело — ниже вернём 400
  }
  if (!query.trim()) return Response.json({ error: 'Пустой запрос' }, { status: 400 });
  const result = await compose(query, {
    apiKey: env.OPENROUTER_API_KEY,
    models: env.OPENROUTER_MODELS?.split(',').map((s) => s.trim()).filter(Boolean),
    rateLimited,
  });
  return Response.json(result);
}
