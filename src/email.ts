import type { Page } from '@playwright/test';
import type { AttachmentMeta, MailpitClient, MessageDetail } from './server/api';

export interface EmailAttachment {
  fileName: string;
  contentType: string;
  size: number;
  download(): Promise<Buffer>;
}

export interface ExtractOtpOptions {
  /** Exact number of digits the code must have (default: any 4–8). */
  length?: number;
}

export interface ExtractLinkFilter {
  /** Match the link's visible text (anchor content). */
  text?: string | RegExp;
  /** Match the link's URL. */
  href?: string | RegExp;
}

export interface EmailLink {
  href: string;
  text: string;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  );
}

const OTP_KEYWORDS =
  /\b(code|codes|otp|one[\s-]?time|verif\w*|passcode|pin|2fa|mfa|two[\s-]?factor|security|token|auth\w*)\b/gi;

// Only hyphenated forms can look like OTP candidates, and only when a
// plausible 4-digit year anchors one end (2026-07-17, 17-07-2026).
// Freeform groups like 44-55-66 are a legitimate OTP format.
const DATE_LIKE = /^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$|^\d{1,2}-\d{1,2}-(?:19|20)\d{2}$/;

interface OtpCandidate {
  code: string;
  index: number;
  raw: string;
}

function findOtpCandidates(content: string, exactLength?: number): OtpCandidate[] {
  // Digit runs, optionally separated by single spaces or hyphens ("123 456").
  // The lookarounds reject runs extendable by another digit in either
  // direction (phone numbers, decimals), while allowing sentence punctuation.
  const re = /(?<!\d[ .,-]?)\d(?:[ -]?\d){3,7}(?![ .,-]?\d)/g;
  const out: OtpCandidate[] = [];
  for (const m of content.matchAll(re)) {
    const raw = m[0];
    if (DATE_LIKE.test(raw)) continue;
    const code = raw.replace(/[ -]/g, '');
    if (code.length < 4 || code.length > 8) continue;
    if (exactLength && code.length !== exactLength) continue;
    out.push({ code, index: m.index ?? 0, raw });
  }
  return out;
}

