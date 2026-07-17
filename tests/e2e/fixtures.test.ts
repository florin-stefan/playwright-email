import { expect, test } from '../../src/index';
import { sendTestEmail } from './helpers/send';

test.describe('inbox fixture', () => {
  test('waitForEmail resolves for an email sent to the inbox address', async ({ inbox, mailServer }) => {
    await sendTestEmail({
      host: mailServer.smtpHost,
      port: mailServer.smtpPort,
      to: inbox.address,
      subject: 'Verify your account',
      text: 'Your verification code is 482913. https://app.test/verify?token=zzz',
    });

    const email = await inbox.waitForEmail({ subject: /verify/i });
    expect(email.subject).toBe('Verify your account');
    expect(email.from).toBe('noreply@app.test');
    expect(email.to).toContain(inbox.address);
    expect(email.extractOtp()).toBe('482913');
    expect(email.extractLink({ href: /token=/ })).toBe('https://app.test/verify?token=zzz');
  });

  test('waitForEmail matches emails that arrive after the wait starts', async ({ inbox, mailServer }) => {
    const waiting = inbox.waitForEmail({ subject: 'Delayed hello' });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sendTestEmail({
      host: mailServer.smtpHost,
      port: mailServer.smtpPort,
      to: inbox.address,
      subject: 'Delayed hello',
      text: 'Better late than never',
    });
    const email = await waiting;
    expect(email.text).toContain('Better late');
  });

  test('body filter and HTML links work end-to-end', async ({ inbox, mailServer }) => {
    await sendTestEmail({
      host: mailServer.smtpHost,
      port: mailServer.smtpPort,
      to: inbox.address,
      subject: 'Reset your password',
      html: '<p>Hello!</p><p><a href="https://app.test/reset?code=abc&amp;id=7">Reset password</a></p>',
    });

    const email = await inbox.waitForEmail({ body: /reset\?code=/i });
    expect(email.extractLink({ text: 'Reset password' })).toBe('https://app.test/reset?code=abc&id=7');
  });

  test('inboxes are isolated from each other', async ({ inbox, newInbox, mailServer }) => {
    const other = newInbox();
    expect(other.address).not.toBe(inbox.address);

    await sendTestEmail({
      host: mailServer.smtpHost,
      port: mailServer.smtpPort,
      to: other.address,
      subject: 'For the other inbox only',
    });

    await expect(other).toReceiveEmail({ subject: 'For the other inbox only' });
    await expect(inbox).not.toReceiveEmail({}, { timeout: 1500 });
  });

  test('toReceiveEmail matcher passes and clear() empties the inbox', async ({ inbox, mailServer }) => {
    await sendTestEmail({
      host: mailServer.smtpHost,
      port: mailServer.smtpPort,
      to: inbox.address,
      subject: 'Welcome!',
      text: 'Glad to have you',
    });
    await expect(inbox).toReceiveEmail({ subject: 'Welcome!' });

    await inbox.clear();
    expect(await inbox.emails()).toHaveLength(0);
  });

  test('timeout error is descriptive and lists received emails', async ({ inbox, mailServer }) => {
    await sendTestEmail({
      host: mailServer.smtpHost,
      port: mailServer.smtpPort,
      to: inbox.address,
      subject: 'Newsletter #42',
    });

    await expect(inbox.waitForEmail({ subject: 'Does not exist' }, { timeout: 1500 })).rejects.toThrow(
      /timed out after 1500ms[\s\S]*Newsletter #42/,
    );
  });

  test('emails() returns matching emails newest first', async ({ inbox, mailServer }) => {
    for (const subject of ['first', 'second']) {
      await sendTestEmail({
        host: mailServer.smtpHost,
        port: mailServer.smtpPort,
        to: inbox.address,
        subject,
      });
      await inbox.waitForEmail({ subject });
    }
    const all = await inbox.emails();
    expect(all.map((e) => e.subject)).toEqual(['second', 'first']);
  });
});
