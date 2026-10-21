# Publishing

`scripts/publish.cjs` verifies, packages, validates and (only when explicitly
asked) publishes the extension to the VS Code Marketplace.

```powershell
npm run publish                      # same as dry-run
npm run publish:dry-run              # verify + package + validate; publishes nothing
npm run publish:marketplace:entra    # Entra ID (official recommendation), then publish
npm run publish:marketplace          # legacy PAT (VSCE_PAT) until 2026-12-01
```

The extension ID is `parallelno.v6vscode` (from `publisher` and `name` in
`package.json`). The listing is hosted in the **Visual Studio Marketplace**;
there is no server, storage bucket or DNS to configure (DNS is only needed if
you opt into the verified-publisher badge), and no paid hosting is involved.
Microsoft runs the gallery and serves the VSIX to users.

> [!IMPORTANT]
> Aligned with the official [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
> page (DateApproved 2026-10-14). Azure DevOps **global PATs are retired on
> December 1, 2026**; Microsoft recommends **Microsoft Entra ID**
> (`vsce --azure-credential`) instead. PATs below are documented only for the
> remaining transition period.

## First-time setup: accounts and hosting

Record these values once; they are the permanent identity of the extension.

| Item | Value for this repository | Where it is managed |
|---|---|---|
| Identity | Microsoft account or Microsoft Entra identity that owns or joins the publisher | [Marketplace management](https://marketplace.visualstudio.com/manage) |
| Marketplace publisher | ID `parallelno`, unique display name | Manage page > **Create publisher** |
| Extension ID | `parallelno.v6vscode` | Derived from publisher + `name` |
| Authentication | **Microsoft Entra ID** with `--azure-credential` (recommended); PAT only until 2026-12-01 | See section 2 |
| Azure DevOps organization | Needed for the legacy PAT and the official CI service connection | [dev.azure.com](https://dev.azure.com) |
| Legacy Marketplace PAT | Scope **Marketplace > Manage**, expiry ≤ 1 year | Azure DevOps > User settings > Personal access tokens |
| Source repository | <https://github.com/parallelno/v6vscode> | GitHub (already configured as `origin`) |
| Listing icon | `images/icon2.png` (128×128 PNG) | Top-level `icon` in `package.json` |

### 1. Create the Marketplace publisher

1. Sign in at <https://marketplace.visualstudio.com/manage> with the identity
   you will publish with (Microsoft account or Entra ID).
2. Choose **Create publisher**, enter ID `parallelno` and a unique display name.
3. Accept the publisher agreement and choose **Create**.

- The **ID** is permanent and forms the first half of every extension ID.
- The **Name** must be unique in the Marketplace. The extension `name` and
  `displayName` are also Marketplace-wide unique; if `v6vscode` or
  `Vector-06c Development` is already taken, change it before the first publish.
- If the page already lists `parallelno` but you cannot manage it, you are signed
  in with a different identity than the one that created it.
- If `parallelno` is not available to your account, pick another ID and change
  `publisher` in `package.json` **before the first publish**. The publisher ID and
  extension `name` cannot be changed later without creating a completely new
  extension (losing installs, reviews and the existing ID).
- Official docs verify a new publisher with `npx vsce login parallelno` (PAT
  prompt) after creating the PAT; either order works. With Entra ID,
  authorization is membership of the publisher with the **Contributor** role,
  as described next.

### 2. Authenticate: Microsoft Entra ID (recommended) or legacy PAT

Azure DevOps **global PATs are retired on 2026-12-01**. The official guidance is
[Microsoft Entra ID authentication](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
with workload identity federation and managed identities. `vsce` supports this
through `--azure-credential`.

#### Microsoft Entra ID (recommended)

Local/interactive publishing:

1. Install the Azure CLI (`az`), or use Azure PowerShell (`Connect-AzAccount`) or
   the Azure Developer CLI (`azd auth login`). `vsce` also accepts environment
   credentials and managed identities.
2. Sign in with the identity that should publish: `az login` (add
   `--tenant <tenant id>` if needed), then confirm with `az account show`.
3. In the [Marketplace management page](https://marketplace.visualstudio.com/manage),
   open the `parallelno` publisher and make sure that identity is a member with
   the **Contributor** role (the account that created the publisher already is).
   The official managed-identity flow grants the same role; the authorization
   model is identical for a user identity.
4. Publish:

   ```powershell
   npm run publish:marketplace:entra
   # equivalent to: node scripts/publish.cjs --publish --azure-credential
   ```

`vsce` 3.7.1 (pinned here) resolves credentials in this order:
`EnvironmentCredential`, `AzureCliCredential`, `ManagedIdentityCredential`
(honoring `AZURE_CLIENT_ID`), `AzurePowerShellCredential`, and
`AzureDeveloperCliCredential`. It requests an Azure DevOps token, so no PAT is
stored. If `VSCE_PAT` is also set, the script removes it for the publish call so
Entra ID is actually used.

If the publisher was created with a personal Microsoft account and you do not
have an Entra tenant, create or use one you can access, sign in with that Entra
identity, and add it to the publisher as a **Contributor**. That identity is
what replaces the PAT after 2026-12-01.

CI/managed identity (the official flow; the managed identity requires an Azure
subscription):

1. In Azure DevOps **Project Settings > Service Connections**, create an
   **Azure Resource Manager** connection using **Workload Identity Federation
   (manual)** and save it in draft mode.
2. Create a **user-assigned managed identity** in Azure, assign the **Reader**
   role, and record the client ID, tenant ID and subscription.
3. Add a **federated credential** to the identity and exchange the issuer and
   subject (Azure DevOps → Azure) and client/tenant/subscription (Azure → Azure
   DevOps), then choose **Verify and save**.
4. Grant the publishing pipelines access to the service connection.
5. Retrieve the identity resource ID with an `AzureCLI@2` task running
   `az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798`.
6. Add that identity to the publisher as a member with the **Contributor** role.
7. Configure the pipeline; in an `AzureCLI@2` task with the service connection,
   run `vsce publish --azure-credential` (install dependencies first).

#### Legacy PAT (only until 2026-12-01)

1. Sign in at <https://dev.azure.com> with the **same identity** that owns the
   publisher. Create a free organization if none exists.
2. Open **User settings > Personal access tokens > New Token**.
3. Name it (for example `v6vscode-marketplace`), choose the shortest practical
   expiry, and set **Organization** to **All accessible organizations**.
4. Choose **Custom defined**, enable **Show all scopes**, then enable
   **Marketplace > Manage** (this scope includes publishing). Grant nothing else.
5. Create the token and copy it immediately; Azure DevOps never shows it again.

The identity behind the PAT must be authorized for the publisher. A personal
Microsoft account is the simplest choice: a work/school PAT can be blocked by
conditional-access policy, and a PAT from an unrelated organization cannot
publish your extension. This mismatch is the first thing to check on a 401/403.
You can verify a PAT-based publisher with `npx vsce login parallelno`; that
stores the PAT in the OS credential store, while this repository's script reads
`VSCE_PAT` from the environment instead.

Treat a PAT as a password: never commit it, never put it in `.env`, and do not
add it to CI secrets without an explicit review. Revoke and replace it from the
same page if it leaks. It stops working on 2026-12-01 regardless of expiry. The
script reads `VSCE_PAT` from the environment and does not rely on `vsce login`
cached credentials.

### 3. Prepare the repository and listing

- `repository`, `license`, `displayName`, `description`, `categories`,
  `keywords` and `icon` are already set in `package.json`. The listing icon is
  the 128×128 PNG `images/icon2.png`; only that file from `images/` ships (the
  other artwork there is source material). `res/images/icon.png` remains the
  Activity Bar container icon used at runtime. The official requirement is a
  PNG of **at least 128×128px** included in the extension.
- `name` and `displayName` must be unique Marketplace-wide (see section 1).
- `README.md` becomes the Marketplace description and `LICENSE` is required by
  `vsce`; both are present. `CHANGELOG.md` and `SUPPORT.md` are optional.
  Review the README install instructions after the first publish.
- Marketplace image constraints enforced by `vsce`: the `icon` may not be an
  SVG; README/CHANGELOG image URLs must be `https`; user-provided SVG images and
  badges are rejected unless they come from an
  [approved badge provider](https://code.visualstudio.com/api/references/extension-manifest#approved-badges).
  Our only badge uses `img.shields.io`, which is approved.
- At most **30 keywords** are allowed (`package.json` currently has 8).
- Keep the GitHub repository public if possible: relative README links and
  images are resolved against `repository.url`, so a private repository gives
  Marketplace visitors broken documentation links. The listing itself works
  either way.
- The **verified publisher** badge has real prerequisites (official): at least
  one extension on the Marketplace for **6 months**, a domain registered for at
  least **6 months**, a non-subdomain HTTPS domain that answers `HEAD` with
  HTTP 200, and a DNS TXT record. Marketplace review can take up to 5 business
  days, and changing the publisher display name revokes the badge. It is
  optional and not required to publish.

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
outside this repository's publish script and release gate.

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

Never run untrusted pull requests on that runner. Do not store `VSCE_PAT` as a
repository secret; for automated publishing use Entra ID with workload identity
federation or a managed identity as described in the official secure publishing
flow. The actual publish stays local and manual here.

## Local prerequisites

| Requirement | Purpose |
|---|---|
| Node.js 22 or later and `npm ci` | The pinned `@vscode/vsce` and the build/test toolchain |
| Azure CLI (`az`) signed in, or Azure PowerShell/azd | **Entra ID publishing (recommended)** |
| Entra identity added to publisher as **Contributor** | Authorization for Entra ID publishing |
| `VSCE_PAT` environment variable | Legacy PAT only; stops working on 2026-12-01 |
| `V6EMUL` environment variable | Debugger-enabled emulator for the mandatory `verify:release` gate |
| `code` CLI on `PATH` | Installing and smoke-testing the packaged VSIX |
| Clean Git working tree | The published VSIX must correspond to a committed revision |

### vsce installation

The official quick start uses a global install
(`npm install -g @vscode/vsce`). This repository instead pins
`@vscode/vsce` **3.7.1** in `devDependencies` (the official CI guidance also
recommends a devDependency), and `npm ci` installs it locally. The publish
script, `npm run package`, and the `npx vsce ...` commands below resolve that
local binary, so a global install is unnecessary and is not used by the script.
Avoid mixing a global and local `vsce` version.

### Session setup

Entra ID (recommended) — no token environment variable:

```powershell
az login          # add --tenant <tenant id> if required
az account show
$env:V6EMUL = 'C:\Work\Programming\v6emul\build\release\app\Release\v6emul.exe'
```

```bash
az login
az account show
export V6EMUL=/path/to/v6emul
```

Legacy PAT (until 2026-12-01):

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

`package.json` is the single source of truth. The official `vsce publish`,
`vsce publish minor` and `vsce publish 1.1.0` forms modify `package.json` and,
inside a Git repository, create a commit and tag through `npm version`. This
repository deliberately keeps versioning and publishing separate so that the
verified commit and VSIX cannot change at publish time. Bump and tag first:

```powershell
npm version patch -m "Release %s"   # or minor / major
git push --follow-tags
```

### Pre-release versions

The official rules:

- Only `major.minor.patch` is supported. Semver pre-release tags such as
  `0.2.0-beta.1` are **not** supported.
- Pre-release and regular release versions must be distinct. If `1.2.3` is
  uploaded as a pre-release, the next regular release needs a different version,
  for example `1.2.4`.
- VS Code recommends `major.EVEN_NUMBER.patch` for releases and
  `major.ODD_NUMBER.patch` for pre-releases (`0.2.*` stable, `0.3.*`
  pre-release). Pre-release extensions require `engines.vscode >= 1.63.0`
  (this extension declares `^1.90.0`).
- `--pre-release` must be passed to **both** `vsce package` and `vsce publish`;
  the script does both. A pre-release publish of a normally packaged VSIX is
  rejected.

```powershell
npm run publish:marketplace:entra -- --pre-release
```

`0.1.0` is a stable-only line. If you start using pre-releases, move stable
releases to the `0.2.*` line and pre-releases to `0.3.*` as recommended.

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

# Authentication: Entra ID (recommended)
az login
az account show

# or legacy PAT until 2026-12-01:
# $secure = Read-Host -AsSecureString 'Marketplace PAT'
# $env:VSCE_PAT = [System.Net.NetworkCredential]::new('', $secure).Password

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
# Entra ID (recommended)
npm run publish:marketplace:entra

# Legacy PAT until 2026-12-01
# npm run publish:marketplace
```

This re-runs `verify:release`, re-packages, re-validates, and only then uploads
the exact validated VSIX. With `--azure-credential` the script removes any
`VSCE_PAT` from the child environment because `vsce` would otherwise prefer the
PAT. Success prints `Published parallelno.v6vscode@0.1.0` and the item URL. If
it fails before the upload, nothing was published and you can fix and rerun. If
it fails during the upload, check the management page before retrying: the
version may already have been accepted, and a retry would produce a
duplicate-version error.

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
npm run publish:marketplace:entra
```

For a pre-release, bump to a distinct plain `x.y.z` (see the official even/odd
minor recommendation), push it, and append `-- --pre-release` to
`npm run publish:marketplace:entra`. Users must opt in to pre-release versions
in VS Code.

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
npm run publish:marketplace:entra   # Entra ID (recommended)
# or, legacy until 2026-12-01: npm run publish:marketplace
```

This is the same pipeline as the dry run, with two additional fail-closed
requirements before any work starts: an authentication method (`--azure-credential`
or legacy `VSCE_PAT`) and `V6EMUL` pointing to a real executable (the full
`verify:release` gate cannot be skipped silently). After packaging and VSIX
validation, the script publishes the exact validated bytes:

```text
vsce publish --packagePath temp/publish/v6vscode-<version>.vsix [--azure-credential]
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
az login                               # Entra ID; or set VSCE_PAT
npm version patch -m "Release %s"
git push --follow-tags
npm run publish:dry-run -- --verify    # optional but recommended
npm run publish:marketplace:entra
```

## Options

| Option | Effect |
|---|---|
| `--publish` | Publish after verification and validation. Requires Entra ID or `VSCE_PAT`. |
| `--azure-credential` | Use Microsoft Entra ID (`vsce --azure-credential`); official recommendation. |
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
  "auth": "none",
  "extension": "parallelno.v6vscode",
  "version": "0.1.0",
  "commit": "<HEAD sha>",
  "verified": "ci",
  "vsix": {
    "path": "temp/publish/v6vscode-0.1.0.vsix",
    "entries": 290,
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
| `Publishing requires authentication` | Run `az login` and use `--azure-credential` (recommended), or set the legacy `VSCE_PAT` until 2026-12-01. |
| `Can not acquire a Microsoft Entra ID access token` | Sign in with `az login` (or `Connect-AzAccount`/`azd auth login`); check the tenant/subscription and `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`. `vsce` tries environment, Azure CLI, managed identity, Azure PowerShell, then azd credentials. |
| Entra ID publishes as the wrong identity | Add the exact identity to the publisher under **Members** with the **Contributor** role, and clear any conflicting `VSCE_PAT`. |
| `401`/`403` from the Marketplace | Official causes: the PAT's **Organization** was not **All accessible organizations**, or its scope is not **Marketplace > Manage**; for Entra, the identity lacks publisher membership/Contributor. |
| `TF400813` / sign-in rejected | The legacy PAT belongs to a different identity or organization than the publisher. Recreate it with the same account. |
| PAT stopped working after 2026-12-01 | Global PATs are retired. Migrate to `--azure-credential`; do not recreate the PAT. |
| Conditional access or MFA blocks token creation | Use Entra ID instead of a PAT, or ask your administrator to permit the flow. |
| `already exists` / name or display name exists | The `version` is already published, or `name`/`displayName` is already used Marketplace-wide. Bump the version or choose unique values. |
| Publisher/extension ID mismatch | `publisher` must equal the publisher ID exactly; publisher IDs and extension `name` are permanent. |
| Public page 404 right after publish | Marketplace ingestion delay; check the manage page before changing anything. |
| Generic icon or rejected icon | The icon must be a PNG (no SVG) of at least 128×128px and included in the package; `images/icon2.png` is configured. |
| README/CHANGELOG images rejected | Use `https` URLs; user-provided SVG images/badges must come from an approved badge provider (`img.shields.io` is approved). |
| More than 30 keywords | The Marketplace rejects a package with more than 30 `keywords` (`package.json` has 8). |
| `Publishing requires V6EMUL` | Set `V6EMUL`, or use `--skip-verify` for an intentional hotfix. |
| `Cannot use '--pre-release' flag` | Package and publish must both use the flag; run through the script with `--pre-release`. |
| `doesn't support prerelease versions` | Use a plain `x.y.z`; semver pre-release tags are unsupported. |
| `The VSIX is missing ...` | Run `npm run compile`; check that `.vscodeignore` did not exclude a runtime resource. |
| `EPERM`/file lock on the VSIX | Close Explorer/VS Code previews of the file and retry. |
| `README` images or links are broken | Relative links are resolved from `repository.url` (public GitHub repos work best); keep docs links repository-relative. |

## Unpublishing, removing and deprecating

Official terms differ; prefer publishing a fixed higher version.

- **Unpublish** (management page: **More Actions > Unpublish**) hides the
  extension from the Marketplace and VS Code but preserves its statistics; the
  extension remains publicly discoverable through an existing API.
- **Remove the extension** (`npx vsce unpublish parallelno.v6vscode` or
  management page: **More Actions > Remove**) is **irreversible**, deletes the
  statistics, and permanently reserves the extension name. It prompts you to
  type the extension name to confirm.
- **Remove a specific version**: management page > **More Actions > Reports** >
  **Manage** > **Delete this version**. This is irreversible, cannot delete the
  latest version, and the version number can never be reused.
- **Deprecate** instead of deleting: request it in the
  [Deprecated extensions](https://github.com/microsoft/vscode-discussions/discussions/1)
  thread. VS Code shows a deprecation warning and, when applicable, a
  **Migrate** button; installed copies are not removed.
- Unpublishing/removing does not uninstall existing copies. If a bad release
  shipped, publish a fixed higher version promptly.

Authenticated removal (this removes the whole extension, not one version):

```powershell
npx vsce unpublish parallelno.v6vscode --azure-credential
# legacy PAT: set VSCE_PAT and omit --azure-credential
```

## Automation boundary

Publishing stays manual. The existing workflows only verify:
`verification.yml` runs deterministic checks, and `release-verification.yml` is
manually dispatched on the trusted `v6emul` runner. For automated publishing,
use the official Entra ID flow (workload identity federation or managed
identity) rather than a stored PAT. Do not add `--publish` to a workflow without
an explicit, reviewed approval step.

The current `vsce` line also supports GitHub Actions **trusted publishing**
(`vsce publish --oidc`) after a trusted publishing policy is configured on the
Marketplace, with `permissions: id-token: write`. The pinned `@vscode/vsce`
3.7.1 does **not** support `--oidc`, and this repository has no publish
workflow; adopting it requires upgrading `vsce` and a separate security review.

## References

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
  (official page, DateApproved 2026-10-14)
- [Secure automated publishing to Visual Studio Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
- [Retirement of global Personal Access Tokens in Azure DevOps](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/)
- [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce) and its trusted publishing section
- [Extension manifest: icon and approved badges](https://code.visualstudio.com/api/references/extension-manifest#approved-badges)
- [Automated publishing in CI](https://code.visualstudio.com/api/working-with-extensions/continuous-integration#automated-publishing)
