import { expect, mergeTests, test as base } from '@playwright/test';
import { test as emailTest } from '../../src/index';
import { sendTestEmail } from './helpers/send';

// Teams almost always have their own extended `test`. Prove the email
// fixtures compose with it via mergeTests instead of forcing a rebase.
const userTest = base.extend<{ greeting: string }>({
  greeting: async ({}, use) => {
    await use('hello from my fixtures');
  },
});

const test = mergeTests(userTest, emailTest);

test('mergeTests combines user fixtures with the email fixtures', async ({ greeting, inbox, mailServer }) => {
  expect(greeting).toBe('hello from my fixtures');

  await sendTestEmail({
    host: mailServer.smtpHost,
    port: mailServer.smtpPort,
    to: inbox.address,
    subject: 'merged world',
  });
  const email = await inbox.waitForEmail({ subject: 'merged world' });
  expect(email.subject).toBe('merged world');
});
