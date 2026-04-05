import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

export function parse(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new V6Error(
            ErrorCode.CONFIG_INVALID,
            `Failed to parse project JSON: ${(err as Error).message}`,
            err as Error,
        );
    }
}
