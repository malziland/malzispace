# Contributing

Thanks for contributing to malziSPACE.

## Ground Rules

- Keep changes small and reviewable.
- Do not weaken end-to-end encryption, App Check, origin policy, or abuse protections without explicit discussion.
- Update tests and docs in the same change.
- Avoid new global state and avoid growing existing god-files further.

## Local Setup

Prerequisites:

- Node.js 24
- Firebase CLI
- gcloud CLI for live verification and relay deploys

Install dependencies from repo root:

```bash
npm ci
cd services/api && npm ci
cd ../collab-relay && npm ci
```

## Required Before Opening a PR

Run the full local gate:

```bash
./ops/verify_local.sh
```

If your change affects production behavior, also run:

```bash
./ops/verify_live.sh
```

## Change Rules

- Add or update docs when changing product behavior, security posture, or operational steps.
- Any new visible UI string must go through the i18n layer.
- Any new write path must define auth, rate limits, byte budget, cleanup, and tests.
- Any new feature flag must be documented in `README.md` and handled safely in both states.

## Pull Request Expectations

A good PR includes:

- problem statement
- scope boundaries
- test evidence
- rollout or migration notes
- follow-up cleanup if any flag or transitional code remains

## Security Reports

Do not open public issues for sensitive vulnerabilities. Use the process in `SECURITY.md`.
