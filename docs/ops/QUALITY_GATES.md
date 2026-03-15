# Quality Gates

This project uses layered verification so regressions are caught early and the release path stays reproducible.

## Local / CI gates

Run all deterministic local gates:

```bash
./ops/verify_local.sh
```

This executes:

1. `npm run lint`
2. `npm run test:coverage:check`
3. `npm run test:e2e:simulator`
4. `npm run test:e2e:mobile`
5. `npm run test:e2e:i18n`
6. `npm run test:e2e:multiplayer:sim`

Coverage thresholds:

- statements: `85%`
- lines: `85%`
- functions: `85%`
- branches: `75%`

These thresholds apply to the instrumented Node-side helper modules that protect data flow, origin policy, IP trust, request budgeting, and relay auth behavior.

Frontend/browser coverage follows common practice through behavior-oriented E2E checks instead of forcing synthetic line coverage on static browser files:

- simulator editor behavior
- mobile toolbar behavior
- i18n and legal-page rendering
- multiplayer convergence

CI also adds supply-chain gates:

- dependency review on pull requests
- `npm audit --omit=dev --audit-level=high` for root, `services/api/`, and `services/collab-relay/`

## Live gates

Run production-facing checks separately:

```bash
./ops/verify_live.sh
```

This uses a temporary Firebase App Check debug token and executes:

1. live smoke test
2. live multiplayer test

Do not run live gates in untrusted environments.

## Why the split matters

- `ops/verify_local.sh` stays deterministic and OSS/CI friendly.
- `ops/verify_live.sh` validates the real deployed stack without weakening App Check.
- Browser E2Es test UI, simulator, and collaboration behavior without relying on production services.

## When a change is not merge-ready

Treat a change as not ready if any of the following is true:

- lint is red
- coverage thresholds are not met
- simulator or multiplayer E2Es fail
- live checks fail after a deploy candidate
- privacy/security docs are outdated relative to the running stack
