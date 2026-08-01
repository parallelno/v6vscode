import { expect } from 'chai';
import { WatchpointExpressionStore } from '../../../src/debug/views/watchpoint-expression-store';
import { WatchpointEntry } from '../../../src/emulator/protocol/debug-models';

const entry = (id: number, globalAddr: number): WatchpointEntry => ({
    id, globalAddr, len: 1, value: 0, access: 'RW', condition: 'ANY',
    type: 'LEN', active: true, comment: '',
});

describe('WatchpointExpressionStore', () => {
    it('preserves exact expressions and decimal literals across snapshots', () => {
        const store = new WatchpointExpressionStore();
        store.set(1, '  set_palette + 0x10*3  ');
        store.set(2, '256');

        const first = store.decorate([entry(1, 0x130), entry(2, 256)], 0);
        const refreshed = store.decorate([entry(1, 0x130), entry(2, 256)], 0);

        expect(first.map(item => item.globalAddr)).to.deep.equal(['  set_palette + 0x10*3  ', '256']);
        expect(refreshed.map(item => item.globalAddr)).to.deep.equal(['  set_palette + 0x10*3  ', '256']);
    });

    it('uses decimal server values for unknown entries and removes deleted IDs', () => {
        const store = new WatchpointExpressionStore();
        store.set(1, '$0100');
        expect(store.decorate([entry(1, 256), entry(2, 512)], 0).map(item => item.globalAddr))
            .to.deep.equal(['$0100', '512']);

        store.decorate([entry(2, 512)], 0);
        expect(store.decorate([entry(1, 256)], 0)[0].globalAddr).to.equal('256');
    });

    it('clears expressions when the emulator session generation changes', () => {
        const store = new WatchpointExpressionStore();
        store.set(1, 'main+1');
        expect(store.decorate([entry(1, 257)], 0)[0].globalAddr).to.equal('main+1');
        expect(store.decorate([entry(1, 257)], 1)[0].globalAddr).to.equal('257');
    });
});