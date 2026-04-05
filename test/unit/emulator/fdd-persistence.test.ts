import { expect } from 'chai';
import { FddPersistence } from '../../../src/emulator/persistence/fdd-persistence';

function makeLogger() {
    const logs: string[] = [];
    return {
        error: (msg: string) => logs.push(`error: ${msg}`),
        warn: (msg: string) => logs.push(`warn: ${msg}`),
        info: (msg: string) => logs.push(`info: ${msg}`),
        debug: (msg: string) => logs.push(`debug: ${msg}`),
        dispose: () => {},
        logs,
    } as any;
}

function makeMockClient(opts: {
    connected?: boolean;
    fddInfo?: { ok: boolean; data?: any };
    fddImage?: { ok: boolean; data?: any };
} = {}) {
    const sent: Array<{ cmd: number; data?: unknown }> = [];
    return {
        connected: opts.connected ?? true,
        send: async (cmd: number, data?: unknown) => {
            sent.push({ cmd, data });
            // GET_FDD_INFO = 24, GET_FDD_IMAGE = 25
            if (cmd === 24) { return opts.fddInfo ?? { ok: false }; }
            if (cmd === 25) { return opts.fddImage ?? { ok: false }; }
            return { ok: true };
        },
        sent,
    } as any;
}

describe('FddPersistence', () => {
    describe('persistIfNeeded', () => {
        it('should skip when fddReadOnly is true', async () => {
            const logger = makeLogger();
            const client = makeMockClient();
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(true, 'out/game.fdd');

            expect(client.sent).to.have.length(0);
            expect(logger.logs.some((l: string) => l.includes('fddReadOnly=true'))).to.be.true;
        });

        it('should skip when executable is not .fdd', async () => {
            const logger = makeLogger();
            const client = makeMockClient();
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(false, 'out/game.rom');

            expect(client.sent).to.have.length(0);
            expect(logger.logs.some((l: string) => l.includes('not an FDD'))).to.be.true;
        });

        it('should skip when client not connected', async () => {
            const logger = makeLogger();
            const client = makeMockClient({ connected: false });
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(false, 'out/game.fdd');

            expect(client.sent).to.have.length(0);
            expect(logger.logs.some((l: string) => l.includes('not connected'))).to.be.true;
        });

        it('should skip when drive is not mounted', async () => {
            const logger = makeLogger();
            const client = makeMockClient({
                fddInfo: { ok: true, data: { mounted: false, updated: false } },
            });
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(false, 'out/game.fdd');

            expect(client.sent).to.have.length(1); // Only GET_FDD_INFO
        });

        it('should skip when drive is not modified', async () => {
            const logger = makeLogger();
            const client = makeMockClient({
                fddInfo: { ok: true, data: { mounted: true, updated: false } },
            });
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(false, 'out/game.fdd');

            expect(client.sent).to.have.length(1); // Only GET_FDD_INFO
            expect(logger.logs.some((l: string) => l.includes('not modified'))).to.be.true;
        });

        it('should handle GET_FDD_INFO failure gracefully', async () => {
            const logger = makeLogger();
            const client = makeMockClient({
                fddInfo: { ok: false },
            });
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(false, 'out/game.fdd');

            expect(client.sent).to.have.length(1);
            expect(logger.logs.some((l: string) => l.includes('not available'))).to.be.true;
        });
    });
});
