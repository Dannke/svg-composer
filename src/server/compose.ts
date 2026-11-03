import { OBJECTS, PRESETS, SLUGS, type Preset } from '../core/catalog';
import { matchTags } from '../core/match';

export interface ComposeResult {
  slugs: string[];
  preset: Preset;
  source: 'llm' | 'keywords' | 'default';
  model?: string;
  reason?: string;
}

// доступность бесплатных моделей меняется от запроса к запросу (429/503/таймауты), поэтому опрашиваем их параллельно
export const DEFAULT_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'dots-studio/dots-3-note-preview:free',
  'google/gemma-4-26b-a4b-it:free',
];
const DEFAULT_SET = ['book', 'lamp', 'headphones'];
const TIMEOUT_MS = 15_000;

const SYSTEM = `Ты подбираешь готовые иллюстративные объекты под метафору или заголовок статьи.
Доступные объекты (id — название — смыслы):
${OBJECTS.map((o) => `${o.slug} — ${o.nameRu} — ${o.tags.slice(0, 8).join(', ')}`).join('\n')}
Пресеты раскладки: ${PRESETS.map((p) => `${p.id} (${p.name})`).join(', ')}.
Выбери от 2 до 5 объектов, которые вместе лучше всего передают смысл. Используй только id из списка.
Ответь строго одним JSON-объектом без пояснений вокруг:
{"objects": ["id", ...], "preset": "assembled", "reason": "одно короткое предложение"}`;

/** Строгая проверка ответа модели: только id из каталога, без повторов, 1–6 шт. */
export function parseLlmAnswer(text: string): Pick<ComposeResult, 'slugs' | 'preset' | 'reason'> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { objects, preset, reason } = data as Record<string, unknown>;
  if (!Array.isArray(objects)) return null;
  const slugs = [...new Set(objects.filter((x): x is string => typeof x === 'string' && SLUGS.has(x)))].slice(0, 6);
  if (!slugs.length) return null;
  return {
    slugs,
    preset: PRESETS.some((p) => p.id === preset) ? (preset as Preset) : 'assembled',
    reason: typeof reason === 'string' ? reason.slice(0, 300) : undefined,
  };
}

const cache = new Map<string, ComposeResult>();

interface Deps {
  apiKey?: string;
  models?: string[];
  fetch?: typeof fetch;
}

export async function compose(query: string, deps: Deps = {}): Promise<ComposeResult> {
  const key = query.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return hit;

  let result: ComposeResult | null = null;
  if (deps.apiKey) {
    const doFetch = deps.fetch ?? fetch;
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, AbortSignal.timeout(TIMEOUT_MS)]);
    const ask = async (model: string): Promise<ComposeResult> => {
      const res = await doFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${deps.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: query.slice(0, 500) },
          ],
        }),
        signal,
      });
      if (!res.ok) throw new Error(`${model}: ${res.status}`);
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const parsed = parseLlmAnswer(json.choices?.[0]?.message?.content ?? '');
      if (!parsed) throw new Error(`${model}: невалидный ответ`);
      return { ...parsed, source: 'llm', model };
    };
    // первый валидный ответ побеждает, остальные запросы отменяются
    result = await Promise.any((deps.models?.length ? deps.models : DEFAULT_MODELS).map(ask)).catch(() => null);
    stop.abort();
  }
  if (!result) {
    const slugs = matchTags(query, OBJECTS);
    result = slugs.length ? { slugs, preset: 'assembled', source: 'keywords' } : { slugs: DEFAULT_SET, preset: 'assembled', source: 'default' };
  }
  // запасной ответ при сбое LLM не кэшируем — следующая попытка может пройти
  if (result.source === 'llm' || !deps.apiKey) {
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
  }
  return result;
}

/** Общий HTTP-обработчик (Web Request/Response) — для Cloudflare Worker и для dev/preview-сервера Vite. */
export async function handleCompose(req: Request, env: Record<string, string | undefined>): Promise<Response> {
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
  });
  return Response.json(result);
}
