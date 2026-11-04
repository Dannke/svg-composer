// Замер бесплатных моделей OpenRouter на реальном запросе сервиса: время и валидность JSON.
// Тратит дневной лимит ключа (50 запросов к :free) — по одному вызову на модель × вариант × запрос.
// Запуск: npx vite-node scripts/bench-llm.ts -- <модели через запятую> [варианты через запятую]
import { llmRequest, parseLlmAnswer } from '../src/server/compose';

const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('OPENROUTER_API_KEY не задан');
const [models = '', variants = 'prod'] = process.argv.slice(2).filter((a) => a !== '--');
// prod — запрос сервиса как есть (без размышлений, max_tokens 200); reasoning — с размышлениями, для сравнения
const VARIANTS: Record<string, Record<string, unknown>> = {
  prod: {},
  reasoning: { max_tokens: 1000, reasoning: { enabled: true } },
};
const queries = ['Как выучить язык с нуля', 'Финансовая подушка безопасности'].slice(0, Number(process.env.N ?? 2));

for (const model of models.split(',')) {
  for (const v of variants.split(',')) {
    for (const q of queries) {
      const t = Date.now();
      let note = '';
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(llmRequest(model, q, VARIANTS[v])),
          signal: AbortSignal.timeout(20_000),
        });
        const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
        const parsed = res.ok ? parseLlmAnswer(json.choices?.[0]?.message?.content ?? '') : null;
        note = res.ok ? (parsed ? `ok ${parsed.slugs.join(',')} bg:${parsed.background.join(',')}` : `bad: ${(json.choices?.[0]?.message?.content ?? '').slice(0, 60)}`) : `${res.status} ${json.error?.message?.slice(0, 60)}`;
      } catch (e) {
        note = (e as Error).name;
      }
      console.log(`${model.padEnd(46)} ${v.padEnd(8)} ${String(Date.now() - t).padStart(6)}ms  ${note.replace(/\s+/g, ' ')}`);
    }
  }
}
