# Dependency management

How dependency updates work in this repo, and why the `overrides` blocks exist.

## Repository layout

Three npm manifests, each with its own lockfile:

| Manifest | Lockfile | Installed with |
| --- | --- | --- |
| `package.json` | `package-lock.json` | `npm ci` (workspaces) |
| `services/api/package.json` | `services/api/package-lock.json` | `npm ci --no-workspaces` |
| `services/collab-relay/package.json` | `services/collab-relay/package-lock.json` | `npm ci --no-workspaces` |

`services/api` and `services/collab-relay` are npm **workspace members** *and* carry
standalone lockfiles, because they are deployed independently (Cloud Functions and
Cloud Run each install from their own directory).

### Consequence: service dependency bumps must touch two lockfiles

Changing `firebase-admin` in `services/api/package.json` invalidates **both**
`services/api/package-lock.json` and the root `package-lock.json` (which pins the
workspace member's tree too). Updating only one of them makes `npm ci` fail:

- root lockfile stale → `npm ci` fails at the repo root
- service lockfile stale → `npm ci --no-workspaces` fails in the service directory

Always regenerate in this order after editing a service manifest:

```bash
npm install                                            # root lockfile
(cd services/api && npm install --no-workspaces)       # service lockfile
(cd services/collab-relay && npm install --no-workspaces)
```

Then confirm the CI sequence reproduces cleanly:

```bash
npm ci
(cd services/api && npm ci --no-workspaces)
(cd services/collab-relay && npm ci --no-workspaces)
```

Dependabot cannot edit files across two directories in one PR, so cross-cutting
bumps of `firebase-admin` / `firebase-functions` / `ws` are handled by a
maintainer commit rather than by an auto-merged bot PR. See
`.github/dependabot.yml` for which updates are automated.

## Overrides

All three manifests carry the same `overrides` block. Keep them in sync.

### `rimraf: ^6.1.3`

Pulls the whole glob chain out of the `brace-expansion` DoS advisory
([GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), CVE-2026-14257):

```
firebase-admin -> @google-cloud/firestore -> google-gax
  -> rimraf@5 -> glob@10 -> minimatch@9 -> brace-expansion@2.x   (vulnerable)
  -> rimraf@6 -> glob@13 -> minimatch@10 -> brace-expansion@5.0.8 (patched)
```

Without it, `npm audit --omit=dev --audit-level=high` fails in the root and
collab-relay trees, which blocks every PR.

`google-gax` declares `rimraf: ^5.0.1` but **never imports it** — verified with
`grep -rn "rimraf" node_modules/google-gax/` returning only the `package.json`
declaration. The override therefore carries no runtime risk.

Note that `brace-expansion@2.1.3` *is* a genuine backport of the fix, but the
advisory range is expressed as `<=5.0.7` and so still flags the patched 2.x line.
Staying on 2.x cannot make the audit gate pass; moving the chain to 5.0.8 can.

### `uuid: ^11.1.0`

Removes the `uuid@9.0.1` deprecation warning emitted on every install, coming from
`gaxios` and `teeny-request` under `@google-cloud/storage`.

Pinned to the 11.x line on purpose: both consumers use CommonJS
(`require("uuid").v4()`), and uuid's own deprecation notice directs CommonJS
codebases to v11. uuid 12+ is ESM-first. Only `v4()` is used by either consumer,
and its signature is unchanged across 9 → 11.

### Removing an override

An override is no longer needed once upstream ships the fix. Check with:

```bash
npm ls rimraf uuid --all          # is the overridden version still "invalid"?
npm audit --omit=dev --audit-level=high
```

`npm ls` marks overridden packages as `invalid` because the installed version
deviates from the declaring package's range. That marker is expected and is the
normal cost of an override — it is not an error, and no gate reads it.

## Known unfixable warning

`npm ci` prints one deprecation warning on a cold cache:

```
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
```

Chain: `google-gax -> node-fetch@3.3.2 -> fetch-blob@3.2.0 -> node-domexception`.

This cannot be resolved by version selection: **every** published version of
`node-domexception` (1.0.0 through 2.0.2) is deprecated, because the package
exists only to polyfill something Node now provides natively. `fetch-blob@4.0.0`
still depends on it, and `google-gax` still depends on `node-fetch@3`.

It is an informational notice, not a vulnerability — the audit gate is green.
It will disappear when Google's client libraries drop `node-fetch`. Do not
suppress it with `--loglevel=error`; that would hide future genuine warnings.
