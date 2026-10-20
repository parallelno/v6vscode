// Repeatable work-count/timing profile; synthetic DOM counts are not browser wall-clock claims.
const fs = require('fs');
const ts = require('typescript');
const vm = require('vm');
const { performance } = require('perf_hooks');
const source = fs.readFileSync('src/webview/browser/keyed-rows.ts', 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 } }).outputText, { exports: exportsObject });
const { KeyedRows } = exportsObject;
const count = 2000, updates = 100;
function profile(keyed) {
    let created = 0;
    const parent = { children: [], insertBefore(row, before) {
        const old = this.children.indexOf(row); if (old >= 0) this.children.splice(old, 1);
        const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, row);
    } };
    const make = () => { created++; const row = { remove() { const i = parent.children.indexOf(row); if (i >= 0) parent.children.splice(i, 1); } }; return row; };
    const renderer = new KeyedRows();
    const entries = Array.from({ length: count }, (_, id) => ({ id, name: `test ${id}`, active: true }));
    const start = performance.now();
    for (let update = 0; update < updates; update++) {
        if (keyed) renderer.render(parent, entries, entry => entry.id, make);
        else { parent.children = []; entries.forEach(() => parent.children.push(make())); }
    }
    return { rowsCreated: created, retainedRows: parent.children.length, syntheticMs: +(performance.now() - start).toFixed(2) };
}
console.log(JSON.stringify({ workload: { rows: count, snapshots: updates }, before: profile(false), after: profile(true),
    note: 'Synthetic timings include keyed signature/index overhead; use row-creation count and packaged behavior, not these timings as browser paint measurements.' }, null, 2));

process.env.TS_NODE_PROJECT = 'tsconfig.test.json';
require('ts-node/register');
async function coreProfile() {
    const { IpcClient } = require('../src/emulator/client/ipc-client');
    const { MockTcpServer } = require('../test/helpers/mock-tcp-server');
    const server = new MockTcpServer(); const samples = [];
    const client = new IpcClient({debug() {}, error() {}}, {}, undefined, { now: () => performance.now(), completed: value => samples.push(value) });
    try {
        await server.start(); await client.connect(server.port);
        await Promise.all(Array.from({length: 32}, () => client.send(-1))); // const-enum PING wire value
        const sorted = key => samples.map(sample => sample[key]).sort((a,b) => a-b);
        console.log(JSON.stringify({ queueProfile: { requests: samples.length, queueP50Ms: sorted('queueMs')[16], queueP95Ms: sorted('queueMs')[30],
            wireP50Ms: sorted('wireMs')[16], maxQueuedAtSubmission: Math.max(...samples.map(sample => sample.queuedAtSubmission)) } }));
    } finally { client.disconnect(); await server.stop(); }
    const { ArtifactRepository } = require('../src/debug/metadata/artifact-repository');
    const { decodeDebugArtifact } = require('../src/debug/metadata/debug-artifact-loader');
    const elf = fs.readFileSync('test/fixtures/cdbg/probe-O2.elf'); let parses = 0;
    const repository = new ArtifactRepository({read: async () => ({elf})}, bytes => { parses++; return decodeDebugArtifact(bytes); });
    const cold = performance.now(); await repository.load('profile.elf'); const coldMs = performance.now()-cold;
    const warm = performance.now(); for (let i=0;i<50;i++) await repository.load('profile.elf');
    console.log(JSON.stringify({ artifactProfile: { elfBytes: elf.length, coldMs, warm50Ms: performance.now()-warm, parses,
        policy: 'Existing content hash/immutable cache retained; no speculative worker/offload introduced.' } }));
}
coreProfile().catch(error => { console.error(error); process.exitCode = 1; });