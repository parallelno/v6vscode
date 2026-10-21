# Publishing

> Official reference: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

## Quick start

### One-time prerequisites

- Node.js 22 or later, then `npm ci`.
- Azure CLI signed in with `az login` (or Azure PowerShell `Connect-AzAccount`,
  or `azd auth login`). The identity must be a **Contributor** on the
  `parallelno` publisher.
- `V6EMUL` set to a debugger-enabled emulator executable.

If the publisher was created with a personal Microsoft account and has no Entra
tenant, create or use an Entra tenant and add that identity to the publisher as
a Contributor.

### Publish a release

Run from the repository root on an up-to-date `main` with a clean working tree:

```powershell
git switch main
git pull
```

1. **Version and tag** — this is the versioning step. Skip it only for the first
   publish of the already-set `0.1.0`.

   ```powershell
   npm version patch -m "Release %s"   # or minor / major
   git push --follow-tags
   ```

   `npm version` updates `package.json` and `package-lock.json`, creates the
   release commit, and creates the tag.

2. **Install and authenticate**

   ```powershell
   npm ci
   az login
   az account show
   ```

3. **Verify without publishing**

   ```powershell
   npm run publish:dry-run -- --verify
   ```

   Expect exit code 0, a validated `temp/publish/v6vscode-<version>.vsix`, its
   SHA-256, and `No publication was performed (dry run)`. Nothing is uploaded.

4. **Smoke-test the exact artifact**

   ```powershell
   code --install-extension temp\publish\v6vscode-0.1.0.vsix --force
   ```

   Open an empty folder, run **V6: Create Project** (ASM/ROM), build with
   `make`, run **V6: Run Project**, and check a debug session.

5. **Publish**

   ```powershell
   npm run publish:release
   ```

   This re-runs the full release gate, re-packages, re-validates, and uploads
   the exact validated VSIX with Entra ID. Success prints
   `Published parallelno.v6vscode@<version>` and the Marketplace URL.

6. **Verify the listing**

   - Manage: <https://marketplace.visualstudio.com/manage/publishers/parallelno>
   - Item: <https://marketplace.visualstudio.com/items?itemName=parallelno.v6vscode>
   - Install: `code --install-extension parallelno.v6vscode`
   - Ingestion usually takes 5–15 minutes. Check the manage page before
     changing anything.
   - Update the README **Quick Start** from the `.vsix` install to the
     Marketplace install once the item is live.

### First publish (0.1.0)

`package.json` is already `0.1.0`, so do not run `npm version`. Tag the release
commit instead, then follow steps 2–6 above:

```powershell
git tag -a v0.1.0 -m "v6vscode 0.1.0"
git push origin v0.1.0
```

### Subsequent releases

```powershell
git switch main
git pull
npm ci
npm version patch -m "Release %s"   # versioning step
git push --follow-tags
npm run publish:dry-run -- --verify
npm run publish:release
```

### Pre-release

Use a distinct plain `x.y.z` version — semver pre-release tags such as
`0.3.0-beta.1` are not supported. VS Code recommends even minor versions for
releases and odd minor versions for pre-releases (`0.2.*` stable, `0.3.*`
pre-release). Pre-releases require `engines.vscode >= 1.63.0`; this extension
declares `^1.90.0`.

```powershell
npm version 0.3.0 -m "Release %s"
git push --follow-tags
npm run publish:dry-run -- --verify
npm run publish:release -- --pre-release
```

The script passes `--pre-release` to both packaging and publishing. Users must
opt in to pre-release versions in VS Code.

## One-time setup (details)

### Publisher

| Item | Value |
|---|---|
| Marketplace publisher ID | `parallelno` (permanent) |
| Extension ID | `parallelno.v6vscode` |
| Marketplace management | <https://marketplace.visualstudio.com/manage> |

1. Sign in with the identity that will publish and choose **Create publisher**.
   Enter ID `parallelno` and a unique display name; accept the agreement.
