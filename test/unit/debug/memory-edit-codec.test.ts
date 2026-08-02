import { expect } from 'chai';
import { decodeMemoryEditList, validateMemoryEditInput } from '../../../src/debug/memory-edits/memory-edit-codec';

describe('Memory Edit codec', () => {
    const input = { globalAddr: 1, enteredValue: 2, readonly: false, active: true, comment: '' };
    const snapshot = { ...input, originalValue: 3, currentValue: 2 };

    it('accepts valid numeric inputs and authoritative snapshots', () => {
        expect(validateMemoryEditInput(input)).to.deep.equal(input);
        expect(decodeMemoryEditList({ edits: [snapshot] })).to.deep.equal([snapshot]);
    });

    it('rejects malformed, duplicate, and unordered snapshots', () => {
        expect(() => decodeMemoryEditList([snapshot])).to.throw('must be an object');
        expect(() => decodeMemoryEditList({ edits: [{ ...snapshot, currentValue: 256 }] })).to.throw('currentValue');
        expect(() => decodeMemoryEditList({ edits: [snapshot, snapshot] })).to.throw('ordered by unique');
        expect(() => decodeMemoryEditList({ edits: [{ ...snapshot, globalAddr: 2 }, snapshot] })).to.throw('ordered by unique');
    });

    it('enforces advertised address and UTF-8 comment limits', () => {
        const limits = { globalAddressExclusive: 4, maxCommentBytes: 3 };
        expect(() => validateMemoryEditInput({ ...input, globalAddr: 4 }, limits)).to.throw('globalAddr');
        expect(() => validateMemoryEditInput({ ...input, comment: 'éé' }, limits)).to.throw('UTF-8 bytes');
        expect(() => validateMemoryEditInput({ ...input, originalValue: 1 }, limits)).to.throw('Unknown memory edit field');
    });
});