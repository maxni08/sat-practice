import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'work/test-results',
  reporter: [['list'], ['html', { outputFolder: 'work/browser-report', open: 'never' }], ['json', { outputFile: 'work/browser-test-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:1421',
    channel: 'msedge',
    headless: true,
    launchOptions: { args: ['--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] },
    viewport: { width: 1366, height: 768 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: process.env.SAT_TEST_PREVIEW === '1'
      ? 'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 1421'
      : 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421',
    url: 'http://127.0.0.1:1421',
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
  },
});