2. The publisher **ID** cannot change. The publisher **Name**, extension
   `name`, and `displayName` are unique Marketplace-wide; if `v6vscode` or
   `Vector-06c Development` is taken, change it before the first publish.
3. Once created, open the publisher and make sure the publishing identity is a
   member with the **Contributor** role.

If the manage page lists `parallelno` but you cannot manage it, you are signed in
with a different identity than the publisher owner.

### Microsoft Entra ID authentication

Local/interactive:

1. Install the Azure CLI, or use Azure PowerShell or `azd`.
2. Sign in: `az login` (add `--tenant <tenant id>` if needed), then
   `az account show`.
3. Ensure the identity is a Contributor on `parallelno` (see above).
4. Publish with `npm run publish:release`.

`vsce` 3.7.1 (pinned here) tries credentials in this order:
`EnvironmentCredential`, `AzureCliCredential`, `ManagedIdentityCredential`
(honoring `AZURE_CLIENT_ID`), `AzurePowerShellCredential`, and
`AzureDeveloperCliCredential`. It requests an Azure DevOps token, so no token
file is stored.

CI/managed identity (official flow, summarized; the managed identity requires an
Azure subscription):

1. Azure DevOps **Project Settings > Service Connections** → new **Azure
   Resource Manager** connection using **Workload Identity Federation (manual)**.
2. Create a user-assigned managed identity in Azure, assign **Reader**, and
   record client ID, tenant ID, and subscription.
3. Add a federated credential and exchange issuer/subject with Azure DevOps and
   client/tenant/subscription with Azure, then **Verify and save**.
4. Grant the publishing pipelines access to the service connection.
5. Retrieve the identity resource ID with an `AzureCLI@2` task:
   `az rest -u https://app.vssps.visualstudio.com/_apis/profile/profiles/me --resource 499b84ac-1321-427f-aa17-267ca6975798`.
6. Add the identity to the publisher as a **Contributor**.
7. In an `AzureCLI@2` task, install dependencies and run
   `vsce publish --azure-credential`.

### Listing and Marketplace constraints

- `icon`: `images/icon.png`, a 128×128 PNG included in the package. `vsce`
  rejects SVG icons; the Marketplace requires at least 128×128px.
- `README.md` is the listing description; `LICENSE` is required.
  `CHANGELOG.md` and `SUPPORT.md` are optional.
