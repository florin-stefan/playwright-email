import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { chmod, mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const DEFAULT_MAILPIT_VERSION = 'v1.30.4';

const DEFAULT_DOWNLOAD_BASE = 'https://github.com/axllent/mailpit/releases/download';

/**
 * SHA256 digests of the official release assets for the pinned version,
 * taken from the GitHub release metadata. Downloads are verified against
 * these; for other versions the digest is looked up from the GitHub API at
 * runtime (best effort).
 */
const KNOWN_CHECKSUMS: Record<string, Record<string, string>> = {
  'v1.30.4': {
    'mailpit-darwin-amd64.tar.gz': '67abb8dfd693eb2a511d6860b33c87bbbdfcf0a0eb7f494134a354e186b4e79b',
    'mailpit-darwin-arm64.tar.gz': 'a8181bbed0e6f82961abbe64df47657efaf53ac7cc0673fb34f0114c925cdaad',
    'mailpit-linux-386.tar.gz': '0441ee80b5157e037030080a6d26a25874a82d7b4f266370a187cd97918d8049',
    'mailpit-linux-amd64.tar.gz': 'e9c104154c22b83ac4c7d19f9d665a5c933585a3caafcd790805d732fa8d03fb',
    'mailpit-linux-arm.tar.gz': 'c6916cc26b91bb73cf49820d133d66f901a4ef7459f84efd5c62e5d814b1aaf4',
    'mailpit-linux-arm64.tar.gz': '27f6556c4d922d5ee2afb8b85a799dc2445b894782e7ec0196a566598d107221',
    'mailpit-windows-amd64.zip': '151378799345709c00e287a1b00bfee6f7ce5f5e8d0c00cc4133e3bbf2eaabdb',
    'mailpit-windows-arm64.zip': '673487b82d979034d7ac6b9e8cbafeb7fcfd4d84bc9b6c619132c211d3dce0d7',
  },
};

const PLATFORM_MAP: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'windows',
  darwin: 'darwin',
  linux: 'linux',
};

const ARCH_MAP: Partial<Record<string, string>> = {
  x64: 'amd64',
  arm64: 'arm64',
  ia32: '386',
  arm: 'arm',
};

export function defaultCacheDir(): string {
  if (process.env.PLAYWRIGHT_EMAIL_CACHE_DIR) return process.env.PLAYWRIGHT_EMAIL_CACHE_DIR;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'playwright-email');
  }
  const base = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
  return path.join(base, 'playwright-email');
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOCK_STALE_MS = 3 * 60_000;

/** Atomic cross-process lock via mkdir. Returns true if we own the lock. */
async function acquireLock(lockDir: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await mkdir(lockDir);
      return true;
    } catch {
      try {
        const s = await stat(lockDir);
        if (Date.now() - s.mtimeMs > LOCK_STALE_MS) {
          await rm(lockDir, { recursive: true, force: true });
          continue; // retry acquisition after removing a stale lock
        }
      } catch {
        continue; // lock vanished between mkdir and stat — retry
      }
      return false;
    }
  }
  return false;
}

export async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

/** Throws (and deletes the file) when its SHA256 does not match. */
export async function verifyChecksum(filePath: string, expectedHex: string): Promise<void> {
  const actual = await computeSha256(filePath);
  if (actual !== expectedHex.toLowerCase()) {
    await rm(filePath, { force: true });
    throw new Error(
      `playwright-email: checksum mismatch for ${path.basename(filePath)} — expected ${expectedHex}, got ${actual}. ` +
        'The download may be corrupted or tampered with; the file has been deleted.',
    );
  }
}

