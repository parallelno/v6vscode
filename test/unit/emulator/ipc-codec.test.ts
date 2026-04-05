import { expect } from 'chai';
import { encode } from '@msgpack/msgpack';
import { encodeRequest, decodeResponse, decodeFrameRaw, frameLength } from '../../../src/emulator/protocol/ipc-codec';
import { IpcCommand, IpcResponse } from '../../../src/emulator/protocol/ipc-commands';
import { ErrorCode } from '../../../src/platform/errors/error-codes';
import { V6Error } from '../../../src/platform/errors/v6-error';

describe('ipc-codec', () => {
    describe('encodeRequest', () => {
        it('should encode a PING request', () => {
            const buf = encodeRequest(IpcCommand.PING);
            expect(buf.length).to.be.greaterThan(4);
            const payloadLen = buf.readUInt32LE(0);
            expect(payloadLen).to.equal(buf.length - 4);
        });

        it('should encode a request with data', () => {
            const buf = encodeRequest(IpcCommand.SET_CPU_SPEED, { speed: 3 });
            const payloadLen = buf.readUInt32LE(0);
            expect(payloadLen).to.be.greaterThan(0);
        });

        it('should encode null data when data is undefined', () => {
            const buf = encodeRequest(IpcCommand.RUN);
            expect(buf.length).to.be.greaterThan(4);
        });
    });

    describe('decodeResponse', () => {
        function makeResponseBuffer(obj: unknown): Buffer {
            const payload = encode(obj);
            const buf = Buffer.alloc(4 + payload.byteLength);
            buf.writeUInt32LE(payload.byteLength, 0);
            Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(buf, 4);
            return buf;
        }

        it('should decode a success response', () => {
            const resp: IpcResponse = { ok: true, data: { pong: true } };
            const buf = makeResponseBuffer(resp);
            const decoded = decodeResponse(buf);
            expect(decoded.ok).to.equal(true);
            expect((decoded.data as any).pong).to.equal(true);
        });

        it('should decode an error response', () => {
            const resp: IpcResponse = { ok: false, error: 'something went wrong' };
            const buf = makeResponseBuffer(resp);
            const decoded = decodeResponse(buf);
            expect(decoded.ok).to.equal(false);
            expect(decoded.error).to.equal('something went wrong');
        });

        it('should throw on buffer too short', () => {
            const buf = Buffer.alloc(2);
            expect(() => decodeResponse(buf)).to.throw(V6Error).with.property('code', ErrorCode.IPC_DECODE_ERROR);
        });

        it('should throw on payload length mismatch', () => {
            const buf = Buffer.alloc(8);
            buf.writeUInt32LE(100, 0); // claims 100 bytes, but only 4 follow
            expect(() => decodeResponse(buf)).to.throw(V6Error).with.property('code', ErrorCode.IPC_DECODE_ERROR);
        });

        it('should throw on invalid MessagePack payload', () => {
            const buf = Buffer.alloc(8);
            buf.writeUInt32LE(4, 0);
            buf.write('bad!', 4);
            expect(() => decodeResponse(buf)).to.throw(V6Error).with.property('code', ErrorCode.IPC_DECODE_ERROR);
        });
    });

    describe('encodeRequest + decodeResponse round-trip', () => {
        it('should produce a valid request that could be decoded as a response if echoed', () => {
            // This tests that encode produces valid length-prefixed MessagePack.
            // We verify by decoding the same buffer as if it were a response.
            const buf = encodeRequest(IpcCommand.PING);
            const decoded = decodeResponse(buf);
            // The decoded "response" will be the request object shape
            expect(decoded).to.have.property('cmd', IpcCommand.PING);
        });
    });

    describe('decodeFrameRaw', () => {
        it('should decode a valid frame', () => {
            const width = 4;
            const height = 2;
            const pixelBytes = width * height * 4; // 32 bytes
            const payloadLen = 8 + pixelBytes; // width + height + pixels
            const buf = Buffer.alloc(4 + payloadLen);
            buf.writeUInt32LE(payloadLen, 0);
            buf.writeUInt32LE(width, 4);
            buf.writeUInt32LE(height, 8);
            // Fill pixel data with a pattern
            for (let i = 0; i < pixelBytes; i++) {
                buf[12 + i] = i % 256;
            }

            const frame = decodeFrameRaw(buf);
            expect(frame.width).to.equal(width);
            expect(frame.height).to.equal(height);
            expect(frame.pixels.length).to.equal(pixelBytes);
            expect(frame.pixels[0]).to.equal(0);
            expect(frame.pixels[1]).to.equal(1);
        });

        it('should throw on buffer too short for header', () => {
            const buf = Buffer.alloc(8);
            expect(() => decodeFrameRaw(buf)).to.throw(V6Error);
        });

        it('should throw on pixel data size mismatch', () => {
            const buf = Buffer.alloc(4 + 8 + 10); // payloadLen says 18, but 4*2*4=32 expected
            buf.writeUInt32LE(18, 0); // payloadLen = 8 + 10
            buf.writeUInt32LE(4, 4); // width
            buf.writeUInt32LE(2, 8); // height — expects 32 bytes but only 10
            expect(() => decodeFrameRaw(buf)).to.throw(V6Error);
        });
    });

    describe('frameLength', () => {
        it('should return 0 for buffer shorter than 4 bytes', () => {
            expect(frameLength(Buffer.alloc(3))).to.equal(0);
        });

        it('should return 0 for incomplete frame', () => {
            const buf = Buffer.alloc(6);
            buf.writeUInt32LE(10, 0); // claims 10-byte payload, but only 2 follow
            expect(frameLength(buf)).to.equal(0);
        });

        it('should return total frame length for complete frame', () => {
            const buf = Buffer.alloc(14);
            buf.writeUInt32LE(10, 0);
            expect(frameLength(buf)).to.equal(14);
        });

        it('should return total for exact-size frame', () => {
            const buf = Buffer.alloc(4);
            buf.writeUInt32LE(0, 0); // zero-length payload
            expect(frameLength(buf)).to.equal(4);
        });
    });
});
