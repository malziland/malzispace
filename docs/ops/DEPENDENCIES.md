# Dependency management

How dependency updates work in this repo, why the two services are *not* npm
workspace members, and why the `overrides` blocks exist.

## Repository layout

Three independent npm manifests, each with exactly one lockfile:

| Manifest | Lockfile | Installed with | Deployed as |
| --- | --- | --- | --- |
| `package.json` | `package-lock.json` | `npm ci` | — (tooling + `tests` workspace) |
| `services/api/package.json` | `services/api/package-lock.json` | `npm ci --no-workspaces` | Cloud Functions |
| `services/collab-relay/package.json` | `services/collab-relay/package-lock.json` | `npm ci --no-workspaces` | Cloud Run |

The root `workspaces` array contains **only** `tests`. The two services are
deliberately standalone.

### Why the services are not workspaces

They used to be workspace members *and* carry standalone lockfiles (needed
because each is deployed from its own directory). That combination made every
service dependency bump touch two lockfiles at once: the service's own and the
root lockfile, which pinned the workspace member's tree as well.

Dependabot cannot edit files in two directories in one pull request, so every
service dependency PR was structurally unmergeable:

- a root-scoped PR updated `services/*/package.json` + the root lockfile, leaving
  the service lockfile stale → `npm ci --no-workspaces` failed in the service
- a service-scoped PR updated the service manifest + its lockfile, leaving the
  root lockfile stale → `npm ci` failed at the repo root

Both halves are required and no single PR could contain both. In July 2026 this
had accumulated 15 open Dependabot PRs, none of which could ever go green.

Decoupling removes the shared state: the root lockfile no longer contains
`firebase-admin`, `firebase-functions`, `express` or `ws` at all, so each
manifest can be updated on its own and every Dependabot PR is independently
mergeable. This is what makes the auto-merge workflow safe.

The cost is that the root `test` script has to fan out explicitly:

```json
"test": "npm --workspaces --if-present test && npm --prefix services/api test && npm --prefix services/collab-relay test"
```

This keeps both services in the coverage gate. Their tests import only Node
builtins and their own `lib/` files, so they run without the services'
`node_modules` being present.

**Do not re-add the services to `workspaces`.** It reintroduces the deadlock.

## Overrides

`services/api/package.json` and `services/collab-relay/package.json` carry the
same `overrides` block — keep them in sync. The root manifest needs none,
because none of these packages appear in its tree.

### `rimraf: ^6.1.3`

Pulls the glob chain out of the `brace-expansion` DoS advisory
([GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg), CVE-2026-14257):

```
firebase-admin -> @google-cloud/firestore -> google-gax
  -> rimraf@5 -> glob@10 -> minimatch@9 -> brace-expansion@2.x   (vulnerable)
  -> rimraf@6 -> glob@13 -> minimatch@10 -> brace-expansion@5.0.8 (patched)
```

Without it, `npm audit --omit=dev --audit-level=high` fails in both service
trees, which blocks every PR.

`google-gax` declares `rimraf: ^5.0.1` but **never imports it** — verified with
`grep -rn "rimraf" node_modules/google-gax/`, which returns only the
`package.json` declaration. The override therefore has no runtime effect.

Note that `brace-expansion@2.1.3` *is* a genuine backport of the fix, but the
advisory range is written as `<=5.0.7` and so still flags the patched 2.x line.
Staying on 2.x cannot make the audit gate pass; moving the chain to 5.0.8 can.

### `uuid: ^11.1.0`

Removes the `uuid@9.0.1` deprecation warning emitted on every install, coming
from `gaxios` and `teeny-request` under `@google-cloud/storage`.

Pinned to the 11.x line on purpose: both consumers are CommonJS
(`require("uuid").v4()`), and uuid's own deprecation notice directs CommonJS
codebases to v11. uuid 12+ is ESM-first. Only `v4()` is used by either consumer,
and its signature is unchanged across 9 → 11.

### Removing an override

An override is no longer needed once upstream ships the fix:

```bash
cd services/collab-relay
npm ls rimraf uuid --all --no-workspaces   # still marked "invalid"?
npm audit --omit=dev --audit-level=high --no-workspaces
```

`npm ls` marks overridden packages as `invalid` because the installed version
deviates from the declaring package's range. That marker is expected and is the
normal cost of an override — it is not an error, and no gate reads it.

## Known unfixable warning

`npm ci` prints one deprecation warning in the service trees on a cold cache:

```
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
```

Chain: `google-gax -> node-fetch@3.3.2 -> fetch-blob@3.2.0 -> node-domexception`.

This cannot be resolved by version selection: **every** published version of
`node-domexception` (1.0.0 through 2.0.2) is deprecated, because the package
exists only to polyfill something Node now provides natively. `fetch-blob@4.0.0`
still depends on it, and `google-gax` still depends on `node-fetch@3`.

### Why this needs no action

The package is a pure passthrough on modern Node. Its entire source is:

```js
if (!globalThis.DOMException) { /* fallback for old Node */ }
module.exports = globalThis.DOMException
```

On Node 24 `DOMException` already exists before the `require`, so the fallback
is skipped and the package hands back Node's built-in class, adding nothing.
Verify with:

```bash
node -e "const before = globalThis.DOMException;
         console.log(require('node-domexception') === before)"   # -> true
```

So the code already uses the native implementation. Upgrading is not an option
either: *every* version is deprecated, because the maintainer deprecated the
package as a whole — the notice is addressed to library authors like
`fetch-blob`, not to consumers.

Nothing gets switched off:

1. npm deprecation is a registry flag; the package stays installable, and npm
   does not remove packages that have dependents.
2. The lockfile pins version and integrity hash, and the dependency is baked
   into the Cloud Run image / Functions artifact at deploy time.
3. Even if it vanished, no functionality would be lost — it only returns a
   class Node provides itself.

Note that `node-fetch@3.3.2` and `fetch-blob@3.2.0` are *not* deprecated; only
the leaf is. The notice disappears once Google's client libraries move to
native `fetch` — not via node-fetch 4, which has been in beta since 2022 and
still depends on `fetch-blob`.

Do not suppress it with `--loglevel=error`; that would hide future genuine
warnings. Replacing it with a vendored shim is possible but buys nothing: it
would add a `file:` dependency to both deployed artifacts to silence a line
that already describes a no-op.

## Updating dependencies by hand

```bash
npm install                                            # root
(cd services/api && npm install --no-workspaces)
(cd services/collab-relay && npm install --no-workspaces)
```

Then confirm the CI sequence reproduces cleanly:

```bash
npm ci
(cd services/api && npm ci --no-workspaces)
(cd services/collab-relay && npm ci --no-workspaces)
```

## Automation

`.github/dependabot.yml` groups updates per manifest, monthly. Each group
produces one PR: patch/minor in one, majors in a separate one.

`.github/workflows/dependabot-auto-merge.yml` arms GitHub auto-merge on
Dependabot PRs that contain no semver-major change. Auto-merge only *queues*
the PR — branch protection on `main` still requires the `verify` and
`secret-scan` checks to pass, so a red pipeline blocks the merge exactly as it
would for a human PR. Major updates are left open with a comment.

Repository settings this depends on (both enabled):

- `allow_auto_merge` — without it `gh pr merge --auto` fails
- `delete_branch_on_merge` — keeps merged `dependabot/*` branches from piling up
