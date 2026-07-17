import { defineConfig } from '@playwright/test';

// Self-test suite for the package itself. These tests exercise the fixtures
// against a real spawned Mailpit and need no browser.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
});
