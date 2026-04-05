import { expect } from 'chai';
import { V6Error } from '../../../src/platform/errors/v6-error';
import { ErrorCode } from '../../../src/platform/errors/error-codes';

describe('V6Error', () => {
    it('should store the error code and message', () => {
        const err = new V6Error(ErrorCode.CONFIG_INVALID, 'bad config');
        expect(err.code).to.equal(ErrorCode.CONFIG_INVALID);
        expect(err.message).to.equal('bad config');
        expect(err.name).to.equal('V6Error');
    });

    it('should store the optional cause', () => {
        const cause = new Error('underlying');
        const err = new V6Error(ErrorCode.IPC_TIMEOUT, 'timeout', cause);
        expect(err.cause).to.equal(cause);
    });

    it('should have no cause when not provided', () => {
        const err = new V6Error(ErrorCode.EMULATOR_NOT_FOUND, 'not found');
        expect(err.cause).to.be.undefined;
    });

    it('should be an instance of Error', () => {
        const err = new V6Error(ErrorCode.IPC_DECODE_ERROR, 'decode');
        expect(err).to.be.instanceOf(Error);
    });
});
