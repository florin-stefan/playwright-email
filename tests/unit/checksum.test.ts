import { createHash } from 'node:crypto';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSha256, verifyChecksum } from '../../src/server/binary';

async function tempFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'pwe-checksum-'));
  const file = path.join(dir, 'artifact.bin');
  await writeFile(file, content);
  return file;
}

describe('download checksum verification', () => {
  it('computeSha256 matches node:crypto', async () => {
    const file = await tempFile('hello mailpit');
    const expected = createHash('sha256').update('hello mailpit').digest('hex');
    expect(await computeSha256(file)).toBe(expected);
  });

  it('verifyChecksum accepts a matching digest (case-insensitive)', async () => {
    const file = await tempFile('payload');
    const digest = createHash('sha256').update('payload').digest('hex');
    await expect(verifyChecksum(file, digest.toUpperCase())).resolves.toBeUndefined();
  });

  it('verifyChecksum throws and deletes the file on mismatch', async () => {
    const file = await tempFile('tampered payload');
    await expect(verifyChecksum(file, 'a'.repeat(64))).rejects.toThrow(/checksum mismatch/);
    await expect(stat(file)).rejects.toThrow();
  });
});
