const path = require('path');
const fs = require('fs');
const { ESLint } = require('eslint');

async function main() {
    const eslint = new ESLint();
    const results = await eslint.lintFiles(['src/**/*.ts']);
    const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/lint-warning-baseline.json'), 'utf8'));
    const failures = [];
    let warnings = 0;
    for (const result of results) {
        const file = path.relative(process.cwd(), result.filePath).replace(/\\/g, '/');
        const counts = {};
        for (const message of result.messages) {
            if (message.severity === 2) { failures.push(`${file}:${message.line}: ${message.message}`); }
            if (message.severity === 1) { warnings++; counts[message.ruleId] = (counts[message.ruleId] || 0) + 1; }
        }
        for (const [rule, count] of Object.entries(counts)) {
            if (count > (baseline[file]?.[rule] || 0)) { failures.push(`${file}: ${rule} warnings ${count} exceed baseline ${baseline[file]?.[rule] || 0}`); }
        }
    }
    const formatter = await eslint.loadFormatter('stylish');
    const output = formatter.format(results); if (output) { console.log(output); }
    console.log(`Lint ratchet: ${warnings} warnings; no per-file/rule increases allowed.`);
    if (failures.length) { throw new Error(failures.join('\n')); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });