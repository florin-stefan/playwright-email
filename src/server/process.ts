import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ensureMailpit } from './binary';
import { startProviderMock } from './provider-mock';
import type { EmailServerOptions } from '../types';

/** A running (or externally provided) Mailpit instance. */
export interface MailpitHandle {
  /** Base URL of the Mailpit HTTP API/UI, e.g. http://127.0.0.1:54321 */
  url: string;
  httpPort: number;
  /** Host the app under test should send SMTP to. */
  smtpHost: string;
  /** Port the app under test should send SMTP to. */
  smtpPort: number;
  /** True when connected to a user-provided instance we must not stop. */
  external: boolean;
  /** The provider-API mock (SendGrid/Resend/Postmark), when enabled. */
  providerMock?: { url: string; port: number };
  stop(): Promise<void>;
}

/**
 * Attach the provider mock to a handle: reuse the one advertised via
 * PLAYWRIGHT_EMAIL_PROVIDER_URL (started by global-setup or the CLI), or
 * start one owned by this handle when the option asks for it.
 */
async function attachProviderMock(handle: MailpitHandle, opts: EmailServerOptions): Promise<MailpitHandle> {
  const envUrl = process.env.PLAYWRIGHT_EMAIL_PROVIDER_URL;
  if (envUrl) {
    const parsed = new URL(envUrl);
    handle.providerMock = { url: envUrl.replace(/\/+$/, ''), port: Number(parsed.port) || 80 };
    return handle;
  }
  if (!opts.providerMock) return handle;
  const mock = await startProviderMock(handle.url, typeof opts.providerMock === 'object' ? opts.providerMock : {});
  handle.providerMock = { url: mock.url, port: mock.port };
  const stopServer = handle.stop;
  handle.stop = async () => {
    await mock.stop();
    await stopServer();
  };
  return handle;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reserve two distinct free ports by holding both listeners open at once. */
async function twoFreePorts(): Promise<[number, number]> {
  const listen = (): Promise<net.Server> =>
    new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.once('error', reject);
      srv.listen(0, '127.0.0.1', () => resolve(srv));
    });
  const close = (srv: net.Server): Promise<void> =>
    new Promise((resolve) => srv.close(() => resolve()));

  const [a, b] = await Promise.all([listen(), listen()]);
  const portA = (a.address() as net.AddressInfo).port;
  const portB = (b.address() as net.AddressInfo).port;
  await Promise.all([close(a), close(b)]);
  return [portA, portB];
}

async function isReady(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/v1/info`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(
  url: string,
  timeoutMs: number,
  hasExited: () => boolean,
  getLogs: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasExited()) {
      throw new Error(`playwright-email: Mailpit exited before becoming ready.\n${getLogs()}`);
    }
    if (await isReady(url)) return;
    await delay(100);
  }
  throw new Error(`playwright-email: Mailpit did not become ready within ${timeoutMs}ms at ${url}.\n${getLogs()}`);
}

// Kill any still-running Mailpit children if the runner process itself dies.
const liveChildren = new Set<ChildProcess>();
let exitHookInstalled = false;
function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const child of liveChildren) child.kill('SIGKILL');
  });
}

/**
 * Start (or connect to) a Mailpit instance.
 *
 * With no options, downloads the pinned Mailpit release on first use and
 * spawns it on two free localhost ports with an isolated temp database.
 * With `url`, connects to an existing instance and never stops it.
 */
export async function startMailpit(opts: EmailServerOptions = {}): Promise<MailpitHandle> {
  if (opts.url) {
    const url = opts.url.replace(/\/+$/, '');
    const deadline = Date.now() + (opts.startTimeout ?? 15_000);
    while (!(await isReady(url))) {
      if (Date.now() > deadline) {
        throw new Error(`playwright-email: cannot reach external Mailpit at ${url}/api/v1/info`);
      }
      await delay(200);
    }
    return attachProviderMock(
      {
        url,
        httpPort: Number(new URL(url).port) || 80,
        smtpHost: opts.smtpHost ?? new URL(url).hostname,
        smtpPort: opts.smtpPort ?? 1025,
        external: true,
        stop: async () => {},
      },
      opts,
    );
  }

  // A healthy instance already listening on the pinned HTTP port (e.g. one
  // started with `npx playwright-email start` for live debugging) is reused
  // instead of failing on a busy port — and never stopped by us.
  if (opts.httpPort) {
    const url = `http://127.0.0.1:${opts.httpPort}`;
    if (await isReady(url)) {
      return attachProviderMock(
        {
          url,
          httpPort: opts.httpPort,
          smtpHost: opts.smtpHost ?? '127.0.0.1',
          smtpPort: opts.smtpPort ?? 1025,
          external: true,
          stop: async () => {},
        },
        opts,
      );
    }
  }

  const binary = await ensureMailpit(opts);
  installExitHook();

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [freeA, freeB] = await twoFreePorts();
    const smtpPort = opts.smtpPort ?? freeA;
    const httpPort = opts.httpPort ?? freeB;
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'playwright-email-'));
    const args = [
      '--smtp', `127.0.0.1:${smtpPort}`,
      '--listen', `127.0.0.1:${httpPort}`,
      '--database', path.join(dataDir, 'mailpit.db'),
      ...(opts.args ?? []),
    ];

    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    liveChildren.add(child);

    const logs: string[] = [];
    const pushLog = (chunk: Buffer) => {
      logs.push(chunk.toString());
      if (logs.length > 200) logs.shift();
    };
    child.stdout?.on('data', pushLog);
    child.stderr?.on('data', pushLog);

    let exited = false;
    const exitPromise = new Promise<void>((resolve) => {
      child.once('exit', () => {
        exited = true;
        liveChildren.delete(child);
        resolve();
      });
    });

    const url = `http://127.0.0.1:${httpPort}`;
    const cleanup = async () => {
      if (!exited) {
        child.kill();
        await Promise.race([exitPromise, delay(3000)]);
      }
      if (!exited) {
        child.kill('SIGKILL');
        await Promise.race([exitPromise, delay(2000)]);
      }
      await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
      await waitUntilReady(url, opts.startTimeout ?? 15_000, () => exited, () => logs.join(''));
      return await attachProviderMock(
        {
          url,
          httpPort,
          smtpHost: '127.0.0.1',
          smtpPort,
          external: false,
          stop: cleanup,
        },
        opts,
      );
    } catch (err) {
      // Most likely a port-allocation race with another process — retry.
      lastError = err;
      await cleanup();
    }
  }
  throw lastError;
}
