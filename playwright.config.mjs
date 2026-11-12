import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:15175', trace: 'retain-on-failure' },
  webServer: [
    { command: 'node e2e/monitor-fixture.mjs', url: 'http://127.0.0.1:8787/api/status' },
    { command: 'npm exec -- vite --host 127.0.0.1 --port 15175 --strictPort', url: 'http://127.0.0.1:15175' },
  ],
});