/** Pure helper so the heuristic is unit-testable without a Mailpit message. */
export function extractOtpFromContent(text: string, html: string, options: ExtractOtpOptions = {}): string {
  let content = text.trim() ? text : stripTags(html);
  // Digits inside URLs (tracking links, ports) are never the OTP.
  content = content.replace(/https?:\/\/[^\s<>"'\])]+/g, ' ');
  // Collapse whitespace so codes split across lines/extra spaces ("905  414",
  // one digit group per line in rendered HTML) form a single run.
  content = content.replace(/\s+/g, ' ');

  const candidates = findOtpCandidates(content, options.length);
  if (candidates.length === 0) {
    throw new Error(
      `playwright-email: no OTP code${options.length ? ` of length ${options.length}` : ''} found in email body.`,
    );
  }
  if (candidates.length === 1) return candidates[0]!.code;

  // Several digit runs — rank by proximity to a keyword like "code" or "verification".
  const keywordPositions: number[] = [];
  for (const m of content.matchAll(OTP_KEYWORDS)) {
    keywordPositions.push((m.index ?? 0) + m[0].length);
  }
  if (keywordPositions.length > 0) {
    const distance = (c: OtpCandidate) => Math.min(...keywordPositions.map((k) => Math.abs(c.index - k)));
    candidates.sort((a, b) => {
      const d = distance(a) - distance(b);
      if (d !== 0) return d;
      if ((a.code.length === 6) !== (b.code.length === 6)) return a.code.length === 6 ? -1 : 1;
      return a.index - b.index;
    });
    return candidates[0]!.code;
  }

  const sixDigit = candidates.filter((c) => c.code.length === 6);
  if (sixDigit.length === 1) return sixDigit[0]!.code;

  throw new Error(
    `playwright-email: ambiguous OTP — found ${candidates.length} digit sequences (${candidates
      .map((c) => c.code)
      .join(', ')}) and no nearby keyword. Pass { length } or include distinctive text in the email.`,
  );
}

/** Pure helper so link extraction is unit-testable without a Mailpit message. */
export function extractLinksFromContent(text: string, html: string): EmailLink[] {
  const links: EmailLink[] = [];
  const seen = new Set<string>();

  const anchorRe = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const href = decodeEntities(m[1] ?? m[2] ?? '').trim();
    if (!href || href.startsWith('#')) continue;
    const label = stripTags(m[3] ?? '').replace(/\s+/g, ' ').trim();
    if (!seen.has(href)) {
      seen.add(href);
      links.push({ href, text: label });
    }
  }

  const bareUrlRe = /https?:\/\/[^\s<>"'\])]+/g;
  for (const m of text.matchAll(bareUrlRe)) {
    const href = m[0].replace(/[.,;:!?]+$/, '');
    if (!seen.has(href)) {
      seen.add(href);
      links.push({ href, text: href });
    }
  }

  return links;
}

function matches(value: string, cond: string | RegExp): boolean {
  return typeof cond === 'string' ? value.includes(cond) : cond.test(value);
}

/** A received email with typed accessors and extraction helpers. */
export class Email {
  constructor(
    private readonly detail: MessageDetail,
    private readonly client: MailpitClient,
  ) {}

  get id(): string {
    return this.detail.ID;
  }

  get subject(): string {
    return this.detail.Subject;
  }

  /** Sender address, e.g. 'noreply@app.test'. */
  get from(): string {
    return this.detail.From?.Address ?? '';
  }

  /** Recipient addresses. */
  get to(): string[] {
    return (this.detail.To ?? []).map((a) => a.Address);
  }

  get cc(): string[] {
    return (this.detail.Cc ?? []).map((a) => a.Address);
  }

  get date(): Date {
    return new Date(this.detail.Date);
  }

  /** HTML body ('' when the email is plain-text only). */
  get html(): string {
    return this.detail.HTML ?? '';
  }

  /** Plain-text body ('' when the email is HTML only). */
  get text(): string {
    return this.detail.Text ?? '';
  }

  get attachments(): EmailAttachment[] {
    const metas: AttachmentMeta[] = this.detail.Attachments ?? [];
    return metas.map((a) => ({
      fileName: a.FileName,
      contentType: a.ContentType,
      size: a.Size,
      download: () => this.client.getAttachment(this.detail.ID, a.PartID),
    }));
  }

  /**
   * Render this email's body in a Playwright page — screenshot it, run axe
   * against it, or assert on the rendered template like any other page.
   * Plain-text emails are rendered in a <pre> block.
   */
  async open(page: Page): Promise<void> {
    const html =
      this.html ||
      `<!doctype html><meta charset="utf-8"><pre style="font-family: ui-monospace, monospace; white-space: pre-wrap; padding: 1rem">${escapeHtml(this.text)}</pre>`;
    // 'load' can hang on remote images; the markup itself is what we test.
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
  }

  /** The raw RFC 822 source (.eml content) — open it in a real mail client. */
  raw(): Promise<string> {
    return this.client.getRaw(this.detail.ID);
  }

  /**
   * Extract a one-time code (4–8 digits) from the email body.
   * Prefers digit sequences near words like "code" or "verification".
   * Throws a descriptive error when no unambiguous code is found.
   */
  extractOtp(options: ExtractOtpOptions = {}): string {
    return extractOtpFromContent(this.text, this.html, options);
  }

  /** All links: HTML anchors first (with their visible text), then bare URLs from the text body. */
  extractLinks(): EmailLink[] {
    return extractLinksFromContent(this.text, this.html);
  }

  /**
   * Extract the first link matching the filter (by visible text and/or URL).
   * Throws with the list of available links when nothing matches.
   */
  extractLink(filter: ExtractLinkFilter = {}): string {
    const links = this.extractLinks();
    const found = links.find(
      (l) =>
        (filter.text === undefined || matches(l.text, filter.text)) &&
        (filter.href === undefined || matches(l.href, filter.href)),
    );
    if (!found) {
      const available = links.length
        ? links.map((l) => `  "${l.text}" -> ${l.href}`).join('\n')
        : '  (no links found in email)';
      throw new Error(
        `playwright-email: no link matching ${describeLinkFilter(filter)} in email "${this.subject}". Available links:\n${available}`,
      );
    }
    return found.href;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function describeLinkFilter(filter: ExtractLinkFilter): string {
  const parts: string[] = [];
  if (filter.text !== undefined) parts.push(`text: ${filter.text}`);
  if (filter.href !== undefined) parts.push(`href: ${filter.href}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}
