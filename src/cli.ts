#!/usr/bin/env node
import { ensureMailpit } from './server/binary';
import { startMailpit } from './server/process';

const HELP = `playwright-email — manage the test mail server

Usage:
  playwright-email start [options]   Start a persistent Mailpit for live debugging.
                                     Tests configured with the same ports reuse it
                                     automatically instead of spawning their own.
  playwright-email install           Download the Mailpit binary into the local
                                     cache and print its path (for CI images and
                                     Docker layers).

Options for start:
  --smtp <port>             SMTP port the app under test sends to (default 1025)
  --http <port>             HTTP port for the REST API and web UI (default 8025)
  --provider-mock           Also start the SendGrid/Resend/Postmark API mock
  --provider-port <port>    Port for the provider mock (default: --http + 1)

Common options:
  --mailpit-version <tag>   Mailpit release to use (default: pinned version)
  -h, --help                Show this help

Tip: combine with PLAYWRIGHT_EMAIL_KEEP=1 when running tests to keep emails
browsable in the UI after the run finishes.`;

function intFlag(args: string[], name: string): number | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const value = Number(args[i + 1]);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    console.error(`playwright-email: ${name} expects a port number, got "${args[i + 1] ?? ''}"`);
    process.exit(1);
  }
  return value;
}

function stringFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
}

async function commandInstall(args: string[]): Promise<void> {
  const binary = await ensureMailpit({ version: stringFlag(args, '--mailpit-version') });
  console.log(`Mailpit binary ready: ${binary}`);
}

async function commandStart(args: string[]): Promise<void> {
  const httpPort = intFlag(args, '--http') ?? 8025;
  const server = await startMailpit({
    smtpPort: intFlag(args, '--smtp') ?? 1025,
    httpPort,
    version: stringFlag(args, '--mailpit-version'),
    providerMock: args.includes('--provider-mock')
      ? { port: intFlag(args, '--provider-port') ?? httpPort + 1 }
      : undefined,
  });

  if (server.external) {
    console.log(`Reusing the Mailpit already running at ${server.url} — nothing to do.`);
    console.log('(Stop that instance first if you wanted a fresh one.)');
    return;
  }

  console.log('Mailpit is running:');
  console.log(`  Web UI / API : ${server.url}`);
  console.log(`  SMTP         : ${server.smtpHost}:${server.smtpPort}`);
  if (server.providerMock) {
    console.log(`  Provider mock: ${server.providerMock.url}  (SendGrid /v3/mail/send, Resend /emails, Postmark /email)`);
  }
  console.log('');
  console.log('Point your app at the SMTP address, run your tests, watch emails arrive.');
  console.log('Press Ctrl+C to stop.');

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive until a signal arrives.
  await new Promise<never>(() => {});
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (args.includes('-h') || args.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  if (command === 'install') return commandInstall(args.slice(1));
  if (command === 'start') return commandStart(args.slice(1));

  console.log(HELP);
  process.exit(command === undefined ? 0 : 1);
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
