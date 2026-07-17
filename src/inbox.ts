import { Email } from './email';
import type { MailpitClient, MessageSummary } from './server/api';
import type { EmailFilter, WaitForEmailOptions, WaitForEmailsOptions } from './types';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matches(value: string, cond: string | RegExp): boolean {
  return typeof cond === 'string' ? value.includes(cond) : cond.test(value);
}

export function describeFilter(filter: EmailFilter): string {
  const parts: string[] = [];
  if (filter.to) parts.push(`to: "${filter.to}"`);
  if (filter.from) parts.push(`from: "${filter.from}"`);
  if (filter.subject !== undefined) parts.push(`subject: ${filter.subject}`);
  if (filter.body !== undefined) parts.push(`body: ${filter.body}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '(any email)';
}

/** A unique test mailbox backed by a Mailpit catch-all server. */
export class Inbox {
  constructor(
    /** The unique address for this inbox — use it in signup forms etc. */
    readonly address: string,
    private readonly client: MailpitClient,
    private readonly defaults: { waitTimeout: number; pollInterval: number },
  ) {}

  private summaryMatches(s: MessageSummary, filter: EmailFilter): boolean {
    if (filter.from && s.From?.Address.toLowerCase() !== filter.from.toLowerCase()) return false;
    if (filter.subject !== undefined && !matches(s.Subject, filter.subject)) return false;
    return true;
  }

  private async fetchIfMatches(s: MessageSummary, filter: EmailFilter): Promise<Email | undefined> {
    const detail = await this.client.getMessage(s.ID);
    const email = new Email(detail, this.client);
    if (filter.body !== undefined && !matches(detail.Text, filter.body) && !matches(detail.HTML, filter.body)) {
      return undefined;
    }
    return email;
  }

  /**
   * Wait until an email matching the filter arrives (or already exists) in
   * this inbox, polling the server. Resolves to the newest matching email.
   */
  async waitForEmail(filter: EmailFilter = {}, options: WaitForEmailOptions = {}): Promise<Email> {
    const [email] = await this.waitForEmails(filter, { ...options, count: 1 });
    return email!;
  }

  /**
   * Wait until at least `count` emails matching the filter exist in this
   * inbox (default 1). Resolves with the matches, newest first — useful for
   * resend flows, digests, and bulk sends.
   */
  async waitForEmails(filter: EmailFilter = {}, options: WaitForEmailsOptions = {}): Promise<Email[]> {
    const count = options.count ?? 1;
    const to = filter.to ?? this.address;
    const query = `to:"${to}"`;
    const timeout = options.timeout ?? this.defaults.waitTimeout;
    const deadline = Date.now() + timeout;
    const rejected = new Set<string>();
    const matched = new Map<string, Email>();

    for (;;) {
      const summaries = await this.client.search(query);
      for (const s of summaries) {
        if (rejected.has(s.ID) || matched.has(s.ID)) continue;
        if (!this.summaryMatches(s, filter)) {
          rejected.add(s.ID);
          continue;
        }
        const email = await this.fetchIfMatches(s, filter);
        if (email) matched.set(s.ID, email);
        else rejected.add(s.ID);
      }

      if (matched.size >= count) {
        // Newest first, following the server's summary ordering.
        const ordered: Email[] = [];
        for (const s of summaries) {
          const email = matched.get(s.ID);
          if (email) ordered.push(email);
        }
        return ordered;
      }

      if (Date.now() >= deadline) {
        const received = summaries
          .slice(0, 10)
          .map((s) => `  "${s.Subject}" (from ${s.From?.Address ?? 'unknown'})`)
          .join('\n');
        const wanted = count > 1 ? `${count} emails` : 'email';
        const progress = count > 1 ? ` Matched ${matched.size} of ${count}.` : '';
        throw new Error(
          `playwright-email: timed out after ${timeout}ms waiting for ${wanted} to "${to}" matching ${describeFilter(filter)}.${progress}\n` +
            (summaries.length
              ? `The inbox received ${summaries.length} email(s):\n${received}`
              : 'The inbox received no emails. Is the app configured to send SMTP to the test server?'),
        );
      }
      await delay(this.defaults.pollInterval);
    }
  }

  /** All emails currently in this inbox that match the filter, newest first. */
  async emails(filter: EmailFilter = {}): Promise<Email[]> {
    const to = filter.to ?? this.address;
    const summaries = await this.client.search(`to:"${to}"`);
    const out: Email[] = [];
    for (const s of summaries) {
      if (!this.summaryMatches(s, filter)) continue;
      const email = await this.fetchIfMatches(s, filter);
      if (email) out.push(email);
    }
    return out;
  }

  /** Delete every message addressed to this inbox. */
  async clear(): Promise<void> {
    await this.client.deleteBySearch(`to:"${this.address}"`);
  }
}
