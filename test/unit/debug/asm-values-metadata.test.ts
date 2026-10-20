import * as assert from 'assert';
import * as path from 'path';
import { loadDebugArtifact } from '../../../src/debug/metadata/debug-artifact-loader';
import { VariableService } from '../../../src/debug/adapter/variable-service';
import { CExpressionService } from '../../../src/debug/values/c-expression-service';
import { ScopeService } from '../../../src/debug/adapter/scope-service';
import { format } from '../../../src/debug/values/value-format';

describe('Assembler typed value metadata fixture', () => {
    it('uses real assembler DWARF word types for individual structs and pools', async () => {
        const fixture = path.resolve(__dirname, '../../fixtures/asm-values');
        const artifact = await loadDebugArtifact(path.join(fixture, 'main.elf'), path.join(fixture, 'main.rom'));
        const metadata = artifact.metadata!;
        assert.ok(metadata);
        const variables = metadata.scopes.variables;
        const instance = variables.find(variable => variable.name === 'instance')!;
        const pool = variables.find(variable => variable.name === 'pool')!;
        assert.strictEqual(instance.kind, 'global');
        assert.strictEqual(pool.kind, 'global');
        const type = metadata.typeOf(instance.typeOffset!)!;
        const word = type.members!.find(member => member.name === 'ptr')!.type!;
        assert.strictEqual(word.byteSize, 2);
        assert.strictEqual(word.signed, false);
        assert.strictEqual(metadata.typeOf(pool.typeOffset!)!.of, type);
        const context = {
            evalContext: () => ({ registers: {}, cfa: 0, frameBase: 0, addressSize: 2, readMemory: () => undefined, resolveAddress: () => 0 }),
            memory: { readBytes: async (_address: number, size: number) => new Uint8Array(size).fill(255) },
        } as any;
        const service = new VariableService();
        const value = (await service.evaluate(metadata, context, { pc: 0x100, registers: {} } as any, instance)).value;
        const fields = await service.children(context, value);
        assert.strictEqual(fields.find(field => field.name === 'ptr')!.value, '65535');
        assert.ok(format(value).includes('ptr = 65535'));
        const watch = await new CExpressionService().evaluateValue('instance.ptr', {
            resolve: () => ({ value }),
            read: (type, address) => service.readAt(context, type, address),
            resolveType: () => undefined,
        });
        assert.strictEqual(format(watch.value), '65535');
        const scopes = new ScopeService().scopes(metadata, { instructionPc: 0x100 });
        assert.deepStrictEqual(scopes.find(scope => scope.kind === 'parameters')!.variables, []);
        assert.deepStrictEqual(scopes.find(scope => scope.kind === 'globals')!.variables.map(variable => variable.name).sort(),
            ['byte_only', 'instance', 'pool']);
    });
});
