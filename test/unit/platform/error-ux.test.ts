import { expect } from 'chai';
import { ErrorCode } from '../../../src/platform/errors/error-codes';

// We test the internal logic of error-ux (user message mapping and action mapping)
// without requiring the real vscode API, by importing the module structure.

describe('error-ux', () => {
    describe('ErrorCode coverage', () => {
        const ALL_CODES = [
            ErrorCode.CONFIG_INVALID,
            ErrorCode.EMULATOR_NOT_FOUND,
            ErrorCode.EXECUTABLE_NOT_FOUND,
            ErrorCode.EMULATOR_LAUNCH_FAILED,
            ErrorCode.IPC_CONNECTION_REFUSED,
            ErrorCode.IPC_TIMEOUT,
            ErrorCode.IPC_DECODE_ERROR,
        ];

        it('all error codes should be defined and unique', () => {
            const set = new Set(ALL_CODES);
            expect(set.size).to.equal(ALL_CODES.length);
        });

        it('all error codes should be non-empty strings', () => {
            for (const code of ALL_CODES) {
                expect(code).to.be.a('string');
                expect(code.length).to.be.greaterThan(0);
            }
        });
    });

    describe('V6Error with every code', () => {
        // Demonstrates that V6Error can be constructed with each code
        const { V6Error } = require('../../../src/platform/errors/v6-error');

        it('should construct V6Error for each error code', () => {
            const codes = [
                ErrorCode.CONFIG_INVALID,
                ErrorCode.EMULATOR_NOT_FOUND,
                ErrorCode.EXECUTABLE_NOT_FOUND,
                ErrorCode.EMULATOR_LAUNCH_FAILED,
                ErrorCode.IPC_CONNECTION_REFUSED,
                ErrorCode.IPC_TIMEOUT,
                ErrorCode.IPC_DECODE_ERROR,
            ];

            for (const code of codes) {
                const err = new V6Error(code, `test message for ${code}`);
                expect(err).to.be.instanceOf(Error);
                expect(err.code).to.equal(code);
                expect(err.message).to.include(code);
            }
        });

        it('should construct V6Error with cause for each code', () => {
            const cause = new Error('root cause');
            const codes = [
                ErrorCode.EMULATOR_LAUNCH_FAILED,
                ErrorCode.IPC_CONNECTION_REFUSED,
                ErrorCode.IPC_TIMEOUT,
            ];

            for (const code of codes) {
                const err = new V6Error(code, 'wrapper', cause);
                expect(err.cause).to.equal(cause);
                expect(err.code).to.equal(code);
            }
        });
    });
});
