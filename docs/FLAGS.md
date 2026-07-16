# Feature Flags Register

All client flags are read centrally in `apps/web/public/assets/config.js` and
exposed as `window.MZ_FLAGS`; no scattered flag literals. URL override:
`?ff_<name>=0|1` (only for the URL-controllable flags below).

Rules for new flags: every flag gets a row here with type, purpose, owner,
default, expiry (or ticket) and removal criterion. Release flags (unfinished
features) start **off**; operations/kill-switch flags start in the state that
represents normal operation. Authorization logic is never a feature flag.
A flag whose feature has stabilized is removed together with its dead code;
an expired flag blocks the next release.

## Active flags

| Flag | Type | Purpose | Default | URL-controllable | Owner | Expiry | Removal criterion |
|---|---|---|---|---|---|---|---|
| `enableWs` | ops / kill-switch | Disable WebSocket live sync (fallback: HTTP Yjs push/pull) | `true` | yes (`?ff_enableWs=0`) | maintainer | permanent (kill switch) | relay architecture retired |
| `enablePresence` | ops / kill-switch | Disable realtime presence signals | `true` | yes (`?ff_enablePresence=0`) | maintainer | permanent (kill switch) | presence feature retired |
| `enableCrdt` | internal (test only) | Editor simulator runs without the CRDT path; production is always `true` and this is deliberately **not** URL-controllable (CRDT is the only persistence path) | `true` | no | maintainer | permanent | editor simulator retired |

## Server-side environment switches

Not feature flags (deploy-time configuration), listed for audit completeness.
All have safe production defaults when unset:

| Variable | Service | Effect | Guard |
|---|---|---|---|
| `MZ_ALLOWED_ORIGINS` | api, collab-relay | Extends (never replaces) the built-in production origin whitelist | defaults always included (`DEFAULT_ALLOWED_ORIGINS`) |
| `MZ_WS_REQUIRE_ORIGIN`, `MZ_WS_ALLOW_HOST_FALLBACK`, `MZ_WS_TRUST_PROXY_HOPS` | collab-relay | Origin/proxy handling | secure defaults: origin required (`1`), host fallback off (`0`), 1 trusted proxy hop (Cloud Run LB) |
| `MZ_DISABLE_APPCHECK=1` | api | App-Check bypass for the local emulator/test stack **only** | must never be set in production; default off |
