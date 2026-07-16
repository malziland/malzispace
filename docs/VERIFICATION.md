# Verification Matrix

Per-requirement evidence paths for audits (KURZAUDIT/LANGAUDIT). Update when
a change invalidates a proof or adds a mandatory one. "Result" entries carry
the reference (date, versions, run); a date alone is not evidence.

Environment for the 2026-07-16 entries: Node v24.13.0, npm 11.6.2, macOS,
eslint 10.7.0, playwright 1.61.1 (Chromium), gitleaks 8.30.1.

| Requirement | Evidence / command | Result |
|---|---|---|
| Fresh-clone setup | `npm run setup` (root + service lockfiles + Chromium) | 2026-07-16: equivalent command set ran green in a clean worktree (rollback probe, see RUNBOOK); CI reruns it frozen (`npm ci`) on every push |
| Lint | `npm run lint` | 2026-07-16 green (eslint 10.7.0), local + step 2/11 |
| Unit tests + coverage gate | `npm run test:coverage:check` (85/85/75/85) | 2026-07-16 green, 49/49 tests (26 api, 22 relay, 1 tools) |
| Reproducible build | `npm run build:hosting` (content-hashed, syntax check) | 2026-07-16 green, 38 files syntax-checked; hashing covers the transitive import hull |
| Editor E2E | `test:e2e:simulator`, `test:e2e:mobile` (92), `test:e2e:i18n`, `test:e2e:multiplayer:sim` | 2026-07-16 all green against the local build on :4173 |
| Accessibility (UI profile) | `npm run test:e2e:a11y` — axe serious/critical gate + keyboard paths | 2026-07-16 green (0 serious/critical, advisories logged); **manual checklist open** — owner: maintainer, docs/frontend/A11Y_SMOKETEST.md |
| Lock-flow E2E | `npm run test:e2e:lock` (step 11/11) | 2026-07-16 green in CI (run 29520644377) AND locally (11 assertions) after the mode-switch port |
| Protect E2E suites | `test:e2e:protect`, `test:e2e:protect:fuzz` | 2026-07-16 green locally: 12/12 protect assertions; fuzz "All protection invariants held" (Chromium + WebKit, playwright 1.61.1) |
| Secret scan | gitleaks 8.30.1, full history, `.gitleaks.toml` exceptions | 2026-07-16: 101 commits scanned, no leaks after triage; CI job repeats per push. Open: validity/rotation decision for the legacy pre-launch `config.php` key (commit f2e53136) |
| Dependency audit | `npm audit --omit=dev --audit-level=high` in root, services/api, services/collab-relay | 2026-07-16 all three exit 0 (remaining moderate: uuid chain under firebase-admin 13, api only) |
| Rollback capability | Probe on tag v1.4.0 in temp worktree: setup, test, build | 2026-07-16 performed: tests 49/49, build OK; lint red there (pre-existing, fixed on main) — docs/RUNBOOK.md |
| CI pipeline | `.github/workflows/verify.yml` (hardened, 3 jobs) | 2026-07-16 green: run 29520644377 (verify all 11 steps incl. lock E2E, secret-scan; first fully green run since 2026-05-28). Step 11 needed firebase-tools\@15.24.0 + JDK 21 provisioning and the offline demo- project id |
| SERVICE_API profile | Fail-closed write auth (`isWriteAuthorized`, central checks), 17 rate limiters, payload budget; inventory in README API table | Unit suites green (see above); docs/security/ABUSE_PROTECTION.md; README table completed 2026-07-16 (/lock, /append-only, /delete) |
| MONOREPO profile | Pinned toolchain at root (.nvmrc, engines, lockfiles); CI always tests the full repo | verify.yml runs the complete pipeline on every push (no affected-only shortcut) |
| Flags register | docs/FLAGS.md vs `apps/web/public/assets/config.js` | 2026-07-16 in sync (2 kill switches, 1 internal test flag, env switches documented) |
| External controls (branch protection, push protection, 2FA, Dependabot app) | repo-external — GitHub settings | [NOT ASSESSED] from the repo; owner checklist in docs/project/familien-standard-konzept.md §5 |

Known open items are tracked inline above (manual a11y checklist, config.php
key decision) — each with an owner.
