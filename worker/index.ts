import { handleCompose } from '../src/server/compose';

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODELS?: string;
}

// Cloudflare Worker: /api/compose — LLM-подбор на сервере, всё остальное — статика из dist/.
export default {
  fetch(req: Request, env: Env) {
    if (new URL(req.url).pathname === '/api/compose') return handleCompose(req, { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, OPENROUTER_MODELS: env.OPENROUTER_MODELS });
    return env.ASSETS.fetch(req);
  },
};
