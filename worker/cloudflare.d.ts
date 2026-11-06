// Минимальные типы рантайма Workers, которые использует worker/index.ts (без пакета @cloudflare/workers-types).
declare module 'cloudflare:workers' {
  export class DurableObject<Env = unknown> {
    constructor(ctx: unknown, env: Env);
    protected ctx: unknown;
    protected env: Env;
  }
}
