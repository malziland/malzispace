# malzispace collab relay (Yjs encrypted updates)

This is a minimal WebSocket relay that broadcasts binary messages to all peers in the same room.
It does not parse messages and is compatible with end‑to‑end encrypted Yjs updates.

## Security Defaults

- Origin allowlist is enabled by default (`MZ_WS_REQUIRE_ORIGIN=1`).
- Connection/message rate limits are enabled per process.
- Dead sockets are pruned with heartbeat ping/pong.

Optional environment variables:

- `MZ_ALLOWED_ORIGINS` comma-separated allowlist additions
- `MZ_WS_REQUIRE_ORIGIN` `1` (default) or `0`
- `MZ_WS_MAX_CONN_PER_IP_PER_MIN` (default `120`)
- `MZ_WS_MAX_MSG_PER_SOCKET_10S` (default `400`)
- `MZ_WS_HEARTBEAT_MS` (default `30000`)
- `MZ_WS_MAX_PAYLOAD_BYTES` (default `1048576`)
- `MZ_WS_MAX_CLIENTS_PER_ROOM` (default `120`)
- `MZ_WS_MAX_ROOMS` (default `2000`)

## Deploy to Cloud Run (recommended)

```bash
# from repo root
cd services/collab-relay
npm install

# build & deploy
# replace REGION and SERVICE if desired
REGION=europe-west3
SERVICE=malzispace-collab
PROJECT=malzispace

# gcloud setup (once)
# gcloud auth login
# gcloud config set project $PROJECT

# deploy

gcloud run deploy $SERVICE \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production"
```

After deploy, set the WebSocket URL in the client:

```js
// preferred: apps/web/public/assets/config.js (or set it before config.js is loaded)
window.MZ_COLLAB_WS_URL = "wss://YOUR-SERVICE-URL";
```

Alternatively, put the service behind your custom domain and route `wss://malzi.space/collab` to it.
