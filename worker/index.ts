import { DurableObject } from 'cloudflare:workers';
import { handleCompose, overLimit } from '../src/server/compose';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** один Durable Object на адрес: строгий счётчик запросов (wrangler.jsonc → durable_objects) */
  LIMITER: { idFromName(name: string): unknown; get(id: unknown): { hit(ip: string): Promise<boolean> } };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODELS?: string;
}

/**
 * Лимит запросов к LLM с одного адреса. Запросы Worker разлетаются по разным изолятам, а привязка
 * Rate Limiting считает приблизительно, поэтому счёт ведёт Durable Object — он один на адрес и однопоточный.
 */
export class ComposeLimiter extends DurableObject {
  async hit(ip: string) {
    return overLimit(ip);
  }
}

// Cloudflare Worker: /api/compose — LLM-подбор на сервере, всё остальное — статика из dist/.
export default {
  async fetch(req: Request, env: Env) {
    if (new URL(req.url).pathname !== '/api/compose') return env.ASSETS.fetch(req);
    // бережём суточный лимит бесплатных моделей: сверх лимита с адреса — запасной подбор без LLM, а не ошибка
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const limited = await env.LIMITER.get(env.LIMITER.idFromName(ip)).hit(ip);
    const res = await handleCompose(req, { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, OPENROUTER_MODELS: env.OPENROUTER_MODELS }, limited);
    res.headers.set('x-compose-limit', limited ? 'limited' : 'ok');
    return res;
  },
};
