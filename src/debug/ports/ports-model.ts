export interface PortsSnapshot {
    direction: 'in' | 'out';
    bytes: readonly number[];
}

export function decodePorts(value: unknown, direction: 'in' | 'out'): PortsSnapshot {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid ${direction} ports: response must be an object`);
    }
    const bytesValue = (value as Record<string, unknown>).bytes;
    const values = bytesValue instanceof Uint8Array ? Array.from(bytesValue) : bytesValue;
    if (!Array.isArray(values) || values.length !== 256) {
        throw new Error(`Invalid ${direction} ports: server must return exactly 256 bytes`);
    }
    return {
        direction,
        bytes: values.map((entry, index) => {
            if (!Number.isInteger(entry) || (entry as number) < 0 || (entry as number) > 0xFF) {
                throw new Error(`Invalid ${direction} ports: bytes[${index}] must be an integer in 0..255`);
            }
            return entry as number;
        }),
    };
}