import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { validate } from '../../../src/project/validation/project-validator';
import { normalizeRun } from '../../../src/project/model/normalized-run';
import { DEFAULT_RUN_SETTINGS, LOAD_ADDRESS_PATTERN, SPEED_VALUES, VIEW_MODES } from '../../../src/shared/emulator-settings';
import { ProgramLoader } from '../../../src/emulator/session/program-loader';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { ProjectRepository } from '../../../src/project/persistence/project-repository';
import { ActiveProjectService } from '../../../src/project/active/active-project-service';

describe('Medium-term project/program contracts', () => {
    it('aligns schema defaults/enums/required fields with authoritative validation', () => {
        const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config/schemas/v6.project.schema.json'), 'utf8'));
        const run = schema.properties.run.properties;
        assert.deepStrictEqual(schema.required, ['name', 'run']); assert.deepStrictEqual(schema.properties.run.required, ['executable']);
        for (const [field, value] of Object.entries(DEFAULT_RUN_SETTINGS)) { assert.strictEqual(run[field].default, value); }
        assert.deepStrictEqual(run.speed.enum, Object.keys(SPEED_VALUES)); assert.deepStrictEqual(run.viewMode.enum, [...VIEW_MODES]);
        assert.strictEqual(run.loadAddr.pattern, LOAD_ADDRESS_PATTERN);
        assert.strictEqual(schema.properties.name.minLength, 1); assert.strictEqual(run.executable.minLength, 1);
        assert.strictEqual(schema.additionalProperties, false); assert.strictEqual(schema.properties.run.additionalProperties, false);
        for (const speed of [...Object.keys(SPEED_VALUES), 'turbo', '']) {
            assert.strictEqual(validate({ name: 'p', run: { executable: 'a.rom', speed } }).ok, Object.hasOwnProperty.call(SPEED_VALUES, speed));
        }
        for (const loadAddr of ['0x100', '200', 'FFFF', '0X00ab', '-1', '0x100junk', '10000', '', ' 100']) {
            assert.strictEqual(validate({ name: 'p', run: { executable: 'a.rom', loadAddr } }).ok, new RegExp(LOAD_ADDRESS_PATTERN).test(loadAddr));
        }
        assert.strictEqual(normalizeRun({ executable: 'a.rom', loadAddr: '200' }).loadAddress, 0x200);
    });

    it('captures immutable bytes and preserves explicit Run/Debug/replacement wire policies', async () => {
        const bytes = Uint8Array.of(1, 2, 3);
        const loader = new ProgramLoader(() => bytes);
        const requests: Array<{ command: IpcCommand; data: any }> = [];
        const client = { send: async (command: IpcCommand, data: unknown) => { requests.push({ command, data }); return { ok: true }; } } as any;
        for (const policy of ['run-initial', 'run-reload', 'debug-initial', 'debug-replace'] as const) {
            const image = loader.prepare({ executable: 'TEST.ROM', loadAddr: '200' }, policy);
            assert.ok(Object.isFrozen(image)); assert.ok(Object.isFrozen(image.bytes));
            await loader.load(image, policy, client);
            const request = requests.pop()!;
            assert.strictEqual(request.command, policy === 'debug-replace' ? IpcCommand.SET_MEM : IpcCommand.LOAD_ROM);
            assert.deepStrictEqual(request.data, { addr: 0x200, data: [1, 2, 3], autorun: policy.startsWith('run-') });
        }
        const disk = loader.prepare({ executable: 'TEST.FDD', fddReadOnly: true }, 'debug-initial');
        await loader.load(disk, 'debug-initial', client);
        assert.deepStrictEqual(requests.pop(), { command: IpcCommand.MOUNT_FDD, data: { data: [1, 2, 3], driveIdx: 0, path: 'TEST.FDD', autoBoot: true } });
        assert.strictEqual(disk.run.fddReadOnly, true);
        assert.throws(() => loader.prepare({ executable: 'TEST.FDD' }, 'debug-replace'), /ROM debug sessions/);
        assert.throws(() => loader.prepare({ executable: 'a.rom', loadAddr: 'FFFF' }, 'run-initial'), /exceeds CPU memory/);
        assert.throws(() => loader.prepare({ executable: 'a.rom', loadAddr: '100junk' }, 'run-initial'), /hexadecimal/);
    });

    it('does not publish rejected or stale program loads as successful', async () => {
        const loader = new ProgramLoader(() => Uint8Array.of(1));
        const image = loader.prepare({ executable: 'a.rom' }, 'debug-initial');
        await assert.rejects(loader.load(image, 'debug-initial', { send: async () => ({ ok: false, error: 'rejected' }) } as any), /rejected/);
        let valid = true;
        await assert.rejects(loader.load(image, 'debug-initial', { send: async () => { valid = false; return { ok: true }; } } as any,
            { key: {}, assertCurrent: () => { if (!valid) { throw new Error('stale'); } } }), /stale/);
    });

    it('publishes saved active settings immediately and ignores saves for other projects', async () => {
        const repository = new ProjectRepository({ info() {} } as any);
        const uri = vscode.Uri.file('C:\\projects\\demo.project.json');
        const project = { name: 'demo', uri, run: { executable: 'C:\\projects\\demo.rom', speed: '100%' } };
        repository.load = async () => project;
        const active = new ActiveProjectService({ findProjects: async () => [uri] } as any, repository,
            { getRootUris: () => [] } as any, { info() {} } as any);
        let changes = 0; active.onDidChange(() => changes++);
        await active.resolve();
        await repository.save({ ...project, run: { ...project.run, speed: '200%' } });
        assert.strictEqual(active.getActiveProject()?.run.speed, '200%'); assert.strictEqual(changes, 2);
        await repository.save({ ...project, uri: vscode.Uri.file('C:\\projects\\other.project.json') });
        assert.strictEqual(changes, 2);
        active.dispose(); repository.dispose();
    });

    it('does not let a pre-save project read overwrite newly saved settings', async () => {
        const repository = new ProjectRepository({ info() {} } as any);
        const uri = vscode.Uri.file('C:\\projects\\demo.project.json');
        const old = { name: 'demo', uri, run: { executable: 'C:\\projects\\demo.rom', speed: '100%' } };
        let finish!: (project: typeof old) => void;
        let reads = 0;
        repository.load = async () => ++reads === 1 ? old : new Promise(resolve => { finish = resolve; });
        const active = new ActiveProjectService({ findProjects: async () => [uri] } as any, repository,
            { getRootUris: () => [] } as any, { info() {} } as any);
        await active.resolve();
        const pending = active.resolve(); await new Promise(resolve => setImmediate(resolve));
        await repository.save({ ...old, run: { ...old.run, speed: '200%' } });
        finish(old); await pending;
        assert.strictEqual(active.getActiveProject()?.run.speed, '200%');
        active.dispose(); repository.dispose();
    });
});