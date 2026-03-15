# Abuse Protection

malziSPACE is designed around zero-knowledge content handling. Because the backend cannot inspect plaintext content, abuse protection must rely on transport, identity, rate, and budget controls instead of content scanning.

## Current protection layers

### Client attestation

- Firebase App Check is enforced for API access.
- The web app currently uses a custom proof-of-work provider via Firebase App Check.

### API boundary controls

- strict origin allowlist
- trusted client IP derivation instead of blind proxy trust
- pre-verification limiter before App Check verification
- endpoint-specific rate limits
- global per-IP endpoint caps to reduce ID scanning across many spaces
- ciphertext-size budgets for `save` and `yjs/push`
- request body size limits and payload encoding validation

### Honeypot

- The space creation form includes a hidden `website` field invisible to humans.
- Bots that auto-fill the field are silently rejected (client-side and server-side).

### Zero-knowledge write authorization

- write operations require `key_proof`
- unauthorized writes are rejected even when a valid space ID is known

### Relay controls

- room-scoped WebSocket auth bound to `key_proof`
- strict origin enforcement
- connection-rate limits per IP
- concurrent-connection caps per IP
- message-rate caps per socket
- byte-budget caps per socket and per room
- room-count and room-size limits

### Data growth controls

- RTDB Yjs updates are pruned by age
- full snapshots are bounded
- pull responses are bounded

## Simulator-specific protections

The local `sim=1` mode uses a browser-local relay so E2E tests can validate collaboration behavior without cloud dependencies.

- tab-local presence tokens use `sessionStorage`
- simulator relay is scoped by `SPACE_ID`
- simulator multiplayer tests run inside a shared browser context so the local relay behaves like real multi-tab usage

## Design rule for future features

Any new feature that can trigger writes, fan-out, or long-lived connections must define:

1. its auth boundary
2. its rate key(s)
3. its byte budget
4. its maximum fan-out
5. its cleanup strategy
6. its tests