async function lookupDigest(version: string, asset: string): Promise<string | undefined> {
  const known = KNOWN_CHECKSUMS[version]?.[asset];
  if (known) return known;
  try {
    const res = await fetch(`https://api.github.com/repos/axllent/mailpit/releases/tags/${version}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const release = (await res.json()) as { assets?: Array<{ name: string; digest?: string | null }> };
    const digest = release.assets?.find((a) => a.name === asset)?.digest;
    return digest?.startsWith('sha256:') ? digest.slice('sha256:'.length) : undefined;
  } catch {
    return undefined;
  }
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`playwright-email: failed to download Mailpit from ${url} (HTTP ${res.status})`);
  }
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(dest));
}

function extract(archivePath: string, destDir: string): void {
  // System tar handles .tar.gz everywhere; on Windows 10+ tar.exe is bsdtar,
  // which extracts .zip as well.
  const tar = spawnSync('tar', ['-xf', archivePath, '-C', destDir], { encoding: 'utf8' });
  if (tar.status === 0) return;

  if (process.platform === 'win32' && archivePath.endsWith('.zip')) {
    const ps = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${destDir}" -Force`],
      { encoding: 'utf8' },
    );
    if (ps.status === 0) return;
    throw new Error(`playwright-email: failed to extract ${archivePath}: ${ps.stderr || tar.stderr}`);
  }
  throw new Error(`playwright-email: failed to extract ${archivePath}: ${tar.stderr ?? 'tar not found'}`);
}

/**
 * Ensure the Mailpit binary for this platform is present in the cache,
 * downloading it from GitHub releases on first use. Returns the binary path.
 */
export async function ensureMailpit(opts: { version?: string; cacheDir?: string } = {}): Promise<string> {
  // Air-gapped / bring-your-own-binary escape hatch (e.g. installed via a
  // package manager or baked into a Docker image).
  if (process.env.PLAYWRIGHT_EMAIL_BINARY) {
    const custom = process.env.PLAYWRIGHT_EMAIL_BINARY;
    try {
      await stat(custom);
    } catch {
      throw new Error(`playwright-email: PLAYWRIGHT_EMAIL_BINARY points to "${custom}" but no file exists there`);
    }
    return custom;
  }

  const version = opts.version ?? DEFAULT_MAILPIT_VERSION;
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!platform || !arch) {
    throw new Error(`playwright-email: unsupported platform ${process.platform}/${process.arch}`);
  }

  const dir = path.join(opts.cacheDir ?? defaultCacheDir(), version);
  const binPath = path.join(dir, process.platform === 'win32' ? 'mailpit.exe' : 'mailpit');
  if (await exists(binPath)) return binPath;

  await mkdir(dir, { recursive: true });
  const lockDir = path.join(dir, '.download-lock');

  if (!(await acquireLock(lockDir))) {
    // Another process is downloading — wait for the binary to appear.
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (await exists(binPath)) return binPath;
      await delay(250);
    }
    throw new Error('playwright-email: timed out waiting for another process to download Mailpit');
  }

  try {
    if (await exists(binPath)) return binPath; // lost a race before locking

    const ext = platform === 'windows' ? '.zip' : '.tar.gz';
    const asset = `mailpit-${platform}-${arch}${ext}`;
    const base = process.env.PLAYWRIGHT_EMAIL_DOWNLOAD_BASE?.replace(/\/+$/, '') ?? DEFAULT_DOWNLOAD_BASE;
    const url = `${base}/${version}/${asset}`;
    const archivePath = path.join(dir, `${asset}.tmp`);

    await download(url, archivePath);
    const expected = await lookupDigest(version, asset);
    if (expected) {
      await verifyChecksum(archivePath, expected);
    } else {
      console.warn(`playwright-email: no SHA256 digest available for ${asset}@${version}; skipping verification.`);
    }
    extract(archivePath, dir);
    await rm(archivePath, { force: true });

    if (!(await exists(binPath))) {
      throw new Error(`playwright-email: archive extracted but ${binPath} not found`);
    }
    if (process.platform !== 'win32') await chmod(binPath, 0o755);
    return binPath;
  } finally {
    await rm(lockDir, { recursive: true, force: true });
  }
}
