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

    it('resolves a macro definition when no ELF symbol exists', async () => {
        const macroService = new DebugSourceSymbolLinkService(
            symbols({ kind: 'missing' }, ['engine/common/v6_macros.asm']),
            async sourcePath => sourcePath.endsWith('v6_macros.asm')
                ? '.macro RAM_DISK_ON_BANK(ram_disk_port = RAM_DISK_PORT)\n\tret\n.endmacro\n'
                : undefined,
        );

        expect(await macroService.resolve('RAM_DISK_ON_BANK', { start: 0, length: 16 }, context))
            .to.deep.equal({ file: 'engine/common/v6_macros.asm', line: 1, column: 8, isStmt: false });
    });

    it('resolves a constant definition when no DWARF declaration exists', async () => {
        const constantService = new DebugSourceSymbolLinkService(
            symbols({ kind: 'missing' }, ['engine/common/v6_consts.asm']),
            async sourcePath => sourcePath.endsWith('v6_consts.asm')
                ? 'SCR_BUFF0_ADDR\t\t\t= 0x8000\n'
                : undefined,
        );

        expect(await constantService.resolve('SCR_BUFF0_ADDR', { start: 0, length: 14 }, context))
            .to.deep.equal({ file: 'engine/common/v6_consts.asm', line: 1, column: 1, isStmt: false });
    });

    it('prefers a label definition over a later macro match', async () => {
        const service = new DebugSourceSymbolLinkService(
            symbols({ kind: 'found', symbol }, ['a.asm', 'b.asm']),
            async sourcePath => sourcePath.endsWith('a.asm')
                ? '.macro target(x)\n\tret\n'
                : 'target:\n\tret\n',
        );

        const links = await service.links('jmp target', context);
        expect(links[0].target).to.deep.equal({ file: 'b.asm', line: 1, column: 1, isStmt: false });
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

    describe('struct definitions', () => {
        const structSource = [
            '.struct actor',
            'update_ptr: word',
            'status: byte',
            'pos_x: word',
            '.ends',
            '.struct char extends actor',
            'data_next_ptr: word',
            'health: byte',
            '.ends',
            'hero: char',
        ].join('\n');

        function missingSymbols(sourceFiles: string[]) {
            return {
                load: async () => {},
                resolveSymbol: () => ({ kind: 'missing' }),
                sourceFiles: () => sourceFiles,
                sourceAtExactAddress: () => undefined,
            } as any;
        }

        function structService() {
            return new DebugSourceSymbolLinkService(
                missingSymbols(['defs.asm']),
                async sourcePath => sourcePath.endsWith('defs.asm') ? structSource : undefined,
            );
        }

        it('resolves a struct definition when no ELF symbol exists', async () => {
            const links = await structService().links('lxi h, actor', context);
            expect(links[0].target).to.deep.equal({ file: 'defs.asm', line: 1, column: 9, isStmt: false });
        });

        it('resolves a generated field constant to its field line', async () => {
            const links = await structService().links('lxi h, actor.update_ptr', context);
            expect(links[0].target).to.deep.equal({ file: 'defs.asm', line: 2, column: 1, isStmt: false });
        });

        it('resolves inherited fields through the extends parent', async () => {
            const links = await structService().links('lxi h, char.pos_x', context);
            expect(links[0].target).to.deep.equal({ file: 'defs.asm', line: 4, column: 1, isStmt: false });
        });

        it('resolves label.field references to the instance label', async () => {
            const links = await structService().links('lxi h, hero.pos_x', context);
            expect(links[0].target).to.deep.equal({ file: 'defs.asm', line: 10, column: 1, isStmt: false });
        });

        it('does not resolve unknown fields or struct names', async () => {
            const service = structService();
            expect(await service.links('lxi h, char.unknown', context)).to.deep.equal([]);
            expect(await service.links('lxi h, char.pos_y', context)).to.deep.equal([]);
        });
    });
});