import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import * as ts from 'typescript';
import { matchesScriptName } from '../../../src/shared/script-name-match';
import { allMemorySpaces, globalAddressMemoryLocation, memorySpaceGlobalAddress } from '../../../src/shared/memory-space';

describe('Shared browser-safe domain modules', () => {
    const queries = [['Test Script', 'test s*'], ['My Test Script', 'test s*'], ['a.b', 'a.b'], ['axb', 'a.b'], ['*', '***'], ['text', ''], ['[a]', '[a]']];

    function browserSource(name: string): string {
        const source = fs.readFileSync(path.join(process.cwd(), 'src/shared', `${name}.ts`), 'utf8');
        return `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: {
            module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2019,
        } }).outputText).toString('base64')}`;
    }

    it('runs the same script matching and address mapping exports in ESM as on the host', () => {
        const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { matchesScriptName } from ${JSON.stringify(browserSource('script-name-match'))};
            import { allMemorySpaces, globalAddressMemoryLocation, memorySpaceGlobalAddress } from ${JSON.stringify(browserSource('memory-space'))};
            console.log(JSON.stringify({ matches: ${JSON.stringify(queries)}.map(([name, query]) => matchesScriptName(name, query)),
                locations: allMemorySpaces().map(space => globalAddressMemoryLocation(memorySpaceGlobalAddress(space, 65535))) }));
        `], { encoding: 'utf8' });
        assert.deepStrictEqual(JSON.parse(result), {
            matches: queries.map(([name, query]) => matchesScriptName(name, query)),
            locations: allMemorySpaces().map(space => globalAddressMemoryLocation(memorySpaceGlobalAddress(space, 65535))),
        });
    });

    it('round-trips every bank edge and rejects invalid global addresses', () => {
        for (const space of allMemorySpaces()) {
            for (const offset of [0, 1, 65535]) { assert.deepStrictEqual(globalAddressMemoryLocation(memorySpaceGlobalAddress(space, offset)), { space, offset }); }
        }
        for (const value of [-1, 0x210000, NaN, 1.5]) { assert.throws(() => globalAddressMemoryLocation(value), RangeError); }
    });

    it('actual browser consumers import shared exports rather than retaining local algorithms', () => {
        const script = fs.readFileSync(path.join(process.cwd(), 'src/debug/views/assets/scripts.js'), 'utf8');
        const memory = fs.readFileSync(path.join(process.cwd(), 'src/debug/views/assets/memory-edits.js'), 'utf8');
        assert.ok(script.includes("out/webview/script-name-match.js'"));
        assert.ok(!script.includes('function matches('));
        assert.ok(memory.includes('globalAddressMemoryLocation(globalAddr)'));
        assert.ok(!memory.includes('Math.floor(globalAddr / 0x10000)'));
        for (const directory of ['src/debug/views/assets', 'src/emulator/panel/assets']) {
            for (const name of fs.readdirSync(path.join(process.cwd(), directory)).filter(name => name.endsWith('.js'))) {
                const text = fs.readFileSync(path.join(process.cwd(), directory, name), 'utf8');
                assert.ok(!/@ts-(?:ignore|nocheck)/.test(text), `${name} must be checked, not suppressed`);
            }
        }
    });
});