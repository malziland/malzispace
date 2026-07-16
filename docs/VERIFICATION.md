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
| Accessibility (UI profile) | `npm run test:e2e:a11y` — axe serious/critical gate + keyboard paths | 2026-07-16 green (0 serious/critical); full smoketest checklist executed scripted, 9/9 green (see A11Y_SMOKETEST.md runs table); only the optional VoiceOver pass remains genuinely manual |
| Lock-flow E2E | `npm run test:e2e:lock` (step 11/11) | 2026-07-16 green in CI (run 29520644377) AND locally (11 assertions) after the mode-switch port |
| Protect E2E suites | `test:e2e:protect`, `test:e2e:protect:fuzz` | 2026-07-16 green locally: 12/12 protect assertions; fuzz "All protection invariants held" (Chromium + WebKit, playwright 1.61.1) |
| Secret scan | gitleaks 8.30.1, full history, `.gitleaks.toml` exceptions | 2026-07-16: 101 commits scanned, no leaks after triage; CI job repeats per push. config.php key (f2e53136) triaged and CLOSED 2026-07-16: symmetric at-rest key of the retired pre-Firebase PHP prototype, zero references in HEAD (`git grep`), prototype data expired by design; maintainer confirms nothing pre-Firebase is in use or deployed — the key protects nothing |
| Dependency audit | `npm audit --omit=dev --audit-level=high` in root, services/api, services/collab-relay | 2026-07-16 all three exit 0 (remaining moderate: uuid chain under firebase-admin 13, api only) |
| Rollback capability | Probe on tag v1.4.0 in temp worktree: setup, test, build | 2026-07-16 performed: tests 49/49, build OK; lint red there (pre-existing, fixed on main) — docs/RUNBOOK.md |
| CI pipeline | `.github/workflows/verify.yml` (hardened, 3 jobs) | 2026-07-16 green: run 29520644377 (verify all 11 steps incl. lock E2E, secret-scan; first fully green run since 2026-05-28). Step 11 needed firebase-tools\@15.24.0 + JDK 21 provisioning and the offline demo- project id |
| SERVICE_API profile | Fail-closed write auth (`isWriteAuthorized`, central checks), 17 rate limiters, payload budget; inventory in README API table | Unit suites green (see above); docs/security/ABUSE_PROTECTION.md; README table completed 2026-07-16 (/lock, /append-only, /delete) |
| MONOREPO profile | Pinned toolchain at root (.nvmrc, engines, lockfiles); CI always tests the full repo | verify.yml runs the complete pipeline on every push (no affected-only shortcut) |
| Flags register | docs/FLAGS.md vs `apps/web/public/assets/config.js` | 2026-07-16 in sync (2 kill switches, 1 internal test flag, env switches documented) |
| External controls (branch protection, push protection, 2FA, Dependabot app) | GitHub API, verified 2026-07-16 | Set/confirmed via `gh api`: branch protection on main (required checks `verify`+`secret-scan` for PRs, force-push and deletion blocked, direct maintainer pushes allowed), secret scanning + push protection enabled, vulnerability alerts + Dependabot security updates enabled. 2FA: verified enabled 2026-07-16 via maintainer's account settings (authenticator app + 2 passkeys; GitHub-mandated for the account) |

| E2E encryption unit tests (ARCH-002) | `tests/unit/crypto.test.mjs` — 9 tests: b64url round-trip, hash/owner parsing, SHA-256 proofs, GCM round-trip + fresh nonces, tamper rejection, wrong-key rejection, IV framing, title trim/cap + graceful failure, HMAC room signatures | 2026-07-16 green (Node WebCrypto); browser tree excluded from the coverage denominator per QUALITY_GATES policy |
| Cost ceiling: GCP budget alert | `gcloud billing budgets list` (billing account 01C8BF-FF9AE4-B0958B, via project malzispace) | verified 2026-07-16: budget "malziSpace Limit", 10 EUR/month, thresholds 50/90/100% current spend, all projects of the account — pre-existing, now externally verified (closes audit OPS-01 post-launch item) |
| Release v1.4.1 deployed | `firebase deploy --only functions,hosting` + `gcloud run deploy malzispace-collab` + `ops/verify_live.sh` (both domains) | 2026-07-16: deploy green (functions api+cleanupExpired, hosting release, relay revision 00011); LIVE OK against malzi.space AND malzispace.web.app; new company name and removed dead link verified live via curl |

No open items remain: the optional VoiceOver pass was deliberately skipped
(maintainer decision 2026-07-16, rationale in docs/frontend/A11Y_SMOKETEST.md).
Everything in this matrix is verified and closed.
