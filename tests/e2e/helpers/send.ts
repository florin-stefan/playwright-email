import nodemailer from 'nodemailer';

export interface SendOptions {
  host: string;
  port: number;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}

/** Send an email through the test SMTP server, simulating the app under test. */
export async function sendTestEmail(options: SendOptions): Promise<void> {
  const transport = nodemailer.createTransport({
    host: options.host,
    port: options.port,
    secure: false,
    tls: { rejectUnauthorized: false },
  });
  try {
    await transport.sendMail({
      from: options.from ?? 'noreply@app.test',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  } finally {
    transport.close();
  }
}
