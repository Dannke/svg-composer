import { handleCompose } from '../src/server/compose';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** Cloudflare Workers Rate Limiting (wrangler.jsonc → ratelimits) */
  COMPOSE_LIMIT?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODELS?: string;
}

// Cloudflare Worker: /api/compose — LLM-подбор на сервере, всё остальное — статика из dist/.
export default {
  async fetch(req: Request, env: Env) {
    if (new URL(req.url).pathname !== '/api/compose') return env.ASSETS.fetch(req);
    // бережём суточный лимит бесплатных моделей: сверх лимита с адреса — запасной подбор без LLM, а не ошибка
    const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
    const allowed = env.COMPOSE_LIMIT ? (await env.COMPOSE_LIMIT.limit({ key: ip })).success : true;
    return handleCompose(req, { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, OPENROUTER_MODELS: env.OPENROUTER_MODELS }, !allowed);
  },
};
