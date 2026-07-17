# playwright-email

[![CI](https://github.com/florin-stefan/playwright-email/actions/workflows/ci.yml/badge.svg)](https://github.com/florin-stefan/playwright-email/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/playwright-email)](https://www.npmjs.com/package/playwright-email)
[![license](https://img.shields.io/npm/l/playwright-email)](./LICENSE)

Zero-config email testing for [Playwright](https://playwright.dev). Test signup verification, password resets, magic links, email OTPs, and TOTP 2FA — with no Docker setup, no paid inbox API, and no polling boilerplate. Works whether your app sends over SMTP **or through the SendGrid / Resend / Postmark HTTP APIs**.

```ts
import { test, expect } from 'playwright-email';

test('signup with email verification', async ({ page, inbox }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(inbox.address); // unique per test
  await page.getByRole('button', { name: 'Sign up' }).click();

  const email = await inbox.waitForEmail({ subject: /verify/i });
  await page.goto(email.extractLink({ text: /confirm/i }));

  await expect(page.getByText('Verified')).toBeVisible();
});
```

On first run, `playwright-email` downloads a pinned [Mailpit](https://github.com/axllent/mailpit) release (a single ~10 MB static binary, MIT-licensed) into a local cache — the same way Playwright manages browsers — and spawns it on free ports. Every test gets an isolated inbox address; every worker gets its own server. No configuration required.

## Install

```bash
npm i -D playwright-email
```

Requires Node 18+ and `@playwright/test` ≥ 1.40.

Already have your own extended `test`? Compose instead of rebasing:

```ts
import { mergeTests } from '@playwright/test';
import { test as emailTest } from 'playwright-email';
import { test as myTest } from './my-fixtures';

export const test = mergeTests(myTest, emailTest);
```

## Point your app at the test SMTP server

Your app needs to send mail to the test server instead of a real provider. Two setups:

### A. App started by Playwright's `webServer` (most common)

Use the bundled global setup so one Mailpit serves the whole run, and pin its ports in the config (Playwright may start `webServer` before global setup runs, so pass the SMTP port to your app explicitly):

```ts
// playwright.config.ts
process.env.PLAYWRIGHT_EMAIL_SMTP_PORT = '2525';
process.env.PLAYWRIGHT_EMAIL_HTTP_PORT = '8025';

export default defineConfig({
  globalSetup: require.resolve('playwright-email/global-setup'),
  webServer: {
    command: 'npm run start:app',
    port: 3000,
    env: { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525' },
  },
});
```

The fixtures detect the shared instance automatically via `PLAYWRIGHT_EMAIL_URL`.

### B. Existing Mailpit (docker-compose, staging)

Don't spawn anything — connect to what's already running:

```ts
test.use({
  mailServerOptions: { url: 'http://localhost:8025', smtpPort: 1025 },
});
```

or set `PLAYWRIGHT_EMAIL_URL=http://localhost:8025` in CI. With neither configured, each worker spawns its own isolated Mailpit — perfect when your tests (or per-worker app instances) send the mail themselves.

### C. App sends via SendGrid / Resend / Postmark (no SMTP)

Many apps never speak SMTP — they call the provider's REST API. Enable the **provider mock** and point the SDK's base URL at it; every "sent" email lands in the test inbox:

```ts
// playwright.config.ts
process.env.PLAYWRIGHT_EMAIL_PROVIDER_PORT = '8465';

export default defineConfig({
  globalSetup: require.resolve('playwright-email/global-setup'),
  webServer: {
    command: 'npm run start:app',
    env: { SENDGRID_BASE_URL: 'http://127.0.0.1:8465' }, // or RESEND_BASE_URL / POSTMARK_BASE_URL
  },
});
```

Supported endpoints: SendGrid `POST /v3/mail/send`, Resend `POST /emails`, Postmark `POST /email` (auth headers accepted, not validated). Most official SDKs accept a base-URL override; if yours doesn't, an env-var switch in your mail module does the job. Per-worker mode: `test.use({ mailServerOptions: { providerMock: true } })` and read `mailServer.providerMock.url`.

## Recipes

### Email OTP / verification code

```ts
const email = await inbox.waitForEmail({ subject: /your code/i });
const code = email.extractOtp(); // finds "482913" in "Your code is 482913."
await page.getByLabel('Verification code').fill(code);
```

`extractOtp()` finds 4–8 digit codes, handles `123 456` / `44-55-66` grouping, ignores digits in URLs, dates, and phone numbers, and prefers digits near words like "code" or "verification". Pass `{ length: 6 }` to be strict. When it can't decide, it throws an error listing every candidate.

### Magic link / password reset

```ts
const email = await inbox.waitForEmail({ subject: 'Reset your password' });
const url = email.extractLink({ text: /reset password/i }); // or { href: /\/reset\// }
await page.goto(url);
```

HTML entities are decoded (`&amp;` in query strings just works). On no match, the error lists every link found in the email.

### Authenticator-app 2FA (TOTP)

```ts
import { totp } from 'playwright-email';

// secret from your test user's enrollment (base32 or otpauth:// URI)
await page.getByLabel('Authentication code').fill(totp(process.env.TEST_TOTP_SECRET!));
```

### Multiple recipients

```ts
test('invite flow', async ({ inbox, newInbox, page }) => {
  const invitee = newInbox();
  // ... invite invitee.address via the UI ...
  const email = await invitee.waitForEmail({ subject: /you're invited/i });
});
```

### Asserting emails (including "no email")

```ts
await expect(inbox).toReceiveEmail({ subject: /welcome/i });
await expect(inbox).not.toReceiveEmail({ subject: /admin alert/i }, { timeout: 2000 });
```

### Attachments

```ts
const email = await inbox.waitForEmail({ subject: 'Your invoice' });
expect(email.attachments[0].fileName).toBe('invoice.pdf');
const bytes = await email.attachments[0].download();
```

### Bulk sends / resend flows

```ts
await page.getByRole('button', { name: 'Resend code' }).click();
const emails = await inbox.waitForEmails({ subject: /your code/i }, { count: 2 });
expect(emails[0].extractOtp()).not.toBe(emails[1].extractOtp());
```

### Visual checks on the email template itself

```ts
const email = await inbox.waitForEmail({ subject: 'Order confirmation' });
await email.open(page); // renders the email HTML in the browser
await expect(page.getByRole('img', { name: 'logo' })).toBeVisible();
await expect(page).toHaveScreenshot('order-confirmation-email.png');
```

## Debugging

When a test fails, every email the inbox received is attached to the Playwright HTML report (subjects as JSON + full HTML bodies), so you can see exactly what your app sent. Disable with `emailOptions: { attachOnFailure: false }`.

### Watching emails live in the Mailpit UI

By default everything is **ephemeral**: the managed server is killed when the run ends and each test clears its inbox on teardown — exactly what you want in CI, but it means the web UI dies with the run. For interactive debugging, run a persistent server instead:

```bash
npx playwright-email start --smtp 2525 --http 8025   # terminal 1 — stays up until Ctrl+C
```

Tests configured with the same pinned ports **reuse** a server that is already listening (and never stop it) — no port conflicts, no double spawning. Then keep the messages around to browse them after the run:

```bash
PLAYWRIGHT_EMAIL_KEEP=1 npx playwright test          # terminal 2 (PowerShell: $env:PLAYWRIGHT_EMAIL_KEEP='1')
```

Open the UI at the `--http` port (here <http://127.0.0.1:8025>) and watch emails arrive as tests execute. `emailOptions: { clearAfterTest: false }` is the permanent equivalent of the env var.

## API

### Fixtures

| Fixture | Scope | Description |
|---|---|---|
| `inbox` | test | Unique isolated `Inbox` for this test |
| `newInbox({ prefix? })` | test | Factory for extra inboxes (`newInbox({ prefix: 'buyer' })` → `buyer-…@example.test`) |
| `mailServer` | worker | The backing Mailpit (`url`, `smtpHost`, `smtpPort`, `providerMock?.url`) |
| `emailOptions` | test option | `{ inboxDomain, waitTimeout, pollInterval, attachOnFailure, clearAfterTest }` |
| `mailServerOptions` | worker option | `{ url, smtpHost, smtpPort, httpPort, version, cacheDir, args, startTimeout, providerMock }` |

### `Inbox`

- `address: string` — the unique email address to use in your app
- `waitForEmail(filter?, { timeout? })` — polls until a matching email exists; rich timeout errors
- `waitForEmails(filter?, { count?, timeout? })` — wait for N matches, newest first
- `emails(filter?)` — current matches, newest first
- `clear()` — delete this inbox's messages

Filters: `{ to, from, subject: string | RegExp, body: string | RegExp }`.

### `Email`

`subject`, `from`, `to`, `cc`, `date`, `html`, `text`, `attachments` (with `download()`), `extractOtp({ length? })`, `extractLink({ text?, href? })`, `extractLinks()`, `open(page)` (render in the browser), `raw()` (RFC 822 source).

### Standalone helpers

```ts
import { startMailpit, MailpitClient, totp } from 'playwright-email';
```

`startMailpit()` gives you the managed server outside the fixtures (custom global setups, other test runners).

## CI, enterprise networks, and air-gapped installs

Downloads are **SHA256-verified** against the official release digests. Cache the binary so it downloads once:

```yaml
- uses: actions/cache@v4
  with:
    path: |
      ~/.cache/playwright-email
      ~/AppData/Local/playwright-email
    key: mailpit-${{ runner.os }}
```

Linux, macOS, and Windows runners are all supported. For Docker images and prebaked CI layers, prefetch with:

```bash
npx playwright-email install
```

Locked-down environments:

| Env var | Effect |
|---|---|
| `PLAYWRIGHT_EMAIL_BINARY` | Use an existing mailpit binary (brew/choco/baked image); nothing is downloaded |
| `PLAYWRIGHT_EMAIL_DOWNLOAD_BASE` | Download from an internal mirror instead of github.com |
| `PLAYWRIGHT_EMAIL_CACHE_DIR` | Relocate the binary cache (pre-seedable) |

Behind a corporate proxy, use a mirror or `PLAYWRIGHT_EMAIL_BINARY` (Node's `fetch` honors `NODE_USE_ENV_PROXY=1` on Node 24+).

## How it compares

| | playwright-email | Mailosaur / MailSlurp | Hand-rolled Mailpit |
|---|---|---|---|
| Cost | Free, OSS | Paid API | Free |
| Setup | `npm i -D` | API keys | Docker + glue code |
| Works offline / in CI | ✅ | ❌ needs network + secrets | ✅ |
| Playwright fixtures, matchers, report attachments | ✅ | partial | you write them |

## Roadmap

- Amazon SES / Mailgun shims for the provider mock
- First-class helpers for email visual regression baselines
- Suggest something → [open a feature request](https://github.com/florin-stefan/playwright-email/issues)

## License

MIT. Mailpit is a separate MIT-licensed project by [@axllent](https://github.com/axllent/mailpit), downloaded from its official GitHub releases at first run.
