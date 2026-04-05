import { expect } from 'chai';
import { DisposableStore, toDisposable } from '../../../src/platform/disposable/lifecycle';

describe('DisposableStore', () => {
    it('should dispose all added disposables', () => {
        const disposed: string[] = [];
        const store = new DisposableStore();
        store.add(toDisposable(() => disposed.push('a')));
        store.add(toDisposable(() => disposed.push('b')));
        store.add(toDisposable(() => disposed.push('c')));

        store.dispose();

        // Disposed in reverse order
        expect(disposed).to.deep.equal(['c', 'b', 'a']);
    });

    it('should not dispose twice', () => {
        let count = 0;
        const store = new DisposableStore();
        store.add(toDisposable(() => count++));

        store.dispose();
        store.dispose();

        expect(count).to.equal(1);
    });

    it('should immediately dispose items added after store is disposed', () => {
        let disposed = false;
        const store = new DisposableStore();
        store.dispose();

        store.add(toDisposable(() => { disposed = true; }));
        expect(disposed).to.be.true;
    });

    it('should return the added disposable', () => {
        const store = new DisposableStore();
        const d = toDisposable(() => {});
        const returned = store.add(d);
        expect(returned).to.equal(d);
        store.dispose();
    });
});

describe('toDisposable', () => {
    it('should create a disposable from a function', () => {
        let called = false;
        const d = toDisposable(() => { called = true; });
        d.dispose();
        expect(called).to.be.true;
    });
});
