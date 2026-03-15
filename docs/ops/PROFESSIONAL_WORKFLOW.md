# Professional Workflow

This document defines how to extend and operate this repository safely.

## 1. Restore-First Rule

Before any risky or broad change:

```bash
./ops/restore_point.sh pre-change
```

After each completed implementation phase:

```bash
./ops/restore_point.sh phase-name
```

Tags are annotated and include branch + commit metadata.

## 2. Feature Flag Workflow

All client-side feature flags are defined in `apps/web/public/assets/config.js`.

Current flags:

- `enableCrdt`
- `enableWs`
- `enablePresence`

How to add a new flag safely:

1. Add default value in `defaults` inside `apps/web/public/assets/config.js`.
2. Keep URL override pattern `ff_<flagName>=0|1`.
3. Guard behavior at one entry point (avoid scattered checks).
4. Keep backward compatibility when the flag is missing.
5. Document the new flag in `README.md`.
6. Verify with both flag states (`0` and `1`).

## 3. Release Gate

Required before deploy:

```bash
./ops/verify_local.sh
```

Recommended for live path validation:

```bash
APP_CHECK_TOKEN="..." ./ops/verify_local.sh
```

Deploy only when all checks are green.

## 4. Cleanup Policy

Safe local cleanup targets (regeneratable):

- `.firebase/`
- all `.DS_Store`
- all `node_modules/`
- `*.log`

Use:

```bash
./ops/clean_local.sh
```

## 5. Repository Boundaries

- Main git root is this folder (`malzispace`).
- Scripts enforce root correctness via `tools/bin/assert_repo_root.sh`.
- Do not use a parent git repository for tags, deploys, or restore points.
