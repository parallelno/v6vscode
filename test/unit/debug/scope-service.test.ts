import * as assert from 'assert';
import { ScopeService } from '../../../src/debug/adapter/scope-service';

describe('ScopeService', () => {
    it('orders semantic C scopes and keeps globals expensive', () => {
        const service = new ScopeService();
        const variables = [
            { id: 1, name: 'parameter', kind: 'parameter' },
            { id: 2, name: 'local', kind: 'local' },
            { id: 3, name: 'static', kind: 'static' },
            { id: 4, name: 'global', kind: 'global' },
        ];
        const metadata = {
            variablesAt: () => variables.slice(0, 3),
            scopes: { variables },
        } as any;
        const frame = { instructionPc: 0x1000 } as any;

        const scopes = service.scopes(metadata, frame);

        assert.deepStrictEqual(scopes.map(scope => scope.name), ['Parameters', 'Locals', 'Statics', 'Globals']);
        assert.strictEqual(scopes[0].variables[0].name, 'parameter');
        assert.strictEqual(scopes[3].variables[0].name, 'global');
        assert.strictEqual(scopes[3].expensive, true);
    });

    it('keeps generated struct offset constants out of Globals', () => {
        const service = new ScopeService();
        const variables = [
            { id: 1, name: 'hero', kind: 'global' },
            { id: 2, name: 'actor.update_ptr', kind: 'global', constValue: 0 },
            { id: 3, name: 'char.health', kind: 'global', constValue: 32 },
            { id: 4, name: 'SOME_CONST', kind: 'global', constValue: 5 },
            { id: 5, name: 'hero.end', kind: 'global' },
        ];
        const metadata = {
            variablesAt: () => [],
            scopes: { variables },
        } as any;

        const scopes = service.scopes(metadata, { instructionPc: 0x1000 } as any);

        assert.deepStrictEqual(
            scopes.find(scope => scope.kind === 'globals')!.variables.map(variable => variable.name),
            ['hero', 'SOME_CONST', 'hero.end'],
        );
    });
});