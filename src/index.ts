export { test, type EmailTestFixtures, type EmailWorkerFixtures, type NewInboxOptions } from './fixtures';
export { expect } from './matchers';
export { totp, type TotpOptions } from './totp';
export { Inbox } from './inbox';
export {
  Email,
  extractLinksFromContent,
  extractOtpFromContent,
  type EmailAttachment,
  type EmailLink,
  type ExtractLinkFilter,
  type ExtractOtpOptions,
} from './email';
export {
  MailpitClient,
  type AttachmentMeta,
  type MailpitAddress,
  type MessageDetail,
  type MessageSummary,
} from './server/api';
export { startMailpit, type MailpitHandle } from './server/process';
export { startProviderMock, type ProviderMockHandle } from './server/provider-mock';
export { DEFAULT_MAILPIT_VERSION, ensureMailpit } from './server/binary';
export type {
  EmailFilter,
  EmailOptions,
  EmailServerOptions,
  WaitForEmailOptions,
  WaitForEmailsOptions,
} from './types';
