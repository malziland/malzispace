# Security Model (Sketch)

Reference sketch for development and audits — not a full threat model.
Deep dives: `docs/security/ABUSE_PROTECTION.md` (rate limits, budgets, bot
protection), `docs/security/SECURITY_RUNBOOK.md` (incident response),
`docs/legal/PRIVACY_STACK.md` (privacy/legal), `SECURITY.md` (reporting).

## Assets

- **Encryption key** — AES-256-GCM key in the URL fragment; never sent to any
  server. Loss of secrecy = full content disclosure to whoever holds the link.
- **`key_proof`** — SHA-256 hash of the key; authorizes writes without
  revealing the key.
- **Owner secret / `owner_key_proof`** — grants owner privileges (lock,
  append-only protection); stripped from the address bar after load
  (`history.replaceState`, sessionStorage backup).
- **Space content and titles** — ciphertext only on server side
  (zero-knowledge); plaintext exists only in browsers.
- **App Check tokens** (proof-of-work attestation) and **client IPs**
  (transient, in-memory rate limiting) — abuse-control data.
- **Firebase/GCP service credentials** — platform-managed; never in the repo.

## Roles

- **Owner**: created the space; holds the owner secret; can lock and protect.
- **Participant**: holds link + key; can read, and write unless locked.
- **Anonymous internet actor**: no key; can only hit public endpoints.
- **Maintainer**: deploys via Firebase/GCloud; no access to plaintext content.

## Trust boundaries and data flows

1. **Browser ↔ Functions API (`/api/*`)** — origin whitelist, App Check
   (proof-of-work), per-endpoint and global rate limits, payload budget,
   ciphertext format validation, `key_proof`/`owner_key_proof` write
   authorization (fail closed, central `checkWriteAuth`).
2. **Browser ↔ collab relay (WebSocket, Cloud Run)** — `key_proof` auth,
   origin whitelist, per-socket/per-room rate and byte limits; relay
   broadcasts opaque ciphertext and never parses content.
3. **Functions/relay ↔ Firestore/RTDB** — security rules deny **all** client
   access; only backend identities read/write. Deletion order is
   RTDB-before-Firestore so no orphaned realtime data survives.
4. **Client-side enforcement boundary (known limitation)** — protect/append-
   only mode is enforced in the client (protect-guard + CRDT owner-invariant
   in `network/collaboration.js`). The relay does **not** validate Yjs updates
   against protect rules server-side; a manipulated client can violate
   protect mode until honest clients reconcile. Accepted risk, tracked as an
   open hardening item (owner: maintainer).

## Main abuse cases and countermeasures

| Abuse case | Countermeasure |
|---|---|
| Bot spam / mass creation | App Check proof-of-work, honeypot field, rate limits |
| DoS / resource exhaustion | up to 17 independent rate limiters, 2 MiB/min payload budget, request size limits |
| Unauthorized writes | `key_proof` requirement; version-conflict 409 on `/api/save` |
| Participant tampering with protected text | protect-guard + CRDT owner-invariant (client-side; see limitation 4) |
| Link/key leakage | fragment never sent to server; 24h expiry bounds the blast radius; owner secret stripped from URL |
| Server/insider reading content | zero-knowledge design: ciphertext only, keys never leave clients |

## Retention and deletion

- All spaces auto-expire after **24 hours** (Firestore TTL + scheduled
  cleanup); no permanent storage.
- Explicit deletion via `POST /api/delete` (GDPR erasure path), RTDB before
  Firestore.
- Logs contain no plaintext content, keys or tokens; IPs are used transiently
  for rate limiting.

## Privacy note (data class: PII-adjacent)

No accounts, no cookies, no analytics, no tracking. PII surface is minimal:
client IPs (abuse control, transient) and whatever users paste (E2E-encrypted,
unreadable server-side). Processor: Google Firebase / Google Cloud (EU regions
europe-west1/west3) under Google's DPA. Purpose limitation and legal detail:
`docs/legal/PRIVACY_STACK.md` and the published privacy policy. This is an
implementation sketch, not legal advice.
