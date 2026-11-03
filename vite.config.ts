/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { handleCompose } from './src/server/compose';

/** /api/compose локально (dev и preview) — тот же обработчик, что и серверная функция Vercel. */
function apiPlugin(env: Record<string, string>): Plugin {
  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url !== '/api/compose') return next();
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const response = await handleCompose(
      new Request('http://localhost/api/compose', { method: req.method, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined }),
      { ...env, ...process.env },
    );
    res.statusCode = response.status;
    res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'application/json');
    res.end(await response.text());
  };
  return {
    name: 'api-compose',
    configureServer: (s) => void s.middlewares.use(middleware),
    configurePreviewServer: (s) => void s.middlewares.use(middleware),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiPlugin(loadEnv(mode, process.cwd(), 'OPENROUTER_'))],
  // SVG всех 40 объектов бандлятся в приложение строками — крупный чанк ожидаем
  build: { chunkSizeWarningLimit: 4000 },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'] },
}));
