import { ErrorCode } from './error-codes';

export class V6Error extends Error {
    readonly code: ErrorCode;
    readonly cause?: Error;

    constructor(code: ErrorCode, message: string, cause?: Error) {
        super(message);
        this.name = 'V6Error';
        this.code = code;
        this.cause = cause;
    }
}
