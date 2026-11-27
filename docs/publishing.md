# Publishing

Run these steps from the repository root. Use an up-to-date `main` branch and a
clean working tree.

## 1. Update the branch

```powershell
git switch main
git pull
```
## 2. Bump the version and create the release tag

For a normal release, choose `patch`, `minor`, or `major`:

```powershell
npm version patch -m "Release %s"
git push --follow-tags
```

`pm version` updates the version field in both `package.json` and `package-lock.json`
to the new version number, creates a Git commit containing those changes, and
creates a Git tag for that version.

## 3. Manual Publish & Installation

* Run the command below. It will build, validate, test and store new VSIX in
`temp/publish/v6vscode-<version>.vsix`.
```powershell
npm run publish:dry-run -- --verify
```

* Manully upload VSIX to `https://marketplace.visualstudio.com/manage/publishers/`.

* Check listing
  - [Publisher management](https://marketplace.visualstudio.com/manage/publishers/AlexFedotovskikh)
  - [Extension listing](https://marketplace.visualstudio.com/items?itemName=AlexFedotovskikh.v6vscode)

* Once the listing is live, use the Marketplace install command:
```powershell
code --install-extension AlexFedotovskikh.v6vscode
```

## Publisher details

- Publisher ID: `AlexFedotovskikh`.
- Extension ID: `AlexFedotovskikh.v6vscode`.
- The release script writes `temp/publish-report.json`, including the commit, verification result, VSIX path and SHA-256, stage results, and publish status. Keep this report with the release record.
- Official reference: [Publishing VS Code Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)