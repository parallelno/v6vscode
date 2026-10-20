# Publishing

`scripts/publish.cjs` verifies, packages, validates and (only when explicitly
asked) publishes the extension to the VS Code Marketplace. It is fail-closed:
the default invocation is a **dry run** that never publishes, never changes the
version, and never creates a commit, tag or push.

```powershell
npm run publish:dry-run        # verify + package + validate; publishes nothing
npm run publish:marketplace    # full release gate, then publish the validated VSIX
```

The extension ID is `parallelno.v6vscode` (from `publisher` and `name` in
`package.json`). The listing is hosted in the **Visual Studio Marketplace**;
there is no server, storage bucket or DNS to configure, and no Azure
subscription, payment method or paid hosting is involved. Microsoft runs the
gallery and serves the VSIX to users.

## First-time setup: accounts and hosting

Record these values once; they are the permanent identity of the extension.

| Item | Value for this repository | Where it is managed |
|---|---|---|
| Microsoft account | The identity that owns the publisher | [Marketplace management](https://marketplace.visualstudio.com/manage) |
| Marketplace publisher | `parallelno` | Manage page > **Create publisher** |
| Extension ID | `parallelno.v6vscode` | Derived from publisher + `name` |
| Azure DevOps organization | Any organization the same identity can access | [dev.azure.com](https://dev.azure.com) |
| Marketplace PAT | Scope **Marketplace > Manage**, expiry ≤ 1 year | Azure DevOps > User settings > Personal access tokens |
| Source repository | <https://github.com/parallelno/v6vscode> | GitHub (already configured as `origin`) |
| Listing icon | `images/icon2.png` (128×128 PNG) | Top-level `icon` in `package.json` |

### 1. Create the Marketplace publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft
   account (personal Outlook/Live, work or school account).
2. Choose **Create publisher**, enter ID `parallelno` and a display name.
3. Accept the publisher agreement. The publisher ID is permanent and is the
   first half of every extension ID.

If the page already lists `parallelno` but you cannot manage it, you are signed
in with a different Microsoft account than the one that created it.

If `parallelno` is not available to your account, pick another ID and change
`publisher` in `package.json` **before the first publish**. The publisher ID and
extension `name` cannot be changed later without creating a completely new
extension (losing installs, reviews and the existing ID).

### 2. Create the Marketplace personal access token (PAT)

1. Sign in at <https://dev.azure.com> with the **same Microsoft identity** that
   owns the publisher. Create a free organization if none exists.
2. Open **User settings > Personal access tokens > New Token**.
3. Name it (for example `v6vscode-marketplace`), choose the shortest practical
   expiry, and set **Organization** to **All accessible organizations**.
4. Choose **Custom defined**, then enable **Marketplace > Manage** (this scope
   includes publishing). Do not grant unrelated scopes.
5. Create the token and copy it immediately; Azure DevOps never shows it again.

The identity behind the PAT must be authorized for the publisher. A personal
Microsoft account is the simplest choice: a work/school PAT can be blocked by
conditional-access policy, and a PAT from an unrelated organization cannot
publish your extension. If publishing fails with an authorization error, this
mismatch is the first thing to check.

Treat the PAT as a password: never commit it, never put it in `.env`, and do not
add it to CI secrets without an explicit review. Revoke and replace it from the
same page when it expires or if it leaks. The script deliberately requires
`VSCE_PAT`; `vsce login` credential caching is not used.

### 3. Prepare the repository and listing

- `repository`, `license`, `displayName`, `description`, `categories`,
  `keywords` and `icon` are already set in `package.json`. The listing icon is
  the 128×128 PNG `images/icon2.png`; only that file from `images/` ships (the
  other artwork there is source material). `res/images/icon.png` remains the
  Activity Bar container icon used at runtime.
- Keep the GitHub repository public if possible: relative README links and
  images are resolved against `repository.url`, so a private repository gives
  Marketplace visitors broken documentation links. The listing itself works
  either way.
- `README.md` becomes the Marketplace description and `LICENSE` is required by
  `vsce`; both are present. Review the README install instructions after the
  first publish (see the checklist below).
- Optional: apply for the Marketplace **verified publisher** badge by verifying
  domain ownership from the publisher management page. It is cosmetic and not
  required to publish.

### 4. Choose where the VSIX is hosted (optional)

| Host | Who it serves | Status |
|---|---|---|
| VS Code Marketplace | Normal VS Code users | Primary target; automated by the script |
| GitHub Releases | Offline/side-load users, reproducible artifacts | Optional; attach the validated VSIX to the release tag |
| Open VSX | VSCodium, Eclipse Theia, Gitpod and other VS Code forks | Optional and **not** automated by this script |
| Internal file share | Private/team distribution | Optional; copy the VSIX and install it with `code --install-extension` |

For Open VSX, create an account at <https://open-vsx.org>, claim the `parallelno`
namespace (it must match `publisher`), generate an access token, install the
`ovsx` CLI, and publish the same validated file manually:

```powershell
npx ovsx publish temp/publish/v6vscode-0.1.0.vsix -p $env:OVSX_PAT
```

That command talks to a different registry with its own terms and token; it is
outside `npm run publish:marketplace` and outside the release gate.

### 5. Optional: trusted CI release gate

`release-verification.yml` is manual and does not publish. To use it as a
second, independent gate:

1. On a trusted Windows x64 machine with a debugger-enabled emulator build,
   register a self-hosted runner in the GitHub repository under
   **Settings > Actions > Runners > New self-hosted runner**.
2. Give it the labels `self-hosted`, `Windows`, `X64` and `v6emul`; the workflow
   requires all four.
3. Under **Settings > Secrets and variables > Actions > Variables**, add
   `V6EMUL` with the absolute emulator path **on that runner**.
4. Run **Actions > Shipped release verification > Run workflow** and require the
   uploaded `release-verification` report to succeed before publishing.

Never run untrusted pull requests on that runner, and do not store `VSCE_PAT`
there without a reviewed approval step. The actual publish stays local and
manual.

## Local prerequisites

| Requirement | Purpose |
|---|---|
| Node.js 22 or later and `npm ci` | The pinned `@vscode/vsce` and the build/test toolchain |
| `VSCE_PAT` environment variable | Marketplace personal access token; required only with `--publish` |
| `V6EMUL` environment variable | Debugger-enabled emulator for the mandatory `verify:release` gate |
| `code` CLI on `PATH` | Installing and smoke-testing the packaged VSIX |
| Clean Git working tree | The published VSIX must correspond to a committed revision |

Set the variables only for the current shell session:

```powershell
$secure = Read-Host -AsSecureString 'Marketplace PAT'
$env:VSCE_PAT = [System.Net.NetworkCredential]::new('', $secure).Password
$env:V6EMUL = 'C:\Work\Programming\v6emul\build\release\app\Release\v6emul.exe'
```

```bash
read -rsp 'Marketplace PAT: ' VSCE_PAT && export VSCE_PAT
export V6EMUL=/path/to/v6emul
```

Never commit the token, place it in `.env`, or pass it as a command-line
argument. The script reads `VSCE_PAT` from the environment and never writes it
to disk; `vsce` uses the same variable internally. Clear it when finished with
`Remove-Item Env:VSCE_PAT` (PowerShell) or `unset VSCE_PAT` (bash).

## Versioning

`package.json` is the single source of truth for the published version. The
script refuses to modify it. Bump and tag the release commit before publishing:

```powershell
npm version patch -m "Release %s"
git push --follow-tags
```

The Marketplace **rejects semver prerelease versions** such as `0.2.0-beta.1`.
To ship a pre-release, keep a plain `x.y.z` version (higher than the current
marketplace version; VS Code recommends keeping the same major/minor and
increasing the patch) and pass `--pre-release`:

```powershell
npm run publish:marketplace -- --pre-release
```

`--pre-release` is passed to both `vsce package` and `vsce publish`, because the
Marketplace rejects a pre-release publish for a VSIX that was packaged without
the flag.

## First publish checklist (0.1.0)

Run these from the repository root in a fresh shell. Steps 0–1 are one-time
setup; step 2 is repeated in every new shell.

### Step 0: commit the publishing tooling

```powershell
git status --short
git add .vscodeignore README.md package.json docs/README.md docs/development.md docs/publishing.md scripts/publish.cjs images
git commit -m "Add fail-closed Marketplace publishing workflow"
git push origin main
```

The script refuses a dirty working tree, so the release commit must exist first.

### Step 1: tag the release commit

`package.json` is already at `0.1.0`, so the first publish needs no version bump.
Check that the tag does not already exist (`git tag --list v0.1.0`), then:

```powershell
git tag -a v0.1.0 -m "v6vscode 0.1.0"
git push origin v0.1.0
```

Later releases use `npm version`, which creates the commit and tag for you.

### Step 2: install dependencies and set the session environment

```powershell
npm ci
$secure = Read-Host -AsSecureString 'Marketplace PAT'
$env:VSCE_PAT = [System.Net.NetworkCredential]::new('', $secure).Password
$env:V6EMUL = 'C:\Work\Programming\v6emul\build\release\app\Release\v6emul.exe'
Test-Path $env:V6EMUL   # must print True
code --version          # the CLI must be on PATH
```

### Step 3: run the full release gate as a dry run

```powershell
npm run publish:dry-run -- --verify
```

This runs CI, the test typecheck, packaged VSIX tests on current and minimum VS
Code, and live conformance. Expect exit code 0, a validated
`temp/publish/v6vscode-0.1.0.vsix`, its SHA-256, and the message
`No publication was performed (dry run)`. Nothing is sent to the Marketplace.
See [Dry run](#dry-run) for what each check does.

If `V6EMUL` is unavailable, `npm run publish:dry-run` still packages and
validates using the `ci` gate, but real publishing will refuse without
`V6EMUL` unless you consciously pass `--skip-verify`.

### Step 4: smoke-test the exact artifact

```powershell
code --install-extension temp\publish\v6vscode-0.1.0.vsix --force
```

Open an empty folder, run **V6: Create Project** (try ASM/ROM), build with
`make`, and run **V6: Run Project**. Confirm the display, Settings, Hex Viewer,
Scripts and a debug session work against your `v6emul` build. Then remove the
side-loaded copy with `code --uninstall-extension parallelno.v6vscode` if you
intend to install the Marketplace build (both use the same extension ID).

### Step 5: publish

```powershell
npm run publish:marketplace
```

This re-runs `verify:release`, re-packages, re-validates, and only then uploads
the exact validated VSIX. Success prints
`Published parallelno.v6vscode@0.1.0` and the item URL. If it fails before the
upload, nothing was published and you can fix and rerun. If it fails during the
upload, check the management page before retrying: the version may already have
been accepted, and a retry would produce a duplicate-version error.

### Step 6: verify the listing and finish

- Management: <https://marketplace.visualstudio.com/manage/publishers/parallelno>
- Item: <https://marketplace.visualstudio.com/items?itemName=parallelno.v6vscode>
- Marketplace ingestion usually takes 5–15 minutes (occasionally longer). Check
  the manage page first; do not bump the version just because the public page
  lags.
- Install from the gallery: `code --install-extension parallelno.v6vscode`
- Update the README **Quick Start**, which currently installs from a `.vsix`
  file, to the Marketplace install command once the item is live.
- Optional GitHub release (offline installs) on the pushed tag:

```powershell
Get-FileHash temp\publish\v6vscode-0.1.0.vsix -Algorithm SHA256
gh release create v0.1.0 temp\publish\v6vscode-0.1.0.vsix `
  --title "v6vscode 0.1.0" `
  --notes "Vector-06c development extension. SHA-256: <paste hash>"
```

If `gh` is not installed, create the release in the GitHub web UI and attach the
VSIX and its SHA-256. Keep `temp/publish-report.json` and the published VSIX
with the release record.

### Subsequent releases

```powershell
git switch main
git pull
npm ci
npm version patch -m "Release %s"   # or minor / major; creates commit + tag
git push --follow-tags
npm run publish:dry-run -- --verify
npm run publish:marketplace
```

For a pre-release, bump to a plain higher `x.y.z`, push it, and append
`-- --pre-release` to `npm run publish:marketplace`. Users must opt in to
pre-release versions in VS Code.

## Dry run

```powershell
npm run publish:dry-run
```

The script then:

1. **Preflights the manifest** — required fields, repository URL,
   `engines.vscode`, plain `x.y.z` version, `README.md`, `LICENSE`, no `*`
   activation event, clean working tree (warns when the branch is not `main`).
2. **Runs `npm run ci`** — compile, browser checks, lint ratchet, unit and
   regression tests.
3. **Packages** `temp/publish/v6vscode-<version>.vsix` with the repository's
   pinned `@vscode/vsce`.
4. **Inspects the VSIX** (with `yauzl`) and fails if required runtime files are
   missing, development-only files or source maps leaked in, or the packaged
   `name`, `publisher`, `version`, `main` or `engines.vscode` disagree with
   `package.json`.
5. **Prints the SHA-256** and writes `temp/publish-report.json`.

Nothing leaves the machine. Install the exact artifact and smoke-test it:

```powershell
code --install-extension temp\publish\v6vscode-0.1.0.vsix --force
```

For the full release gate locally (requires `V6EMUL`), use:

```powershell
npm run publish:dry-run -- --verify
```

`--verify` replaces `ci` with `npm run verify:release`: cleaned output, CI, test
typecheck, packaged VSIX tests on current and minimum VS Code, and mandatory
live conformance. See [Compatibility and dependency gates](architecture-verification.md).

## Publishing

```powershell
npm run publish:marketplace
```

This is the same pipeline as the dry run, with two additional fail-closed
requirements before any work starts: `VSCE_PAT` must be set and `V6EMUL` must
point to a real executable (the full `verify:release` gate cannot be skipped
silently). After packaging and VSIX validation, the script publishes the exact
validated bytes:

```text
vsce publish --packagePath temp/publish/v6vscode-<version>.vsix
```

Publishing the already-validated file guarantees that what was checked is what
is uploaded, and prevents `vsce` from bumping the version or creating a tag.
On success the report is marked `"published": true` and the Marketplace URL is
printed.

A typical release:

```powershell
git switch main
git pull
npm ci
npm version patch -m "Release %s"
git push --follow-tags
npm run publish:dry-run -- --verify     # optional but recommended
npm run publish:marketplace
```

## Options

| Option | Effect |
|---|---|
| `--publish` | Publish after verification and validation. Requires `VSCE_PAT`. |
| `--dry-run` | Explicit dry run (the default when `--publish` is absent). |
| `--pre-release` | Mark the VSIX as a pre-release for package and publish. |
| `--verify` | Use `verify:release` instead of `ci` in a dry run. |
| `--skip-verify` | Skip verification entirely (emergency hotfixes only). |
| `--allow-dirty` | Permit an unclean working tree. |
| `--out <directory>` | Package output directory (default `temp/publish`). |
| `--help` | Print usage. |

`--skip-verify` is intentionally loud: the report records
`"verified": "skipped"`, and the script warns that unverified output must not be
published. Use it only to re-publish a hotfix when the emulator runner is
unavailable, and record why in the release notes.

## Release report

Every verification/package invocation writes `temp/publish-report.json`
(git-ignored, like all of `temp/`); failures also record an `error` string:

```json
{
  "mode": "dry-run",
  "extension": "parallelno.v6vscode",
  "version": "0.1.0",
  "commit": "<HEAD sha>",
  "verified": "ci",
  "vsix": {
    "path": "temp/publish/v6vscode-0.1.0.vsix",
    "entries": 289,
    "sha256": "<digest>"
  },
  "stages": [{ "name": "ci", "exit": 0, "elapsedMs": 0 }],
  "published": false,
  "success": true
}
```

Keep the report and the hashed VSIX with the release record. The script does not
upload, copy or archive them.

## What is checked inside the VSIX

Required: `extension/package.json`, the normalized `readme.md` and
`LICENSE.txt`, the compiled `out/extension.js`, `language-configuration.json`,
the project schema, the 8080 grammar, the icon, the bundled `res/boot` and
`res/fdd` resources, and at least one shipped webview asset per asset folder.

Rejected: `src/` (except the webview assets kept by the `.vscodeignore`
negations), `test/`, `docs/`, `design/`, `scripts/`, `temp/`, `out/test/`,
`.github/`, `.vscode-test/`, `.devcontainer/`, `.vscode/`, source maps and log
files. These rules mirror `.vscodeignore`; a rule that stops being effective is
caught before upload rather than after.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `The Git working tree is dirty` | Commit or stash the changes. Inspect with `git status --short`. |
| `Publishing requires the VSCE_PAT` | Set the token in the current shell (see above); tokens on the command line are rejected by design. |
| `401`/`403` from the Marketplace | Token expired or lacks **Marketplace > Manage**; create a new PAT and verify the publisher account. |
| `TF400813` / sign-in rejected | The PAT belongs to a different identity or organization than the publisher. Recreate it with the same account. |
| Conditional access or MFA blocks token creation | Use a personal Microsoft account for the publisher, or ask your administrator to permit PATs. |
| Publisher/extension ID mismatch | `publisher` must equal the publisher ID exactly; publisher IDs and extension `name` are permanent. |
| Public page 404 right after publish | Marketplace ingestion delay; check the manage page before changing anything. |
| Generic icon on the listing | Ensure the top-level `icon` path is packaged (already set to `images/icon2.png`). |
| `already exists` / conflict | The version is already published; bump `package.json` and tag again. |
| `Publishing requires V6EMUL` | Set `V6EMUL`, or use `--skip-verify` for an intentional hotfix. |
| `Cannot use '--pre-release' flag` | Package and publish must both use the flag; run through the script with `--pre-release`. |
| `doesn't support prerelease versions` | Use a plain `x.y.z` version plus `--pre-release`. |
| `The VSIX is missing ...` | Run `npm run compile`; check that `.vscodeignore` did not exclude a runtime resource. |
| `EPERM`/file lock on the VSIX | Close Explorer/VS Code previews of the file and retry. |
| `README` images or links are broken | Relative links are resolved from `repository.url`; keep docs links repository-relative. |

## Rollback

Unpublishing is destructive and irreversible; prefer shipping a fixed patch.

```powershell
npx vsce unpublish parallelno.v6vscode@0.1.0   # one version
npx vsce unpublish parallelno.v6vscode         # every version; prompts for confirmation
```

Installed copies are not removed by unpublishing. If a bad release shipped,
publish a fixed higher version promptly.

## Automation boundary

Publishing stays manual. The existing workflows only verify:
`verification.yml` runs deterministic checks, and `release-verification.yml` is
manually dispatched on the trusted `v6emul` runner. Do not add `VSCE_PAT` to
repository secrets or automate `--publish` without an explicit, reviewed
approval step; a compromised token can overwrite the publisher's extensions.
