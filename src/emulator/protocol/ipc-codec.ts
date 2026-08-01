import { encode, decode } from '@msgpack/msgpack';
import { IpcCommand, IpcResponse, FrameRawResponse } from './ipc-commands';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

const RAW_FRAME_HEADER_SIZE = 16;
const RAW_FRAME_SCHEMA_VERSION = 1;
const RAW_FRAME_KIND_FRAME = 1;
const RAW_FRAME_KIND_ERROR = 2;

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
 * Wire format: [4 bytes payloadLen] [16-byte V6RF header] [body]
 */
export function decodeFrameRaw(buffer: Buffer): FrameRawResponse {
    if (buffer.length < 4 + RAW_FRAME_HEADER_SIZE) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Raw-frame buffer too short for V6RF header');
    }
    const payloadLen = buffer.readUInt32LE(0);
    if (payloadLen < RAW_FRAME_HEADER_SIZE || buffer.length !== 4 + payloadLen) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Raw-frame payload length mismatch');
    }
    if (buffer.toString('ascii', 4, 8) !== 'V6RF') {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Raw-frame magic mismatch');
    }
    if (buffer[8] !== RAW_FRAME_SCHEMA_VERSION) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, `Unsupported raw-frame schema ${buffer[8]}`);
    }
    if (buffer.readUInt16LE(10) !== 0) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Raw-frame flags must be zero');
    }

    const kind = buffer[9];
    const value0 = buffer.readUInt32LE(12);
    const value1 = buffer.readUInt32LE(16);
    const body = buffer.subarray(4 + RAW_FRAME_HEADER_SIZE);

    if (kind === RAW_FRAME_KIND_ERROR) {
        if (body.length !== value1) {
            throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Raw-frame error message length mismatch');
        }
        return { kind: 'error', code: value0, message: body.toString('utf8') };
    }
    if (kind !== RAW_FRAME_KIND_FRAME) {
        throw new V6Error(ErrorCode.IPC_DECODE_ERROR, `Unknown raw-frame kind ${kind}`);
    }

    const width = value0;
    const height = value1;
    const expectedPixelBytes = width * height * 4;

    if (!Number.isSafeInteger(expectedPixelBytes) || body.length !== expectedPixelBytes) {
        throw new V6Error(
            ErrorCode.IPC_DECODE_ERROR,
            `Frame pixel data size mismatch: expected ${expectedPixelBytes}, got ${body.length}`,
        );
    }
    return { kind: 'frame', width, height, pixels: Buffer.from(body) };
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
