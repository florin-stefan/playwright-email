import { describe, expect, it } from 'vitest';
import { extractOtpFromContent } from '../../src/email';

describe('extractOtpFromContent', () => {
  it('finds a plain 6-digit code', () => {
    expect(extractOtpFromContent('Your verification code is 482913. It expires in 10 minutes.', '')).toBe('482913');
  });

  it('finds a code at the end of a sentence (followed by a period)', () => {
    expect(extractOtpFromContent('Use the code 7391.', '')).toBe('7391');
  });

  it('normalizes spaced codes like "123 456"', () => {
    expect(extractOtpFromContent('Your one-time passcode: 123 456', '')).toBe('123456');
  });

  it('normalizes hyphenated codes like "44-55-66"', () => {
    expect(extractOtpFromContent('Enter 44-55-66 to continue', '')).toBe('445566');
  });

  it('extracts from HTML when there is no text body', () => {
    const html = `
      <html><head><style>.code { font-size: 24px; }</style></head>
      <body>
        <p>Hi there,</p>
        <p>Your verification code:</p>
        <div class="code"><strong>905  414</strong></div>
        <p><a href="https://app.test/track/12345678901">View in browser</a></p>
      </body></html>`;
    expect(extractOtpFromContent('', html)).toBe('905414');
  });

  it('ignores digits inside URLs', () => {
    const text = 'Confirm here: https://app.test/verify?token=99887766\nYour code is 2468';
    expect(extractOtpFromContent(text, '')).toBe('2468');
  });

  it('ignores phone numbers with grouped digits', () => {
    const text = 'Call us at +1 555 123 4567 if you need help. Your security code is 314159.';
    expect(extractOtpFromContent(text, '')).toBe('314159');
  });

  it('ignores ISO dates', () => {
    const text = 'Requested on 2026-07-17. Your code: 6060';
    expect(extractOtpFromContent(text, '')).toBe('6060');
  });

  it('picks the digit run closest to a keyword when several exist', () => {
    const text = 'Order #48291 has shipped. Your delivery PIN is 7777. Invoice 55123 attached.';
    expect(extractOtpFromContent(text, '')).toBe('7777');
  });

  it('prefers a unique 6-digit run when no keyword is present', () => {
    const text = 'Ref 1234 — enter 987654 to proceed';
    expect(extractOtpFromContent(text, '')).toBe('987654');
  });

  it('honors an exact length filter', () => {
    const text = 'Backup key 12345678, sign-in code 4321';
    expect(extractOtpFromContent(text, '', { length: 4 })).toBe('4321');
    expect(extractOtpFromContent(text, '', { length: 8 })).toBe('12345678');
  });

  it('throws a descriptive error when no code exists', () => {
    expect(() => extractOtpFromContent('Welcome aboard! Thanks for joining.', '')).toThrow(/no OTP code/);
  });

  it('throws on genuinely ambiguous emails', () => {
    expect(() => extractOtpFromContent('Numbers: 1111 and later 2222', '')).toThrow(/ambiguous OTP/);
  });
});
