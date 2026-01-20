// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node src/app.js',
    url: 'http://localhost:3000/health',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NODE_ENV: process.env.NODE_ENV || 'test',
      PORT: process.env.PORT || '3000',
    },
  },
});
