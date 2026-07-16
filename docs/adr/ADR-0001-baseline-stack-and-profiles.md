# ADR-0001: Baseline stack, project profiles, and bootstrap decisions

Date: 2026-07-16
Status: accepted

## Context

malziSPACE has been live since v1.0.0 (2026-03-15) and is at v1.4.0. The
project predates this ADR; its standing decisions were spread across
CHANGELOG.md, README.md and docs/. This ADR records them retroactively so
that audits and future changes have a single reference point. It is part of
bringing the repository up to the bootstrap standard (gap-fill mode) described
in `docs/project/familien-standard-konzept.md`.

## Decisions

1. **Stack**: Firebase Hosting + Cloud Functions v2 (Node 24, europe-west1) +
   Firestore (metadata) + Realtime Database (CRDT/presence); WebSocket relay on
   Cloud Run (europe-west3); frontend in vanilla ES6 modules without framework
   or build framework; npm-workspaces monorepo (`services/api`,
   `services/collab-relay`, `tests`), with per-service lockfiles for
   independently deployed units.
2. **Tier: STANDARD.** The service is public, productive and open source, so
   MINIMAL is excluded. ENTERPRISE machinery (SBOM, build provenance, signed
   tags, restore drills with RPO/RTO) is deliberately not adopted: solo
   maintainer, no artifact distribution to third parties, deploys are manual.
3. **Active profiles**:
   - **UI** — public web editor; E2E coverage of the critical flows plus an
     automated accessibility check and a documented keyboard smoketest.
   - **SERVICE_API** — `/api/*` Cloud Functions and the relay; fail-closed
     write authorization (`key_proof`/`owner_key_proof`), origin whitelist,
     rate limits and payload budgets (see `docs/security/ABUSE_PROTECTION.md`).
   - **MONOREPO** — workspace root pins the toolchain; package boundaries are
     the deployment units; CI always tests the full repository (conservative
     fallback, no affected-only optimization).
4. **Versioning**: SemVer for the deployed application, annotated tags
   `vX.Y.Z`; CHANGELOG.md follows Keep a Changelog.
5. **Environment encapsulation**: toolchain pinning only (`.nvmrc` Node 24,
   `engines` field, committed lockfiles). No devcontainer — solo project,
   native development environment.
6. **Language**: code, comments and repository docs in English; product copy
   DE/EN via the i18n module; planning/approval documents may be German.
7. **Deliberate omissions (accepted risk, owner: maintainer, review at next
   major release)**:
   - No SBOM / build provenance — no third-party artifact distribution.
   - No pre-commit hooks — the enforcement boundary is CI plus platform push
     protection; hooks would be local ergonomics only.
   - No external feature-flag service — two config kill-switches suffice
     (see `docs/FLAGS.md`).

## Consequences

- Audits (KURZAUDIT/LANGAUDIT) find the per-requirement evidence path in
  `docs/VERIFICATION.md`; deviations from the profiles above are findings.
- Changes that would alter these decisions require a new ADR before code.
- If artifact distribution, additional maintainers or regulated data ever
  enter the picture, the omissions in decision 7 must be revisited.
