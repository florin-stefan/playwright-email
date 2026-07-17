import { expect, test } from '../../src/index';

// Opt into the provider mock for this worker.
test.use({ mailServerOptions: { providerMock: true } });

test.describe('provider mock', () => {
  test('SendGrid v3 payload lands in the inbox', async ({ inbox, mailServer }) => {
    const res = await fetch(`${mailServer.providerMock!.url}/v3/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer SG.fake-key' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: inbox.address }] }],
        from: { email: 'app@demo.test', name: 'Demo App' },
        subject: 'SendGrid hello',
        content: [{ type: 'text/plain', value: 'Your verification code is 445566.' }],
      }),
    });
    expect(res.status).toBe(202);
    expect(res.headers.get('x-message-id')).toBeTruthy();

    const email = await inbox.waitForEmail({ subject: 'SendGrid hello' });
    expect(email.from).toBe('app@demo.test');
    expect(email.extractOtp()).toBe('445566');
  });

  test('Resend payload with display-name from and HTML body', async ({ inbox, mailServer }) => {
    const res = await fetch(`${mailServer.providerMock!.url}/emails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer re_fake' },
      body: JSON.stringify({
        from: 'Demo App <app@demo.test>',
        to: inbox.address,
        subject: 'Resend magic link',
        html: '<p><a href="https://app.test/magic?t=abc&amp;u=1">Sign in</a></p>',
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBeTruthy();

    const email = await inbox.waitForEmail({ subject: 'Resend magic link' });
    expect(email.extractLink({ text: 'Sign in' })).toBe('https://app.test/magic?t=abc&u=1');
  });

  test('Postmark payload with comma-separated recipients', async ({ inbox, newInbox, mailServer }) => {
    const second = newInbox();
    const res = await fetch(`${mailServer.providerMock!.url}/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Postmark-Server-Token': 'fake' },
      body: JSON.stringify({
        From: 'app@demo.test',
        To: `${inbox.address}, ${second.address}`,
        Subject: 'Postmark broadcast',
        HtmlBody: '<p>Hello both!</p>',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { MessageID: string; ErrorCode: number };
    expect(body.ErrorCode).toBe(0);
    expect(body.MessageID).toBeTruthy();

    await expect(inbox).toReceiveEmail({ subject: 'Postmark broadcast' });
    await expect(second).toReceiveEmail({ subject: 'Postmark broadcast' });
  });

  test('unknown endpoints return 404 with the supported list', async ({ mailServer }) => {
    const res = await fetch(`${mailServer.providerMock!.url}/v2/whatever`, { method: 'POST' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { supported: Record<string, string> };
    expect(body.supported.sendgrid).toContain('/v3/mail/send');
  });
});
