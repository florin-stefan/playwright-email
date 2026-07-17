import * as OTPAuth from 'otpauth';

export interface TotpOptions {
  /** Number of digits (default 6). Ignored for otpauth:// URIs. */
  digits?: number;
  /** Time step in seconds (default 30). Ignored for otpauth:// URIs. */
  period?: number;
  /** HMAC algorithm (default 'SHA1'). Ignored for otpauth:// URIs. */
  algorithm?: 'SHA1' | 'SHA256' | 'SHA512';
  /** Generate the code for a specific time (ms since epoch) instead of now. */
  timestamp?: number;
}

/**
 * Generate the current TOTP code for authenticator-app 2FA flows.
 * Accepts a base32 secret (spaces allowed, case-insensitive) or a full
 * `otpauth://totp/...` URI as shown in "can't scan the QR code?" dialogs.
 */
export function totp(secretOrUri: string, options: TotpOptions = {}): string {
  if (secretOrUri.startsWith('otpauth://')) {
    const parsed = OTPAuth.URI.parse(secretOrUri);
    if (!(parsed instanceof OTPAuth.TOTP)) {
      throw new Error('playwright-email: only otpauth://totp/ URIs are supported');
    }
    return parsed.generate({ timestamp: options.timestamp });
  }

  const secret = secretOrUri.replace(/\s+/g, '').toUpperCase();
  const generator = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    digits: options.digits ?? 6,
    period: options.period ?? 30,
    algorithm: options.algorithm ?? 'SHA1',
  });
  return generator.generate({ timestamp: options.timestamp });
}
