# Changelog

## 0.3.0 — 2026-07-17

First public release. Highlights over the internal iterations:

### Added
- **Provider mock** — an HTTP server impersonating the SendGrid (`POST /v3/mail/send`), Resend (`POST /emails`), and Postmark (`POST /email`) send APIs that injects into the test mail server. Apps that send email through provider REST APIs instead of SMTP can now be tested by pointing the SDK base URL at the mock. Enable via `mailServerOptions: { providerMock: true }`, `PLAYWRIGHT_EMAIL_PROVIDER_PORT` with the bundled global setup, or `playwright-email start --provider-mock`.
- **SHA256 verification** of the downloaded Mailpit binary against pinned digests (GitHub API lookup for non-pinned versions).
- **Air-gap / enterprise installs**: `PLAYWRIGHT_EMAIL_BINARY` (bring your own binary) and `PLAYWRIGHT_EMAIL_DOWNLOAD_BASE` (mirror) env overrides.
- **`playwright-email install`** CLI command to prefetch the binary in CI images and Docker layers.
- **`inbox.waitForEmails(filter, { count })`** for resend flows, digests, and bulk sends.
- **`newInbox({ prefix })`** for readable persona addresses (`buyer-…@example.test`).
- **`email.open(page)`** renders the email body in a Playwright page for visual/a11y assertions on transactional templates.
- **`email.raw()`** returns the RFC 822 source; failed tests now attach `.eml` files alongside HTML bodies.
- **`mergeTests` support** verified and documented for teams with their own extended `test`.

## 0.2.0 — 2026-07-17 (unreleased)

- `playwright-email start` CLI for a persistent Mailpit during local debugging.
- `startMailpit` reuses a healthy instance already listening on a pinned HTTP port instead of failing.
- `emailOptions.clearAfterTest` and the `PLAYWRIGHT_EMAIL_KEEP=1` env var to keep messages browsable after a run.

## 0.1.0 — 2026-07-17 (unreleased)

- Initial implementation: managed Mailpit download/spawn, `inbox`/`newInbox`/`mailServer` fixtures, `waitForEmail`, `extractOtp`/`extractLink`, `toReceiveEmail` matcher, TOTP helper, report attachments on failure, shared-server global setup, external-server mode.
