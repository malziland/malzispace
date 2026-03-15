# malziSPACE — Project Status

## Current State

malziSPACE is live at [malzi.space](https://malzi.space).

All core features are implemented and tested:

- End-to-end encrypted paste + realtime collaboration
- AES-256-GCM encryption (titles + content)
- Yjs CRDT synchronization via WebSocket relay
- 24h auto-expiry with scheduled cleanup
- Firebase App Check with proof-of-work provider
- Modular ES6 editor architecture (20 modules)
- Full E2E test coverage (92 tests, desktop + mobile)
- Bilingual UI (German + English)

## Infrastructure

- **Hosting**: Firebase Hosting
- **API**: Firebase Cloud Functions v2 (europe-west1)
- **Firestore**: Metadata storage (eur3)
- **RTDB**: CRDT updates + presence (europe-west1)
- **Relay**: Cloud Run WebSocket relay (europe-west3)

## Key Files

- `services/api/index.js` — API endpoints, expiry, cleanup, App Check
- `apps/web/public/assets/modules/` — Modular editor (20 ES6 modules)
- `apps/web/public/assets/config.js` — Runtime config + feature flags
- `apps/web/public/assets/appcheck.js` — App Check bootstrap
- `services/collab-relay/` — WebSocket broadcast relay
