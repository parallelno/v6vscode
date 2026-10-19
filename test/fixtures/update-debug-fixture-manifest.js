// Run after deliberately rebuilding the mandatory producer fixtures.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifestPath = path.join(__dirname, 'debug-fixtures.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const file of Object.keys(manifest.files)) {
    manifest.files[file] = crypto.createHash('sha256')
        .update(fs.readFileSync(path.join(__dirname, file))).digest('hex');
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
