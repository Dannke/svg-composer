import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173', viewport: { width: 1400, height: 900 } },
  // без ключа OpenRouter сценарий А детерминированно идёт через запасной режим
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'npm run build && npm run preview', port: 4173, reuseExistingServer: true, timeout: 180_000, env: { OPENROUTER_API_KEY: '' } },
});
