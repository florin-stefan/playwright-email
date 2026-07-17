import { describe, expect, it } from 'vitest';
import { startMailpit } from '../../src/server/process';

describe('mailpit server lifecycle', () => {
  it('downloads the binary, spawns, becomes ready, and stops cleanly', async () => {
    const server = await startMailpit();
    expect(server.external).toBe(false);
    expect(server.smtpHost).toBe('127.0.0.1');
    expect(server.smtpPort).toBeGreaterThan(0);

    const res = await fetch(`${server.url}/api/v1/info`);
    expect(res.ok).toBe(true);
    const info = (await res.json()) as { Version?: string };
    expect(info.Version).toBeTruthy();

    await server.stop();
    await expect(
      fetch(`${server.url}/api/v1/info`, { signal: AbortSignal.timeout(1500) }),
    ).rejects.toThrow();
  }, 120_000);

  it('reuses an already-running instance on a pinned http port', async () => {
    const first = await startMailpit();
    try {
      const second = await startMailpit({ httpPort: first.httpPort, smtpPort: first.smtpPort });
      expect(second.external).toBe(true);
      expect(second.url).toBe(first.url);
      expect(second.smtpPort).toBe(first.smtpPort);

      // Stopping the reused handle must NOT kill the real server.
      await second.stop();
      const res = await fetch(`${first.url}/api/v1/info`);
      expect(res.ok).toBe(true);
    } finally {
      await first.stop();
    }
  }, 60_000);

  it('two instances run in parallel on distinct ports', async () => {
    const [a, b] = await Promise.all([startMailpit(), startMailpit()]);
    try {
      expect(a.smtpPort).not.toBe(b.smtpPort);
      expect(a.httpPort).not.toBe(b.httpPort);
      const [ra, rb] = await Promise.all([
        fetch(`${a.url}/api/v1/info`),
        fetch(`${b.url}/api/v1/info`),
      ]);
      expect(ra.ok).toBe(true);
      expect(rb.ok).toBe(true);
    } finally {
      await Promise.all([a.stop(), b.stop()]);
    }
  }, 60_000);
});
