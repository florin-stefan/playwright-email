# Contributing

Thanks for helping make email testing in Playwright painless!

## Development setup

```bash
npm install
npx playwright install chromium   # for the e2e and example tests
```

## Running the checks

```bash
npm run typecheck     # tsc --noEmit
npm run build         # tsup → dist/ (ESM + CJS + d.ts)
npm run test:unit     # vitest: extractors, TOTP, checksums + Mailpit lifecycle integration
npm run test:e2e      # @playwright/test: fixtures, matchers, provider mock, mergeTests
npm run test:example  # browser-driven example app (examples/signup-app)
npm test              # all of the above
```

The integration/e2e tests download the pinned Mailpit release into your cache on first run (~10 MB) and spawn real instances on free ports — no Docker or external services needed.

## Project layout

- `src/server/` — binary download/cache/verification, process lifecycle, REST client, provider mock
- `src/fixtures.ts`, `src/matchers.ts` — the Playwright integration surface
- `src/inbox.ts`, `src/email.ts` — the user-facing objects and extraction heuristics
- `src/global-setup.ts` — shared-server mode for `webServer` apps
- `src/cli.ts` — `playwright-email start|install`
- `examples/signup-app/` — a real app + test kept green in CI; README examples must stay runnable

## Guidelines

- Every feature needs a test at the lowest level that can catch its regression (unit for pure logic, e2e for fixture behavior).
- Error messages are part of the API — when something fails, tell the user what the inbox *did* receive or which links/codes *were* found.
- No new runtime dependencies without a strong reason (`otpauth` is the only one today).
- Keep `README.md` recipes copy-pasteable.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. `npm test` on your platform; CI covers the other two OSes.
3. Commit, tag `vX.Y.Z`, push the tag — `.github/workflows/release.yml` runs the full matrix and publishes to npm with provenance.
