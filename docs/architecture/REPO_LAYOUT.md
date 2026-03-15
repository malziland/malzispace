# Repo Layout

This repository uses a split by responsibility instead of a flat mixed root:

- `apps/`: deployable product frontends
- `services/`: backend/runtime services
- `tests/`: E2E, live and load checks
- `tools/`: repo checks and shared helper binaries
- `ops/`: repeatable local/live operations
- `infra/`: Firebase rules, indexes and deploy-adjacent infrastructure assets
- `docs/`: project, architecture, legal, operations and security documentation

## Current Mapping

- `apps/web/public/`
  static web client for landing, editor and legal pages
- `services/api/`
  Firebase Functions v2 API and schedulers
- `services/collab-relay/`
  Cloud Run WebSocket relay
- `tests/e2e/`
  deterministic browser tests against simulator/local static hosting
- `tests/live/`
  production-facing smoke helpers with temporary App Check debug token flow
- `tests/load/`
  load and CRDT stress helpers
- `tools/bin/`
  shell helpers shared by operational scripts
- `tools/checks/`
  repository hygiene and safety checks
- `ops/`
  `verify_local.sh`, `verify_live.sh`, `clean_local.sh`, `restore_point.sh`
- `infra/firebase/`
  Firestore rules, Firestore indexes and Realtime Database rules

## Intentional Root Files

The following stay at repository root on purpose:

- `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`
- `package.json`, `package-lock.json`, `eslint.config.mjs`
- `firebase.json`

`firebase.json` remains at root because the Firebase CLI expects it as the default project entrypoint. It references assets under `apps/` and `infra/`, so deployable state is still organized without hiding the main config in a nonstandard place.
