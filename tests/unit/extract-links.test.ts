import { describe, expect, it } from 'vitest';
import { extractLinksFromContent } from '../../src/email';

const HTML = `
<html><body>
  <p>Please <a href="https://app.test/confirm?token=abc&amp;user=42">Confirm your email</a></p>
  <p><a href='https://app.test/docs'>Read the <strong>docs</strong></a></p>
  <a href="#top">Back to top</a>
  <a href="https://app.test/confirm?token=abc&amp;user=42">Confirm your email</a>
</body></html>`;

describe('extractLinksFromContent', () => {
  it('parses anchors, decodes entities, strips inner tags, dedupes', () => {
    const links = extractLinksFromContent('', HTML);
    expect(links).toEqual([
      { href: 'https://app.test/confirm?token=abc&user=42', text: 'Confirm your email' },
      { href: 'https://app.test/docs', text: 'Read the docs' },
    ]);
  });

  it('collects bare URLs from plain text and trims trailing punctuation', () => {
    const links = extractLinksFromContent('Reset here: https://app.test/reset/xyz123.', '');
    expect(links).toEqual([{ href: 'https://app.test/reset/xyz123', text: 'https://app.test/reset/xyz123' }]);
  });

  it('keeps HTML anchors ahead of text URLs and dedupes across bodies', () => {
    const links = extractLinksFromContent(
      'Confirm: https://app.test/confirm?token=abc&user=42',
      '<a href="https://app.test/confirm?token=abc&amp;user=42">Confirm</a>',
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.text).toBe('Confirm');
  });
});
