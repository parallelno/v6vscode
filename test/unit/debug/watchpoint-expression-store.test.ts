import { expect } from 'chai';
import { EntryExpressionStore } from '../../../src/debug/views/entry-expression-store';
import { WatchpointEntry } from '../../../src/emulator/protocol/debug-models';

const entry = (id: number, globalAddr: number): WatchpointEntry => ({
    id, globalAddr, len: 1, value: 0, access: 'RW', condition: 'ANY',
    type: 'LEN', active: true, comment: '',
});

describe('EntryExpressionStore', () => {
    const createStore = () => new EntryExpressionStore<WatchpointEntry, 'globalAddr'>(['globalAddr']);

    it('preserves exact expressions and decimal literals across snapshots', () => {
        const store = createStore();
        store.set(1, { globalAddr: '  set_palette + 0x10*3  ' });
        store.set(2, { globalAddr: '256' });

        const first = store.decorate([entry(1, 0x130), entry(2, 256)], 0);
        const refreshed = store.decorate([entry(1, 0x130), entry(2, 256)], 0);

        expect(first.map(item => item.globalAddr)).to.deep.equal(['  set_palette + 0x10*3  ', '256']);
        expect(refreshed.map(item => item.globalAddr)).to.deep.equal(['  set_palette + 0x10*3  ', '256']);
    });

    it('uses decimal server values for unknown entries and removes deleted IDs', () => {
        const store = createStore();
        store.set(1, { globalAddr: '$0100' });
        expect(store.decorate([entry(1, 256), entry(2, 512)], 0).map(item => item.globalAddr))
            .to.deep.equal(['$0100', '512']);

        store.decorate([entry(2, 512)], 0);
        expect(store.decorate([entry(1, 256)], 0)[0].globalAddr).to.equal('256');
    });

    it('clears expressions when the emulator session generation changes', () => {
        const store = createStore();
        store.set(1, { globalAddr: 'main+1' });
        expect(store.decorate([entry(1, 257)], 0)[0].globalAddr).to.equal('main+1');
        expect(store.decorate([entry(1, 257)], 1)[0].globalAddr).to.equal('257');
    });

    it('preserves multiple expression fields and supports custom fallback formatting', () => {
        type Range = { id: number; start: number; end: number };
        const store = new EntryExpressionStore<Range, 'start' | 'end'>(
            ['start', 'end'], (_field, value) => `0x${value.toString(16)}`,
        );
        store.set(1, { start: ' main + 1 ', end: '$0200' });

        expect(store.decorate([{ id: 1, start: 0x101, end: 0x200 }], 0)[0])
            .to.deep.equal({ id: 1, start: ' main + 1 ', end: '$0200' });
        expect(store.decorate([{ id: 2, start: 0x300, end: 0x400 }], 0)[0])
            .to.deep.equal({ id: 2, start: '0x300', end: '0x400' });
    });
});