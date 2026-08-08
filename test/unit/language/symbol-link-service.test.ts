import { expect } from 'chai';
import {
    DebugSourceSymbolLinkService,
    SourceDocumentContext,
} from '../../../src/language/symbols/symbol-link-service';

describe('Source symbol link service', () => {
    const context: SourceDocumentContext = {
        projectRoot: 'C:\\project',
        debugArtifact: 'main.elf',
        executable: 'main.bin',
    };
    const symbol = { name: 'target', address: 0x1234, size: 1, type: 2, binding: 1 };

    function symbols(resolution: unknown, sourceFiles: string[] = []) {
        return {
            load: async () => {},
            resolveSymbol: (name: string) => name === 'target' ? resolution : { kind: 'missing' },
            sourceFiles: () => sourceFiles,
            sourceAtExactAddress: () => ({ file: 'fallback.asm', line: 9, column: 1, isStmt: true }),
        } as any;
    }

    it('resolves a unique symbol through an injected source reader', async () => {
        const service = new DebugSourceSymbolLinkService(
            symbols({ kind: 'found', symbol }, ['src/main.asm']),
            async () => 'target: ret',
        );

        expect(await service.links('jmp target', context)).to.deep.equal([{
            start: 4,
            length: 6,
            name: 'target',
            target: { file: 'src/main.asm', line: 1, column: 1, isStmt: false },
        }]);
    });

    it('does not link missing or ambiguous symbols', async () => {
        const missing = new DebugSourceSymbolLinkService(
            symbols({ kind: 'missing' }),
            async () => undefined,
        );
        const ambiguous = new DebugSourceSymbolLinkService(
            symbols({ kind: 'ambiguous', candidates: [symbol, symbol] }),
            async () => undefined,
        );

        expect(await missing.links('target', context)).to.deep.equal([]);
        expect(await ambiguous.links('target', context)).to.deep.equal([]);
    });

    it('rejects altered and partial symbol ranges', async () => {
        const service = new DebugSourceSymbolLinkService(
            symbols({ kind: 'found', symbol }),
            async () => undefined,
        );

        expect(await service.resolve('target', { start: 0, length: 5 }, context)).to.equal(undefined);
        expect(await service.resolve('changed', { start: 0, length: 6 }, context)).to.equal(undefined);
        expect(await service.resolve('target', { start: -1, length: 6 }, context)).to.equal(undefined);
    });
});