// Real projects import from 'playwright-email' instead of '../../src/index'.
import { expect, test } from '../../src/index';

test('user signs up and verifies their email with the OTP', async ({ page, inbox }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(inbox.address);
  await page.getByRole('button', { name: 'Sign up' }).click();

  const email = await inbox.waitForEmail({ subject: /your code/i });
  const code = email.extractOtp();

  await page.getByLabel('Verification code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByRole('heading', { name: /welcome aboard/i })).toBeVisible();
});

test('wrong code is rejected, right code still works', async ({ page, inbox }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill(inbox.address);
  await page.getByRole('button', { name: 'Sign up' }).click();

  await page.getByLabel('Verification code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code is not valid.')).toBeVisible();

  const email = await inbox.waitForEmail({ subject: /your code/i });
  await page.getByLabel('Verification code').fill(email.extractOtp());
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /welcome aboard/i })).toBeVisible();
});
