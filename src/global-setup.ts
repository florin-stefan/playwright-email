import { startMailpit } from './server/process';

function envInt(name: string): number | undefined {
  const v = process.env[name];
  return v ? Number(v) : undefined;
}

/**
 * Optional Playwright globalSetup that provides ONE Mailpit shared by the
 * whole run — use this when your app is started once via `webServer` and
 * needs a single SMTP endpoint.
 *
 * IMPORTANT: Playwright may start `webServer` before globalSetup runs, so
 * env vars set here do NOT reliably reach your app. Pin the ports in your
 * config and pass them to the app explicitly:
 *
 *   // playwright.config.ts
 *   process.env.PLAYWRIGHT_EMAIL_SMTP_PORT = '2525';
 *   process.env.PLAYWRIGHT_EMAIL_HTTP_PORT = '8025';
 *
 *   export default defineConfig({
 *     globalSetup: require.resolve('playwright-email/global-setup'),
 *     webServer: {
 *       command: 'npm run start:app',
 *       env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' },
 *     },
 *   });
 *
 * If PLAYWRIGHT_EMAIL_URL is already set (docker-compose, staging), nothing
 * is spawned — the fixtures connect to that instance instead.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // PLAYWRIGHT_EMAIL_PROVIDER_PORT pins the provider-API mock (SendGrid/
  // Resend/Postmark) on a known port so a webServer app can be pointed at it.
  const providerPort = envInt('PLAYWRIGHT_EMAIL_PROVIDER_PORT');
  const providerMock = providerPort ? { port: providerPort } : undefined;

  if (process.env.PLAYWRIGHT_EMAIL_URL) {
    // External instance: verify it is reachable (and start the provider mock
    // against it when requested).
    const server = await startMailpit({
      url: process.env.PLAYWRIGHT_EMAIL_URL,
      smtpHost: process.env.PLAYWRIGHT_EMAIL_SMTP_HOST,
      smtpPort: envInt('PLAYWRIGHT_EMAIL_SMTP_PORT'),
      providerMock,
    });
    process.env.PLAYWRIGHT_EMAIL_SMTP_HOST = server.smtpHost;
    process.env.PLAYWRIGHT_EMAIL_SMTP_PORT = String(server.smtpPort);
    if (server.providerMock) process.env.PLAYWRIGHT_EMAIL_PROVIDER_URL = server.providerMock.url;
    return async () => {
      await server.stop();
    };
  }

  const server = await startMailpit({
    version: process.env.PLAYWRIGHT_EMAIL_MAILPIT_VERSION,
    smtpPort: envInt('PLAYWRIGHT_EMAIL_SMTP_PORT'),
    httpPort: envInt('PLAYWRIGHT_EMAIL_HTTP_PORT'),
    providerMock,
  });
  // Workers inherit these and connect to the shared instance.
  process.env.PLAYWRIGHT_EMAIL_URL = server.url;
  process.env.PLAYWRIGHT_EMAIL_SMTP_HOST = server.smtpHost;
  process.env.PLAYWRIGHT_EMAIL_SMTP_PORT = String(server.smtpPort);
  if (server.providerMock) process.env.PLAYWRIGHT_EMAIL_PROVIDER_URL = server.providerMock.url;
  return async () => {
    await server.stop();
  };
}
