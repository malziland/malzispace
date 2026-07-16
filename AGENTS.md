# AGENTS.md — agent guide for malziSPACE

Single source of project-specific rules for coding agents. Human-facing overview: `README.md`.
Architecture map: `docs/architecture/REPO_LAYOUT.md`. Quality gates: `docs/ops/QUALITY_GATES.md`.

## Commands

```bash
# Setup (fresh clone, Node 24 — see .nvmrc)
npm ci                                                # root + workspaces (tests)
(cd services/api && npm ci --no-workspaces)           # separate lockfile
(cd services/collab-relay && npm ci --no-workspaces)  # separate lockfile
npx playwright install chromium                       # for E2E suites

# Quality gates
npm run lint                     # ESLint, whole repo
npm test                         # workspace unit tests
npm run test:coverage:check      # coverage gate: 85/85/75 (branches)/85
npm run build:hosting            # -> build/hosting (content-hashed filenames)
./ops/verify_local.sh            # full 10-step pipeline (what CI runs)

# E2E suites need the built bundle served on :4173 first
npm run build:hosting
python3 -m http.server 4173 --directory build/hosting --bind 127.0.0.1 &
npm run test:e2e:simulator
npm run test:e2e:mobile          # 92 desktop+mobile tests
npm run test:e2e:i18n
SIM=1 ENGINES=chromium npm run test:e2e:multiplayer:sim

# These start their own local stack (firebase emulator + relay) — :4173 must be free
npm run test:e2e:lock
npm run test:e2e:protect
npm run test:e2e:protect:fuzz    # cross-engine fuzz (chromium + webkit)
```

## Non-obvious architecture rules

- Frontend is vanilla ES6 modules — no framework, no bundler framework.
  Modules live in `apps/web/public/assets/modules/` (entry: `app.js`).
- All DOM refs and mutable editor state live on the shared `ctx` object
  (`core/context.js`). Cross-module functions are registered on `ctx`
  (e.g. `ctx.renderLineNumbers`) to break circular imports — follow this pattern.
- Formatting uses managed CSS classes (`mz-fw-bold`, `mz-fs-italic`, `mz-td-underline`)
  and data attributes (`data-mz-fg`, `data-mz-bg`, `data-mz-align`).
  Owner-protected text is wrapped in `span.mz-owner-text`.
- Protect mode is enforced twice: `editor/protect-guard.js` (beforeinput +
  reconciliation against Y.Text) AND a CRDT owner-invariant in
  `network/collaboration.js` (`syncYTextFromEditorHtml`). Listener order is
  load-bearing: the guard's `input` listener (registered in `app.js`) must run
  BEFORE the collaboration sync listener. Do not reorder initialization.
- `tools/bin/build_hosting.mjs` hashes filenames over the transitive import
  hull. Never hardcode hashed asset names; always reference source names.
- Firestore/RTDB rules deny ALL client access by design — only the Functions
  API and the relay touch the databases. Do not "fix" this.

## Conventions

- Conventional Commits (`feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`, `build`).
- `CHANGELOG.md` (Keep a Changelog) for every user-visible change.
- Code, comments, docs: English. Annotated SemVer tags `vX.Y.Z`.
- Before risky work: `npm run restore-point` (creates a restore tag).
- Feature flags: register in `docs/FLAGS.md`; flags are read centrally in
  `apps/web/public/assets/config.js` (`window.MZ_FLAGS`), no scattered literals.
- Verification evidence: `docs/VERIFICATION.md`. Ops: `docs/RUNBOOK.md`.
- No local `.env` is required; the services' `MZ_*` env overrides have safe
  defaults (deploy-time configuration, see `docs/SECURITY-MODEL.md`).
- Deploys are manual maintainer actions (`firebase deploy`, `gcloud run deploy`),
  never run from CI or by an agent without explicit instruction.
