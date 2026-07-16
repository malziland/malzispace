# Runbook

Entry point for deploy, rollback and incident procedures. Deep dives:
`docs/ops/RELEASE_CHECKLIST.md` (release steps), `docs/ops/QUALITY_GATES.md`
(verification pipeline), `docs/security/SECURITY_RUNBOOK.md` (incident
response, abuse handling).

## Deploy

Deploys are manual maintainer actions, never run from CI:

```bash
./ops/verify_local.sh                      # full gate, must be green
npm run restore-point -- pre-deploy        # safety tag
npm run build:hosting
firebase deploy --only functions,hosting   # api + static site
# relay only when services/collab-relay changed:
# gcloud run deploy (see services/collab-relay/README notes)
./ops/verify_live.sh                       # live smoke + multiplayer
```

Release deploys additionally follow `docs/ops/RELEASE_CHECKLIST.md`
(CHANGELOG section, annotated tag `vX.Y.Z`, push with tags).

## Rollback

Application rollback = redeploy of a previous tag:

```bash
git worktree add /tmp/rollback <tag>       # e.g. v1.4.0 or restore-* tag
cd /tmp/rollback
npm ci && (cd services/api && npm ci --no-workspaces) \
       && (cd services/collab-relay && npm ci --no-workspaces)
npm run lint && npm test && npm run build:hosting
firebase deploy --only functions,hosting   # ships the old state
cd - && git worktree remove /tmp/rollback
```

Notes:

- Restore tags (`restore-YYYY-MM-DD_HHMM-<label>`) are created by
  `npm run restore-point`; release tags are `vX.Y.Z`. Both are valid targets.
- Hosting assets are content-hashed, so a rollback deploy cleanly replaces
  the asset graph; `version-check.js` prompts clients on the stale version.
- Data model: spaces live at most 24h, so schema rollbacks have no long-tail
  data-migration concern; deletion order stays RTDB before Firestore.

### Rollback probe (performed 2026-07-16)

Executed against tag `v1.4.0` (commit `a5a108f`) in a temporary git worktree,
Node v24.13.0:

| Step | Result |
|---|---|
| `npm ci` (root + both services) | OK |
| `npm test` (unit suites) | 49/49 passed, 0 failed |
| `npm run build:hosting` | OK (syntax check: 38 files) |
| `npm run lint` | red — 15 pre-existing errors (eslint 10.4 bump; fixed on main after v1.4.0, see CHANGELOG) |

Conclusion: a v1.4.0 build is reproducible from the tag; the lint failures
are a quality-gate artifact of the newer pinned eslint, not a runtime defect.

## Incidents

- Abuse, rate-limit tuning, key rotation: `docs/security/SECURITY_RUNBOOK.md`.
- Stale-client/cache incidents: point affected users to `/reset-cache.html`
  (ships `Clear-Site-Data`); see CHANGELOG v1.2.1 for background.
- Kill switches: `?ff_enableWs=0` / `?ff_enablePresence=0` per space URL, see
  `docs/FLAGS.md`. There is no server-side global kill switch; disabling an
  endpoint requires a functions redeploy.
