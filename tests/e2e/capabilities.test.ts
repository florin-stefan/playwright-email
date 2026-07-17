import { expect, test } from '../../src/index';
import { sendTestEmail } from './helpers/send';

test('waitForEmails resolves once the requested count has arrived', async ({ inbox, mailServer }) => {
  const send = (subject: string) =>
    sendTestEmail({ host: mailServer.smtpHost, port: mailServer.smtpPort, to: inbox.address, subject, text: 'reminder' });

  await send('Reminder 1');
  const waiting = inbox.waitForEmails({ subject: /reminder/i }, { count: 2 });
  await new Promise((r) => setTimeout(r, 400));
  await send('Reminder 2');

  const emails = await waiting;
  expect(emails.map((e) => e.subject)).toEqual(['Reminder 2', 'Reminder 1']);
});

test('waitForEmails timeout reports match progress', async ({ inbox, mailServer }) => {
  await sendTestEmail({
    host: mailServer.smtpHost,
    port: mailServer.smtpPort,
    to: inbox.address,
    subject: 'Only one',
  });
  await expect(inbox.waitForEmails({ subject: 'Only one' }, { count: 3, timeout: 1500 })).rejects.toThrow(
    /Matched 1 of 3/,
  );
});

test('newInbox({ prefix }) produces readable sanitized addresses', async ({ newInbox }) => {
  const buyer = newInbox({ prefix: 'Buyer Persona!' });
  expect(buyer.address).toMatch(/^buyer-persona-\d+-[0-9a-f]{8}@example\.test$/);
});

test('email.open(page) renders the HTML template in the browser', async ({ page, inbox, mailServer }) => {
  await sendTestEmail({
    host: mailServer.smtpHost,
    port: mailServer.smtpPort,
    to: inbox.address,
    subject: 'Order confirmation',
    html: '<h1>Order confirmed</h1><p>Thanks for shopping with us!</p>',
  });
  const email = await inbox.waitForEmail({ subject: 'Order confirmation' });
  await email.open(page);
  await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
});

test('email.raw() returns the RFC 822 source', async ({ inbox, mailServer }) => {
  await sendTestEmail({
    host: mailServer.smtpHost,
    port: mailServer.smtpPort,
    to: inbox.address,
    subject: 'Raw source',
    text: 'plain body',
  });
  const email = await inbox.waitForEmail({ subject: 'Raw source' });
  const raw = await email.raw();
  expect(raw).toContain('Subject: Raw source');
  expect(raw).toContain(`To: ${inbox.address}`);
});
