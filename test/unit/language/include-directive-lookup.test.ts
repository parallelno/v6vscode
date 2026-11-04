import { expect } from 'chai';
import * as path from 'path';
import {
    DirectiveLookupContext,
    orderWorkspaceRoots,
    resolveDirectiveOperand,
} from '../../../src/language/includes/directive-lookup';

function probe(existing: string[] = [], found: Record<string, string[]> = {}) {
    const candidates: string[] = [];
    const searches: Array<[string, string]> = [];
    return {
        candidates,
        searches,
        dependencies: {
            fileExists: async (candidate: string) => { candidates.push(candidate); return existing.includes(candidate); },
            findFilesByBaseName: async (root: string, baseName: string) => {
                searches.push([root, baseName]);
                return found[`${root}|${baseName}`] ?? [];
            },
        },
    };
}

const root = process.platform === 'win32' ? 'C:\\project' : '/project';
const sourceDir = path.join(root, 'src');
const join = (...parts: string[]) => path.join(root, ...parts);
const context: DirectiveLookupContext = { documentDirectory: sourceDir, workspaceRoots: [root] };

describe('resolveDirectiveOperand', () => {
    it('uses an existing absolute operand as-is', async () => {
        const absolute = join('lib', 'io.inc');
        const test = probe([absolute]);
        expect(await resolveDirectiveOperand(absolute, context, test.dependencies)).to.deep.equal({
            status: 'resolved', path: absolute,
        });
        expect(test.candidates).to.deep.equal([absolute]);
    });

    it('falls back to the filename search for a missing absolute operand', async () => {
        const test = probe([], { [`${root}|io.inc`]: [join('shared', 'io.inc')] });
        expect(await resolveDirectiveOperand(join('missing', 'io.inc'), context, test.dependencies)).to.deep.equal({
            status: 'resolved', path: join('shared', 'io.inc'),
        });
    });

    it('prefers the document directory over workspace and filename matches', async () => {
        const documentRelative = path.join(sourceDir, 'lib', 'common.inc');
        const test = probe([documentRelative, join('lib', 'common.inc')],
            { [`${root}|common.inc`]: [join('shared', 'common.inc')] });
        expect(await resolveDirectiveOperand('lib/common.inc', context, test.dependencies)).to.deep.equal({
            status: 'resolved', path: documentRelative,
        });
        expect(test.candidates).to.deep.equal([documentRelative]);
        expect(test.searches).to.deep.equal([]);
    });

    it('prefers a workspace-relative path over the filename search', async () => {
        const workspaceRelative = join('lib', 'common.inc');
        const test = probe([workspaceRelative], { [`${root}|common.inc`]: [join('shared', 'common.inc')] });
        expect(await resolveDirectiveOperand('lib/common.inc', context, test.dependencies)).to.deep.equal({
            status: 'resolved', path: workspaceRelative,
        });
        expect(test.searches).to.deep.equal([]);
    });

    it('searches by base filename when the operand directories do not exist', async () => {
        const test = probe([], { [`${root}|common.inc`]: [join('shared', 'common.inc'), join('assets', 'common.inc')] });
        expect(await resolveDirectiveOperand('missing/sub/common.inc', context, test.dependencies)).to.deep.equal({
            status: 'resolved', path: join('assets', 'common.inc'),
        });
        expect(test.searches).to.deep.equal([[root, 'common.inc']]);
    });

    it('returns unresolved when nothing matches', async () => {
        const test = probe();
        expect(await resolveDirectiveOperand('lib/common.inc', context, test.dependencies))
            .to.deep.equal({ status: 'unresolved' });
        expect(test.searches).to.deep.equal([[root, 'common.inc']]);
    });

    it('orders the workspace root containing the document first', () => {
        const app = join('app');
        const shared = join('shared');
        expect(orderWorkspaceRoots([shared, app], path.join(app, 'src'))).to.deep.equal([app, shared]);
        expect(orderWorkspaceRoots([shared, app], join('elsewhere'))).to.deep.equal([shared, app]);
    });

    it('checks document, then document root, then other roots before searching by filename', async () => {
        const app = join('app');
        const shared = join('shared');
        const multiRoot: DirectiveLookupContext = { documentDirectory: path.join(app, 'src'), workspaceRoots: [shared, app] };
        const test = probe([path.join(app, 'lib', 'common.inc')],
            { [`${shared}|common.inc`]: [path.join(shared, 'x', 'common.inc')] });
        expect(await resolveDirectiveOperand('lib/common.inc', multiRoot, test.dependencies)).to.deep.equal({
            status: 'resolved', path: path.join(app, 'lib', 'common.inc'),
        });
        expect(test.candidates).to.deep.equal([
            path.join(app, 'src', 'lib', 'common.inc'),
            path.join(app, 'lib', 'common.inc'),
        ]);
        expect(test.searches).to.deep.equal([]);
    });

    it('searches filename candidates root by root and sorted inside a root', async () => {
        const app = join('app');
        const shared = join('shared');
        const multiRoot: DirectiveLookupContext = { documentDirectory: path.join(app, 'src'), workspaceRoots: [shared, app] };
        const test = probe([], { [`${shared}|common.inc`]: [path.join(shared, 'z', 'common.inc'), path.join(shared, 'a', 'common.inc')] });
        expect(await resolveDirectiveOperand('common.inc', multiRoot, test.dependencies)).to.deep.equal({
            status: 'resolved', path: path.join(shared, 'a', 'common.inc'),
        });
        expect(test.searches).to.deep.equal([[app, 'common.inc'], [shared, 'common.inc']]);
    });

    it('skips workspace steps when no workspace is open', async () => {
        const documentOnly: DirectiveLookupContext = { documentDirectory: sourceDir, workspaceRoots: [] };
        const test = probe([path.join(sourceDir, 'common.inc')], { [`${root}|common.inc`]: [join('common.inc')] });
        expect(await resolveDirectiveOperand('common.inc', documentOnly, test.dependencies)).to.deep.equal({
            status: 'resolved', path: path.join(sourceDir, 'common.inc'),
        });
        const other = probe();
        expect(await resolveDirectiveOperand('other.inc', documentOnly, other.dependencies))
            .to.deep.equal({ status: 'unresolved' });
        expect(other.searches).to.deep.equal([]);
    });
});
