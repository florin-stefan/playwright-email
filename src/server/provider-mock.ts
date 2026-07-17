import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * A tiny HTTP server that impersonates the send endpoints of popular
 * transactional-email providers and injects the messages into Mailpit.
 *
 * Modern apps often send email through a provider's REST API instead of
 * SMTP — for those apps an SMTP catcher alone never sees any mail. Point the
 * SDK's base URL at this mock and every "sent" email lands in the test
 * server, ready for `inbox.waitForEmail()`:
 *
 *   SendGrid  POST /v3/mail/send   -> 202 + X-Message-Id
 *   Resend    POST /emails         -> 200 { id }
 *   Postmark  POST /email          -> 200 { MessageID, ErrorCode: 0, ... }
 *
 * Authorization headers are accepted but not validated.
 */
export interface ProviderMockHandle {
  url: string;
  port: number;
  stop(): Promise<void>;
}

interface Address {
  Email: string;
  Name: string;
}

interface MailpitSendRequest {
  From: Address;
  To: Address[];
  Cc?: Address[];
  Bcc?: string[];
  Subject: string;
  HTML?: string;
  Text?: string;
  ReplyTo?: Address[];
}

/** Parse 'Name <a@b>' or plain 'a@b' into a Mailpit address. */
function parseAddress(value: string): Address {
  const match = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(value);
  if (match) return { Email: match[2]!.trim(), Name: (match[1] ?? '').trim() };
  return { Email: value.trim(), Name: '' };
}

function toList(value: string | string[] | undefined): Address[] {
  if (!value) return [];
  const items = Array.isArray(value) ? value : value.split(',');
  return items.map((v) => parseAddress(v)).filter((a) => a.Email);
}

// --- per-provider payload translators ---------------------------------------

interface SendGridPayload {
  personalizations?: Array<{
    to?: Array<{ email: string; name?: string }>;
    cc?: Array<{ email: string; name?: string }>;
    bcc?: Array<{ email: string; name?: string }>;
    subject?: string;
  }>;
  from?: { email: string; name?: string };
  reply_to?: { email: string; name?: string };
  subject?: string;
  content?: Array<{ type: string; value: string }>;
}

function fromSendGrid(body: SendGridPayload): MailpitSendRequest {
  const p = body.personalizations ?? [];
  const objAddr = (a: { email: string; name?: string }): Address => ({ Email: a.email, Name: a.name ?? '' });
  return {
    From: body.from ? objAddr(body.from) : { Email: 'unknown@sendgrid.mock', Name: '' },
    To: p.flatMap((x) => (x.to ?? []).map(objAddr)),
    Cc: p.flatMap((x) => (x.cc ?? []).map(objAddr)),
    Bcc: p.flatMap((x) => (x.bcc ?? []).map((a) => a.email)),
    Subject: p[0]?.subject ?? body.subject ?? '',
    HTML: body.content?.find((c) => c.type === 'text/html')?.value,
    Text: body.content?.find((c) => c.type === 'text/plain')?.value,
    ReplyTo: body.reply_to ? [objAddr(body.reply_to)] : undefined,
  };
}

interface ResendPayload {
  from?: string;
  to?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string | string[];
  subject?: string;
  html?: string;
  text?: string;
}

function fromResend(body: ResendPayload): MailpitSendRequest {
  return {
    From: parseAddress(body.from ?? 'unknown@resend.mock'),
    To: toList(body.to),
    Cc: toList(body.cc),
    Bcc: toList(body.bcc).map((a) => a.Email),
    Subject: body.subject ?? '',
    HTML: body.html,
    Text: body.text,
    ReplyTo: body.reply_to ? toList(body.reply_to) : undefined,
  };
}

interface PostmarkPayload {
  From?: string;
  To?: string;
  Cc?: string;
  Bcc?: string;
  ReplyTo?: string;
  Subject?: string;
  HtmlBody?: string;
  TextBody?: string;
}

function fromPostmark(body: PostmarkPayload): MailpitSendRequest {
  return {
    From: parseAddress(body.From ?? 'unknown@postmark.mock'),
    To: toList(body.To),
    Cc: toList(body.Cc),
    Bcc: toList(body.Bcc).map((a) => a.Email),
    Subject: body.Subject ?? '',
    HTML: body.HtmlBody,
    Text: body.TextBody,
    ReplyTo: body.ReplyTo ? toList(body.ReplyTo) : undefined,
  };
}

// -----------------------------------------------------------------------------

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function inject(mailpitUrl: string, mail: MailpitSendRequest): Promise<string> {
  if (mail.To.length === 0) throw new Error('no recipients in payload');
  const res = await fetch(`${mailpitUrl}/api/v1/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mail),
  });
  if (!res.ok) {
    throw new Error(`Mailpit rejected the message (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { ID?: string };
  return data.ID ?? 'unknown';
}

const INFO = {
  service: 'playwright-email provider mock',
  endpoints: {
    sendgrid: 'POST /v3/mail/send',
    resend: 'POST /emails',
    postmark: 'POST /email',
  },
};

export async function startProviderMock(
  mailpitUrl: string,
  opts: { port?: number } = {},
): Promise<ProviderMockHandle> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };

    try {
      const route = `${req.method} ${new URL(req.url ?? '/', 'http://localhost').pathname}`;

      if (route === 'GET /') return json(200, INFO);

      if (route === 'POST /v3/mail/send') {
        const id = await inject(mailpitUrl, fromSendGrid((await readJson(req)) as SendGridPayload));
        res.writeHead(202, { 'X-Message-Id': id });
        return res.end();
      }

      if (route === 'POST /emails') {
        const id = await inject(mailpitUrl, fromResend((await readJson(req)) as ResendPayload));
        return json(200, { id });
      }

      if (route === 'POST /email') {
        const body = (await readJson(req)) as PostmarkPayload;
        const id = await inject(mailpitUrl, fromPostmark(body));
        return json(200, {
          To: body.To ?? '',
          SubmittedAt: new Date().toISOString(),
          MessageID: id,
          ErrorCode: 0,
          Message: 'OK',
        });
      }

      return json(404, {
        error: `playwright-email provider mock: unsupported endpoint "${route}"`,
        supported: INFO.endpoints,
      });
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });

  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
