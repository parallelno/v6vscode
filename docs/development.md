# Development

## Building

```bash
npm install
npm run compile
```

## Packaging

```bash
npm run package          # produces v6vscode-<version>.vsix
```

The `.vscodeignore` file excludes `src/`, `test/`, `design/`, `temp/`, `docs/`, source maps, and other dev-only files from the packaged `.vsix`.

## Testing

```bash
npm test              # unit tests
npm run test:unit     # unit tests only
npm run test:regression  # regression suite
npm run test:all      # unit + regression
npm run ci            # compile + lint + test:all
```
