import { test as base } from '@playwright/test';
import crypto from 'node:crypto';
import { Inbox } from './inbox';
import { MailpitClient } from './server/api';
import { startMailpit, type MailpitHandle } from './server/process';
import type { EmailOptions, EmailServerOptions } from './types';

export interface NewInboxOptions {
  /** Readable local-part prefix, e.g. 'buyer' → buyer-0-a1b2c3d4@example.test */
  prefix?: string;
}

export interface EmailTestFixtures {
  /** Per-test configuration; set via `test.use({ emailOptions: {...} })`. */
  emailOptions: EmailOptions;
  /** A unique, isolated inbox for this test. */
  inbox: Inbox;
  /** Factory for additional inboxes (multi-recipient scenarios). */
  newInbox: (options?: NewInboxOptions) => Inbox;
}

export interface EmailWorkerFixtures {
  /** Server acquisition options; worker-scoped, settable in config `use`. */
  mailServerOptions: EmailServerOptions;
  /** The Mailpit instance backing this worker (spawned or external). */
  mailServer: MailpitHandle;
}

const DEFAULTS = {
  inboxDomain: 'example.test',
  waitTimeout: 10_000,
  pollInterval: 250,
  attachOnFailure: true,
  clearAfterTest: true,
} as const;

function keepEmailsEnv(): boolean {
  return ['1', 'true', 'yes'].includes((process.env.PLAYWRIGHT_EMAIL_KEEP ?? '').toLowerCase());
}

export const test = base.extend<EmailTestFixtures, EmailWorkerFixtures>({
  mailServerOptions: [{}, { option: true, scope: 'worker' }],
  emailOptions: [{}, { option: true }],

  mailServer: [
    async ({ mailServerOptions }, use) => {
      const opts: EmailServerOptions = { ...mailServerOptions };
      // Priority: explicit option > env (set by our globalSetup or CI) > spawn.
      if (!opts.url && process.env.PLAYWRIGHT_EMAIL_URL) {
        opts.url = process.env.PLAYWRIGHT_EMAIL_URL;
        opts.smtpHost ??= process.env.PLAYWRIGHT_EMAIL_SMTP_HOST;
        if (opts.smtpPort === undefined && process.env.PLAYWRIGHT_EMAIL_SMTP_PORT) {
          opts.smtpPort = Number(process.env.PLAYWRIGHT_EMAIL_SMTP_PORT);
        }
      }
      const server = await startMailpit(opts);
      // Expose connection details to code running inside this worker
      // (e.g. apps spawned per-worker, or helpers sending SMTP directly).
      process.env.PLAYWRIGHT_EMAIL_URL = server.url;
      process.env.PLAYWRIGHT_EMAIL_SMTP_HOST = server.smtpHost;
      process.env.PLAYWRIGHT_EMAIL_SMTP_PORT = String(server.smtpPort);
      if (server.providerMock) {
        process.env.PLAYWRIGHT_EMAIL_PROVIDER_URL = server.providerMock.url;
      }
      await use(server);
      await server.stop();
    },
    { scope: 'worker' },
  ],

  newInbox: async ({ mailServer, emailOptions }, use, testInfo) => {
    const o = { ...DEFAULTS, ...emailOptions };
    const client = new MailpitClient(mailServer.url);
    const created: Inbox[] = [];
    let counter = 0;

    const factory = (options: { prefix?: string } = {}): Inbox => {
      const hash = crypto
        .createHash('sha1')
        .update(`${testInfo.testId}#${testInfo.retry}#${counter}`)
        .digest('hex')
        .slice(0, 8);
      counter += 1;
      const prefix =
        options.prefix
          ?.toLowerCase()
          .replace(/[^a-z0-9._-]+/g, '-')
          .replace(/^[-.]+|[-.]+$/g, '') || 'inbox';
      const inbox = new Inbox(`${prefix}-${testInfo.workerIndex}-${hash}@${o.inboxDomain}`, client, {
        waitTimeout: o.waitTimeout,
        pollInterval: o.pollInterval,
      });
      created.push(inbox);
      return inbox;
    };

    await use(factory);

    const failed = testInfo.status !== undefined && testInfo.status !== testInfo.expectedStatus;
    if (failed && o.attachOnFailure) {
      for (const inbox of created) {
        try {
          const emails = await inbox.emails();
          if (emails.length === 0) continue;
          const summary = emails.map((e) => ({
            subject: e.subject,
            from: e.from,
            to: e.to,
            date: e.date.toISOString(),
          }));
          await testInfo.attach(`emails received by ${inbox.address}`, {
            body: JSON.stringify(summary, null, 2),
            contentType: 'application/json',
          });
          for (const e of emails.slice(0, 10)) {
            const name = `email: ${e.subject || '(no subject)'}`;
            if (e.html) {
              await testInfo.attach(name, { body: e.html, contentType: 'text/html' });
            } else if (e.text) {
              await testInfo.attach(name, { body: e.text, contentType: 'text/plain' });
            }
            try {
              // The raw source opens in real mail clients (Outlook, Thunderbird).
              const raw = await e.raw();
              await testInfo.attach(`${name}.eml`, { body: Buffer.from(raw), contentType: 'message/rfc822' });
            } catch {
              // best-effort
            }
          }
        } catch {
          // Server may already be unreachable; attachments are best-effort.
        }
      }
    }
    if (o.clearAfterTest && !keepEmailsEnv()) {
      for (const inbox of created) {
        await inbox.clear().catch(() => {});
      }
    }
  },

  inbox: async ({ newInbox }, use) => {
    await use(newInbox());
  },
});
