import { expect } from 'chai';
import {
    decodeScriptCollectionResponse,
    decodeScriptMutationResponse,
    decodeScriptRunOnceResponse,
    validateScriptInput,
} from '../../../src/debug/scripts/script-codec';
import { matchesScriptName } from '../../../src/debug/views/scripts-query';
import { ScriptLimits } from '../../../src/emulator/protocol/debug-models';

const limits: ScriptLimits = {
    maxNameBytes: 64,
    maxPathBytes: 256,
    maxSourceBytes: 1024 * 1024,
    maxRecords: 16,
    maxErrorBytes: 256,
    maxInstructionsPerRun: 100000,
    maxExecutionMilliseconds: 100,
};
const input = { name: 'Test Script 01', path: 'C:/scripts/test.lua', active: true };
const snapshot = {
    scriptId: 2,
    ...input,
    compilation: { status: 'compiled', error: null },
    runtime: { status: 'never_run', error: null },
};

describe('Scripts codec and query', () => {
    it('accepts valid wire inputs and authoritative responses', () => {
        expect(validateScriptInput(input, limits)).to.deep.equal(input);
        expect(decodeScriptMutationResponse({ updates: 3, script: snapshot }, limits))
            .to.deep.equal({ updates: 3, script: snapshot });
        expect(decodeScriptCollectionResponse({ updates: 3, scripts: [snapshot] }, limits))
            .to.deep.equal({ updates: 3, scripts: [snapshot] });
    });

    it('validates portable paths, UTF-8 limits, unions, order, and revisions', () => {
        expect(validateScriptInput({ ...input, path: '//server/share/test.lua' }, limits).path)
            .to.equal('//server/share/test.lua');
        expect(() => validateScriptInput({ ...input, path: 'relative.lua' }, limits)).to.throw('absolute');
        expect(() => validateScriptInput({ ...input, name: '' }, limits)).to.throw('empty');
        expect(() => validateScriptInput({ ...input, name: 'é'.repeat(33) }, limits)).to.throw('UTF-8');
        expect(() => decodeScriptCollectionResponse({ updates: 1, scripts: [snapshot, snapshot] }, limits))
            .to.throw('ordered by unique scriptId');
        expect(() => decodeScriptCollectionResponse({ updates: -1, scripts: [] }, limits)).to.throw('updates');
        expect(() => decodeScriptCollectionResponse({
            updates: 1,
            scripts: [{ ...snapshot, compilation: { status: 'compiled', error: 'wrong' } }],
        }, limits)).to.throw('compilation');
    });

    it('requires coherent Run Once runtime results', () => {
        expect(decodeScriptRunOnceResponse({
            scriptId: 2,
            succeeded: false,
            breakRequested: false,
            updates: 4,
            runtime: { status: 'error', error: 'budget exhausted' },
            error: 'budget exhausted',
        }, limits).runtime.status).to.equal('error');
        expect(() => decodeScriptRunOnceResponse({
            scriptId: 2,
            succeeded: true,
            breakRequested: false,
            updates: 4,
            runtime: { status: 'error', error: 'wrong' },
        }, limits)).to.throw('succeeded');
    });

    it('matches Name with substring and full-name wildcard semantics', () => {
        expect(matchesScriptName('Test Script 01', '')).to.equal(true);
        expect(matchesScriptName('Test Script 01', 'script')).to.equal(true);
        expect(matchesScriptName('Test Script 01', 'Test S*')).to.equal(true);
        expect(matchesScriptName('Test Scene', 'Test S*')).to.equal(true);
        expect(matchesScriptName('My Test Script', 'Test S*')).to.equal(false);
        expect(matchesScriptName('a.b', 'a.b')).to.equal(true);
        expect(matchesScriptName('axb', 'a.b')).to.equal(false);
    });
});
