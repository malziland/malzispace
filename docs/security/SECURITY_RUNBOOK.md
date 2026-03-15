# Security Runbook

This runbook is for operating malzispace safely in production.

## 1. Before Every Deploy

1. Create restore point:
   ```bash
   ./ops/restore_point.sh pre-deploy
   ```
2. Run verification:
   ```bash
   ./ops/verify_local.sh
   ```
3. Optional (recommended) live smoke test:
   ```bash
   APP_CHECK_TOKEN="..." ./ops/verify_local.sh
   ```
4. Deploy only when all checks are green.

## 2. Post-Deploy Quick Checks

1. Open `/` and create a space.
2. Confirm redirect to `/space.html?id=...#...`.
3. Edit text and confirm status changes to `Gespeichert`.
4. Open same link in second tab and verify sync + presence.
5. Confirm countdown is running and no CSP errors appear in console.

## 3. Incident Patterns

## 3.1 Many `401 app_check_invalid`

- Verify the allowed App IDs for the custom App Check provider in `services/api/index.js` or the corresponding environment configuration.
- Verify CSP allows the Firebase App Check / gstatic domains used by the custom provider flow.
- Check that production domain is configured for App Check.

## 3.2 Sudden traffic / abuse symptoms

- Check function logs for `rate_limited` and repeated IP patterns.
- Check presence and yjs write traffic (`/api/presence`, `/api/yjs/push`).
- If needed: tighten rate limits in `services/api/index.js` and redeploy.

## 3.3 Unexpected write denials (`forbidden_no_key`)

- Means write request has missing/wrong `key_proof`.
- Confirm client has URL fragment key (`#...`) and is using latest frontend.
- Verify the space was created with the current frontend version.

## 3.4 Origin errors (`origin_not_allowed`)

- API/relay now enforce allowed origins.
- Check `MZ_ALLOWED_ORIGINS` env var in Functions and collab relay.
- Verify production domains are present (`malzi.space`, `*.web.app`, `*.firebaseapp.com` as needed).
- For local testing, use `localhost:3000` or `localhost:5000` (already included by default).

## 4. Rollback

1. List restore tags:
   ```bash
   git tag --list "restore-*"
   ```
2. Checkout restore commit:
   ```bash
   git checkout <tag>
   ```
3. Create hotfix branch from restore point and redeploy.