- README/CHANGELOG image URLs must be HTTPS. User-provided SVG images and
  badges are rejected unless they come from an
  [approved badge provider](https://code.visualstudio.com/api/references/extension-manifest#approved-badges).
  This README uses `img.shields.io`, which is approved.
- At most 30 `keywords` are allowed (`package.json` has 8).
- Keep the GitHub repository public so relative README links and images resolve
  against `repository.url`.
- **Verified publisher** badge (optional): at least one extension on the
  Marketplace for 6 months, a domain registered for 6 months, a non-subdomain
  HTTPS domain answering `HEAD` with HTTP 200, and a DNS TXT record. Review can
  take up to 5 business days; changing the publisher display name revokes it.

### Tooling (`vsce`)

The official quick start installs `vsce` globally
(`npm install -g @vscode/vsce`). This repository pins `@vscode/vsce` **3.7.1**
in `devDependencies` (the official CI guidance also recommends a devDependency),
and `npm ci` installs it locally. The scripts use that local binary. A global
install is optional and is not used by the publish scripts; avoid mixing versions.

### Hosting options

| Host | Who it serves | Status |
|---|---|---|
| VS Code Marketplace | Normal VS Code users | Primary target; automated here |
| GitHub Releases | Offline/side-load users | Optional; attach the validated VSIX to the tag |
| Open VSX | VSCodium, Theia, Gitpod | Optional; separate account/token; **not** automated here |
| Internal file share | Private distribution | Optional; `code --install-extension <vsix>` |

Open VSX is a separate registry with its own terms. After creating an account
and claiming the `parallelno` namespace, publish the validated file manually:

```powershell
npx ovsx publish temp/publish/v6vscode-0.1.0.vsix -p $env:OVSX_PAT
```

### Optional trusted CI gate

`release-verification.yml` is manual and never publishes:

1. Register a trusted Windows x64 self-hosted runner with labels `self-hosted`,
   `Windows`, `X64`, and `v6emul`.
2. Add repository variable `V6EMUL` with the emulator path on that runner.
3. Run **Actions > Shipped release verification > Run workflow** and require the
   uploaded report to pass before publishing.

For automated publishing, use the official Entra ID flow above; do not store
long-lived credentials. GitHub trusted publishing (`vsce publish --oidc`) exists in the current
`vsce` line but is not supported by pinned 3.7.1 and is not wired here.

## What the publish scripts do

`npm run publish` stops after step 4. `npm run publish:release` continues with
step 5 and publishes.

1. **Preflight** — required manifest fields, repository URL, `engines.vscode`,
   plain `x.y.z` version, `README`/`LICENSE`, no `*` activation event, clean Git
   tree, `main`/tag warnings, and `V6EMUL` when verification runs.
2. **Full release gate** — `npm run verify:release`: CI, test typecheck, packaged
   VSIX tests on current and minimum VS Code, and mandatory live conformance.
3. **Package** — `temp/publish/v6vscode-<version>.vsix` with the pinned local
   `@vscode/vsce`.
4. **Validate the VSIX** — required runtime files (including the manifest icon),
   no development files/source maps/logs, packaged `name`, `publisher`,
   `version`, `main`, `engines.vscode` and `icon` matching `package.json`, and
   the pre-release marker matching `--pre-release`.
5. **Publish the exact bytes** —
   `vsce publish --packagePath temp/publish/v6vscode-<version>.vsix --azure-credential`
   (plus `--pre-release` when requested).
6. **Report** — writes `temp/publish-report.json` with the commit, stage exits,
   VSIX path/entry count/SHA-256, auth method, and result.

It does not bump the version, commit, tag, or push. For the release command it
strips `VSCE_*` environment variables so `vsce` can only use Entra ID.

`--skip-verify` exists only for an intentional hotfix; the report records
`"verified": "skipped"` and the script warns loudly.

## Versioning rules

- `package.json` is the single source of truth. Always bump before a new
  publish; published versions are immutable and a version number can never be
  reused, even after deletion.
- Use `npm version patch|minor|major -m "Release %s"` (or an explicit version).
  It updates `package.json` and `package-lock.json`, creates the release commit,
  and creates the tag. Push with `git push --follow-tags`.
- The official `vsce publish <version>` / `vsce publish minor` forms also bump
  and tag, but this workflow deliberately separates versioning from publishing
  so the verified commit and VSIX cannot change during upload.
- Pre-releases: only `major.minor.patch` is supported (no `-beta` tags),
  release and pre-release versions must differ, and VS Code recommends even
  minor for releases / odd minor for pre-releases (`0.2.*` stable, `0.3.*`
  pre-release). `engines.vscode >= 1.63.0` is required (here `^1.90.0`).

## Command reference

| Command | Purpose |
|---|---|
| `npm run publish` | Default dry run: `ci`, package, validate. No upload. |
| `npm run publish:dry-run` | Alias of `npm run publish`. |
| `npm run publish:release` | Full gate, package, validate, then publish with Entra ID. |
| `npm run publish -- --verify` | Full `verify:release` gate in a dry run. |
| `npm run publish:release -- --pre-release` | Publish marked as a pre-release. |
| `npm run publish:release -- --skip-verify` | Emergency hotfix publish without verification. |
| `npm run publish -- --out <dir>` | Change the package output directory. |
| `node scripts/publish.cjs --help` | All script flags. |

Do not run `vsce publish` manually for a release: it would bypass the version
check, VSIX validation, and audit report. `npm run publish:release` always uses
Entra ID; no `--azure-credential` flag is needed on the npm command.

## Release report

Every dry run or publish writes `temp/publish-report.json` (git-ignored):

```json
{
  "mode": "publish",
  "auth": "entra-id",
  "extension": "parallelno.v6vscode",
  "version": "0.1.0",
  "commit": "<HEAD sha>",
  "verified": "verify:release",
  "vsix": {
    "path": "temp/publish/v6vscode-0.1.0.vsix",
    "entries": 290,
    "sha256": "<digest>"
  },
  "stages": [
    { "name": "verify:release", "exit": 0, "elapsedMs": 0 },
    { "name": "package", "exit": 0, "elapsedMs": 0 },
    { "name": "publish-marketplace", "exit": 0, "elapsedMs": 0 }
  ],
  "published": true,
  "success": true
}
```

Failures add an `error` string. Keep the report and the hashed VSIX with the
release record.

## Troubleshooting

| Symptom | Resolution |
|---|---|
| `The Git working tree is dirty` | Commit or stash; `git status --short`. The release commit must exist before packaging. |
| `Can not acquire a Microsoft Entra ID access token` | Run `az login` (or `Connect-AzAccount` / `azd auth login`). Check tenant/subscription and `AZURE_CLIENT_ID`/`AZURE_TENANT_ID` for managed identity. |
| Entra publishes as the wrong identity | Add the exact identity to `parallelno` as a **Contributor** and rerun `az login`. |
| `401`/`403` from the Marketplace | The Entra identity is not a publisher member/Contributor. |
| `Publishing requires V6EMUL` | Set `V6EMUL`, or use `--skip-verify` for an intentional hotfix. |
| `already exists` | The version is already published; bump with `npm version` and tag again. |
| `name`/`displayName` already exists | Marketplace-wide names must be unique; change `name`/`displayName` before the first publish. |
| Generic or rejected icon | `images/icon.png` must be a PNG ≥128×128 and included in the VSIX; `vsce` rejects SVG icons. |
| README/CHANGELOG images rejected | Use HTTPS URLs; SVGs only from approved badge providers (`img.shields.io` is approved). |
| More than 30 keywords | Remove keywords; the Marketplace limit is 30 (currently 8). |
| Public page 404 after publish | Ingestion delay (5–15 minutes); check the manage page before changing the version. |
| `Cannot use '--pre-release' flag` | Package and publish must both be pre-release; use `npm run publish:release -- --pre-release`. |
| `doesn't support prerelease versions` | Use a plain `x.y.z`; semver pre-release tags are unsupported. |
| `EPERM`/file lock on the VSIX | Close Explorer/VS Code previews of the VSIX and retry. |
| `HEAD is not tagged` warning | Tag the release commit (`npm version` creates it; for 0.1.0 use `git tag -a v0.1.0`). |

## Unpublishing, removing and deprecating

Prefer shipping a fixed higher version.

- **Unpublish** (management page: **More Actions > Unpublish**) hides the
  extension from the Marketplace and VS Code but preserves statistics; it
  remains discoverable through an existing API.
- **Remove the extension** (`npx vsce unpublish parallelno.v6vscode
  --azure-credential` or **More Actions > Remove**) is irreversible, deletes
  statistics, and permanently reserves the extension name.
- **Remove a specific version**: management page > **More Actions > Reports** >
  **Manage** > **Delete this version**. Irreversible; the latest version cannot
  be deleted and the version number can never be reused.
- **Deprecate** instead: request it in the
  [Deprecated extensions](https://github.com/microsoft/vscode-discussions/discussions/1)
  thread. Installed copies are not removed automatically.

Existing installations are not uninstalled by unpublishing/removing; publish a
fixed higher version if a bad release shipped.

## References

- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
  (official page, DateApproved 2026-10-14)
- [Secure automated publishing with Microsoft Entra ID](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)
- [Retirement of global Personal Access Tokens in Azure DevOps](https://devblogs.microsoft.com/devops/retirement-of-global-personal-access-tokens-in-azure-devops/)
- [`@vscode/vsce`](https://github.com/microsoft/vscode-vsce)
- [Extension manifest: icon and approved badges](https://code.visualstudio.com/api/references/extension-manifest#approved-badges)
- [Automated publishing in CI](https://code.visualstudio.com/api/working-with-extensions/continuous-integration#automated-publishing)
