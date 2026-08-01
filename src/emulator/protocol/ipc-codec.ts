import { encode, decode } from '@msgpack/msgpack';
import { IpcCommand, IpcResponse, FrameRawResponse } from './ipc-commands';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

/**
 * Encode an IPC request into a length-prefixed MessagePack buffer.
 * Wire format: [4 bytes uint32 LE length] [MessagePack payload]
 */
export function encodeRequest(cmd: IpcCommand, data?: unknown): Buffer {
    const payload = encode({ cmd, data: data ?? {} });
    const frame = Buffer.alloc(4 + payload.byteLength);
    frame.writeUInt32LE(payload.byteLength, 0);
    Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, 4);
    return frame;
}

/**
 * Decode a length-prefixed MessagePack response buffer.
 * Returns the parsed IpcResponse envelope.
 */
export function decodeResponse(buffer: Buffer): IpcResponse {
    if (buffer.length < 4) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Response buffer too short for length prefix');
    }
    const payloadLen = buffer.readUInt32LE(0);
    if (buffer.length < 4 + payloadLen) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Response buffer shorter than declared payload length');
    }
    try {
        const payload = decode(buffer.subarray(4, 4 + payloadLen)) as IpcResponse;
        return payload;
    } catch (e) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Failed to decode MessagePack response', e instanceof Error ? e : undefined);
    }
}

/**
 * Decode a GET_FRAME_RAW binary response.
 * Wire format: [4 bytes payloadLen] [4 bytes width] [4 bytes height] [pixels]
 */
export function decodeFrameRaw(buffer: Buffer): FrameRawResponse {
    if (buffer.length < 12) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Frame buffer too short for header (need 12 bytes)');
    }
    const payloadLen = buffer.readUInt32LE(0);
    const width = buffer.readUInt32LE(4);
    const height = buffer.readUInt32LE(8);
    const pixelBytes = payloadLen - 8;
    const expectedPixelBytes = width * height * 4;

    if (pixelBytes !== expectedPixelBytes) {
        throw new V6Error(
            ErrorCode.IPC_DECODE_ERROR,
            `Frame pixel data size mismatch: expected ${expectedPixelBytes}, got ${pixelBytes}`,
        );
    }

    if (buffer.length < 4 + payloadLen) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Frame buffer shorter than declared payload length');
    }

    const pixels = Buffer.from(buffer.subarray(12, 12 + pixelBytes));
    return { width, height, pixels };
}

/**
 * Try to extract a complete frame from a buffer.
 * Returns the number of bytes consumed, or 0 if incomplete.
 */
export function frameLength(buffer: Buffer): number {
    if (buffer.length < 4) {
        return 0;
    }
    const payloadLen = buffer.readUInt32LE(0);
    const total = 4 + payloadLen;
    return buffer.length >= total ? total : 0;
}
