import { expect } from 'chai';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { prepareSymbolScript, replaceScriptSymbols } from '../../../src/debug/scripts/script-symbols';

describe('Script symbol substitution', () => {
    const symbols = [{ name: 'target', address: 0x1234 }, { name: 'counter', address: 0 }];

    it('replaces whole case-sensitive tokens and preserves comments, strings and numeric literals', () => {
        const protectedText = `-- target\r\n--[=[ target\n counter ]=]\n"target \\" counter" 'target' [==[target]==] 0xAB 1e3 target_more Target`;
        expect(replaceScriptSymbols(`target + counter\n${protectedText}`, symbols))
            .to.equal(`0x1234 + 0x0\n${protectedText}`);
        expect(replaceScriptSymbols('target + unknown', [])).to.equal('target + unknown');
    });

    it('accepts duplicate equal values and rejects ambiguous referenced names', () => {
        expect(replaceScriptSymbols('target', [...symbols, symbols[0]])).to.equal('0x1234');
        expect(() => replaceScriptSymbols('target', [...symbols, { name: 'target', address: 1 }])).to.throw('ambiguous');
        expect(replaceScriptSymbols('unknown', [...symbols, { name: 'target', address: 1 }])).to.equal('unknown');
    });

    it('generates immutable content-addressed copies without changing the original and checks source limits', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'v6-script-symbols-'));
        const source = path.join(dir, 'original.lua');
        const input = { name: 'test', path: source, active: false, useDebugSymbols: true };
        const limits = { maxSourceBytes: 1024, maxPathBytes: 4096 } as any;
        try {
            await writeFile(source, 'print(target) -- target\n');
            const prepared = await prepareSymbolScript(input, limits, path.join(dir, 'cache'), symbols);
            expect(prepared).to.have.all.keys('name', 'path', 'active');
            expect(await readFile(prepared.path, 'utf8')).to.equal('print(0x1234) -- target\n');
            expect(await readFile(source, 'utf8')).to.equal('print(target) -- target\n');
            const changed = await prepareSymbolScript(input, limits, path.join(dir, 'cache'), [{ name: 'target', address: 42 }]);
            expect(changed.path).not.to.equal(prepared.path);
            expect(await readFile(prepared.path, 'utf8')).to.equal('print(0x1234) -- target\n');
            expect((await prepareSymbolScript({ ...input, useDebugSymbols: false }, limits, dir, symbols)).path).to.equal(source);
            await writeFile(source, Buffer.from([0xFF]));
            let error: unknown;
            try { await prepareSymbolScript(input, limits, dir, symbols); } catch (caught) { error = caught; }
            expect(error).to.be.instanceOf(TypeError);
            await writeFile(source, 'target');
            try { await prepareSymbolScript(input, { ...limits, maxSourceBytes: 2 }, dir, symbols); }
            catch (caught) { error = caught; }
            expect(String(error)).to.include('maxSourceBytes');
        } finally { await rm(dir, { recursive: true, force: true }); }
    });
});