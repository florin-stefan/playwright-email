import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// This config mirrors what a real user of the published package would write.
// One Mailpit is started for the whole run (globalSetup) so the app under
// test — started once via webServer — has a single SMTP endpoint.
//
// The ports are pinned here (not read back from globalSetup) because
// Playwright may launch webServer before globalSetup runs.
const SMTP_PORT = 2525;
const HTTP_PORT = 8025;
process.env.PLAYWRIGHT_EMAIL_SMTP_PORT = String(SMTP_PORT);
process.env.PLAYWRIGHT_EMAIL_HTTP_PORT = String(HTTP_PORT);

export default defineConfig({
  testDir: __dirname,
  timeout: 60_000,
  reporter: 'list',
  // Real projects: globalSetup: require.resolve('playwright-email/global-setup')
  globalSetup: path.resolve(__dirname, '../../src/global-setup.ts'),
  use: {
    baseURL: 'http://127.0.0.1:4001',
  },
  webServer: {
    command: 'node server.mjs',
    cwd: __dirname,
    port: 4001,
    reuseExistingServer: false,
    env: {
      PORT: '4001',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(SMTP_PORT),
    },
  },
});
