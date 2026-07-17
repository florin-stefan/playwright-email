import { describe, expect, it } from 'vitest';
import { totp } from '../../src/totp';

// RFC 6238 test vector: ASCII secret "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches the RFC 6238 SHA1 test vector', () => {
    expect(totp(RFC_SECRET, { digits: 8, timestamp: 59_000 })).toBe('94287082');
    expect(totp(RFC_SECRET, { digits: 8, timestamp: 1_111_111_109_000 })).toBe('07081804');
  });

  it('normalizes lowercase and spaced secrets', () => {
    const spaced = 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq';
    expect(totp(spaced, { digits: 8, timestamp: 59_000 })).toBe('94287082');
  });

  it('accepts an otpauth:// URI', () => {
    const uri = `otpauth://totp/App:user@example.test?secret=${RFC_SECRET}&digits=8&period=30&algorithm=SHA1`;
    expect(totp(uri, { timestamp: 59_000 })).toBe('94287082');
  });

  it('generates 6 digits by default', () => {
    expect(totp(RFC_SECRET)).toMatch(/^\d{6}$/);
  });

  it('rejects non-TOTP otpauth URIs', () => {
    expect(() => totp(`otpauth://hotp/App?secret=${RFC_SECRET}&counter=0`)).toThrow(/only otpauth:\/\/totp/);
  });
});
