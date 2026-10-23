# Publishing

Publish the VS Code extension `AlexFedotovskikh.v6vscode` to the Marketplace.

## Prerequisites

One-time publish-related setup:

- `npm ci` - clean dependencies installation.
- `winget install Microsoft.AzureCLI` - Azure CLI installation.
- `az login --use-device-code --allow-no-subscriptions` - authentication setup,
   follow the instructions in the power shell, when press `Enter` on the question
   `Select a subscription and tenant (Type a number or Enter for no changes):`

If the publisher was created with a personal Microsoft account and has no Entra
tenant, create or use an Entra tenant and add that identity to the publisher as
a Contributor. See [Azure CLI installation](https://learn.microsoft.com/cli/azure/install-azure-cli).

## Publish a release

Run these steps from the repository root. Use an up-to-date `main` branch and a
clean working tree.

### 1. Update the branch

```powershell
git switch main
git pull
```
### 2. Bump the version and create the release tag

For a normal release, choose `patch`, `minor`, or `major`:

```powershell
npm version patch -m "Release %s"
git push --follow-tags
```

`pm version` updates the version field in both `package.json` and `package-lock.json`
to the new version number, creates a Git commit containing those changes, and
creates a Git tag for that version.

### 4. Run the release checks without publishing

```powershell
npm run publish:dry-run -- --verify
```

Continue only if it succeeds. The script should validate `temp/publish/v6vscode-`
`<version>.vsix`, report its SHA-256, and state that no publication occurred.

### 6. Publish

```powershell
npm run publish:release
```

This runs the release gate, packages and validates the VSIX, then publishes the
validated artifact using Microsoft Entra ID. Do not publish manually with
`vsce publish`, because that bypasses this repository's release checks.

A successful run reports `Published AlexFedotovskikh.v6vscode@<version>` and the
Marketplace URL.

### 7. Verify the Marketplace listing

- [Publisher management](https://marketplace.visualstudio.com/manage/publishers/AlexFedotovskikh)
- [Extension listing](https://marketplace.visualstudio.com/items?itemName=AlexFedotovskikh.v6vscode)

Marketplace ingestion usually takes 5–15 minutes.

TODO: Once the listing is live, update the README Quick Start to use the Marketplace install command:
```powershell
code --install-extension AlexFedotovskikh.v6vscode
```

## Publisher details

- Publisher ID: `AlexFedotovskikh`.
- Extension ID: `AlexFedotovskikh.v6vscode`.
- The release script writes `temp/publish-report.json`, including the commit, verification result, VSIX path and SHA-256, stage results, and publish status. Keep this report with the release record.
- Official reference: [Publishing VS Code Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)