import { expect as baseExpect } from '@playwright/test';
import type { Email } from './email';
import { describeFilter, type Inbox } from './inbox';
import type { EmailFilter, WaitForEmailOptions } from './types';

export const expect = baseExpect.extend({
  /**
   * Polling assertion that the inbox receives an email matching the filter.
   * Supports negation: `await expect(inbox).not.toReceiveEmail(...)` waits the
   * full timeout and passes only if no matching email arrives (use a short
   * explicit timeout for that case).
   */
  async toReceiveEmail(inbox: Inbox, filter: EmailFilter = {}, options: WaitForEmailOptions = {}) {
    let email: Email | undefined;
    let error: unknown;
    try {
      email = await inbox.waitForEmail(filter, options);
    } catch (e) {
      error = e;
    }
    return {
      name: 'toReceiveEmail',
      pass: email !== undefined,
      message: () =>
        email !== undefined
          ? `Expected inbox ${inbox.address} NOT to receive an email matching ${describeFilter(filter)}, but received "${email.subject}"`
          : String(error instanceof Error ? error.message : error),
    };
  },
});
