/** Options controlling how the Mailpit server is obtained. */
export interface EmailServerOptions {
  /**
   * Connect to an already-running Mailpit instance (e.g. from docker-compose)
   * instead of spawning one. Example: 'http://localhost:8025'.
   */
  url?: string;
  /** SMTP host of the external instance. Defaults to the hostname of `url`. */
  smtpHost?: string;
  /**
   * SMTP port. For an external instance, the port your app sends to
   * (default 1025). When spawning, pins the SMTP port instead of picking a
   * free one — useful so a `webServer` app can be given a known port.
   */
  smtpPort?: number;
  /** Pin the HTTP API/UI port when spawning (default: a free port). */
  httpPort?: number;
  /** Mailpit release tag to download when spawning (default: pinned version). */
  version?: string;
  /** Directory used to cache the downloaded Mailpit binary. */
  cacheDir?: string;
  /** Extra CLI arguments passed to the spawned mailpit process. */
  args?: string[];
  /** How long to wait for the server to become ready, in ms (default 15000). */
  startTimeout?: number;
  /**
   * Also start the provider mock: an HTTP server impersonating the SendGrid,
   * Resend, and Postmark send APIs that injects into the mail server. Point
   * your app's provider SDK base URL at `mailServer.providerMock.url` to test
   * apps that send email via HTTP APIs instead of SMTP.
   */
  providerMock?: boolean | { port?: number };
}

/** Per-test configuration, settable via `test.use({ emailOptions: {...} })`. */
export interface EmailOptions {
  /** Server acquisition options. */
  server?: EmailServerOptions;
  /** Domain for generated inbox addresses (default 'example.test'). */
  inboxDomain?: string;
  /** Default timeout for `inbox.waitForEmail()` in ms (default 10000). */
  waitTimeout?: number;
  /** Poll interval for `inbox.waitForEmail()` in ms (default 250). */
  pollInterval?: number;
  /** Attach emails received during a failed test to the report (default true). */
  attachOnFailure?: boolean;
  /**
   * Delete the test's emails from the server on teardown (default true).
   * Set to false — or set the PLAYWRIGHT_EMAIL_KEEP=1 env var for a single
   * run — to keep messages browsable in the Mailpit UI after tests finish.
   */
  clearAfterTest?: boolean;
}

/** Filter for selecting an email. All given fields must match. */
export interface EmailFilter {
  /** Match the recipient address (defaults to the inbox address). */
  to?: string;
  /** Match the sender address. */
  from?: string;
  /** Match the subject, as substring (string) or pattern (RegExp). */
  subject?: string | RegExp;
  /** Match against the plain-text or HTML body. */
  body?: string | RegExp;
}

export interface WaitForEmailOptions {
  /** Max time to wait in ms (defaults to `EmailOptions.waitTimeout`). */
  timeout?: number;
}

export interface WaitForEmailsOptions extends WaitForEmailOptions {
  /** How many matching emails to wait for (default 1). */
  count?: number;
}
