/** Typed client for the subset of the Mailpit REST API this package uses. */

export interface MailpitAddress {
  Name: string;
  Address: string;
}

export interface MessageSummary {
  ID: string;
  MessageID: string;
  Read: boolean;
  From: MailpitAddress | null;
  To: MailpitAddress[];
  Cc: MailpitAddress[] | null;
  Bcc: MailpitAddress[] | null;
  Subject: string;
  Created: string;
  Size: number;
  Attachments: number;
  Snippet: string;
}

export interface AttachmentMeta {
  PartID: string;
  FileName: string;
  ContentType: string;
  ContentID: string;
  Size: number;
}

export interface MessageDetail {
  ID: string;
  MessageID: string;
  From: MailpitAddress | null;
  To: MailpitAddress[];
  Cc: MailpitAddress[] | null;
  Bcc: MailpitAddress[] | null;
  ReplyTo: MailpitAddress[] | null;
  Subject: string;
  Date: string;
  Text: string;
  HTML: string;
  Size: number;
  Attachments: AttachmentMeta[] | null;
  Inline: AttachmentMeta[] | null;
}

interface SearchResponse {
  total: number;
  count: number;
  messages: MessageSummary[];
}

export class MailpitClient {
  constructor(readonly baseUrl: string) {}

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`playwright-email: Mailpit API ${init?.method ?? 'GET'} ${path} failed (HTTP ${res.status}): ${body}`);
    }
    return res;
  }

  async info(): Promise<{ Version: string }> {
    const res = await this.request('/api/v1/info');
    return (await res.json()) as { Version: string };
  }

  /** Search messages using Mailpit query syntax (e.g. `to:"a@b.test"`), newest first. */
  async search(query: string, limit = 200): Promise<MessageSummary[]> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const res = await this.request(`/api/v1/search?${params}`);
    const data = (await res.json()) as SearchResponse;
    return data.messages ?? [];
  }

  /** List messages, newest first. */
  async listMessages(limit = 200): Promise<MessageSummary[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    const res = await this.request(`/api/v1/messages?${params}`);
    const data = (await res.json()) as SearchResponse;
    return data.messages ?? [];
  }

  async getMessage(id: string): Promise<MessageDetail> {
    const res = await this.request(`/api/v1/message/${encodeURIComponent(id)}`);
    return (await res.json()) as MessageDetail;
  }

  /** The full raw RFC 822 message source (.eml content). */
  async getRaw(id: string): Promise<string> {
    const res = await this.request(`/api/v1/message/${encodeURIComponent(id)}/raw`);
    return res.text();
  }

  /** Raw bytes of an attachment part. */
  async getAttachment(messageId: string, partId: string): Promise<Buffer> {
    const res = await this.request(
      `/api/v1/message/${encodeURIComponent(messageId)}/part/${encodeURIComponent(partId)}`,
    );
    return Buffer.from(await res.arrayBuffer());
  }

  /** Delete every message matching a Mailpit search query. */
  async deleteBySearch(query: string): Promise<void> {
    const params = new URLSearchParams({ query });
    await this.request(`/api/v1/search?${params}`, { method: 'DELETE' });
  }

  /** Delete all messages on the server. */
  async deleteAll(): Promise<void> {
    await this.request('/api/v1/messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ IDs: [] }),
    });
  }
}
