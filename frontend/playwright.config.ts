import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  globalTeardown: './tests/teardown.ts',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18082',
    viewport: { width: 1440, height: 1000 },
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:18082/healthz',
    timeout: 120000,
    reuseExistingServer: false,
  },
})
