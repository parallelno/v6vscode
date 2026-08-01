import { expect } from 'chai';
import { encode, decode } from '@msgpack/msgpack';
import { encodeRequest, decodeResponse, decodeFrameRaw, frameLength } from '../../../src/emulator/protocol/ipc-codec';
import { IpcCommand, IpcResponse } from '../../../src/emulator/protocol/ipc-commands';
import { ErrorCode } from '../../../src/platform/errors/error-codes';
import { V6Error } from '../../../src/platform/errors/v6-error';

describe('ipc-codec', () => {
    describe('IpcCommand compatibility', () => {
        it('should match the native v6emul command IDs after frame controls', () => {
            expect(IpcCommand.SET_FRAME_MODE).to.equal(40);
            expect(IpcCommand.SET_COLOR_FORMAT).to.equal(41);
            expect(IpcCommand.SET_MEM).to.equal(42);
            expect(IpcCommand.SET_BYTE_GLOBAL).to.equal(43);
            expect(IpcCommand.SET_CPU_SPEED).to.equal(44);
            expect(IpcCommand.KEY_HANDLING).to.equal(47);
            expect(IpcCommand.LOAD_FDD).to.equal(48);
            expect(IpcCommand.RESET_UPDATE_FDD).to.equal(49);
            expect(IpcCommand.LOAD_ROM).to.equal(91);
            expect(IpcCommand.MOUNT_FDD).to.equal(92);
            expect(IpcCommand.GET_SERVER_INFO).to.equal(-5);
        });
    });

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

        it('should encode object data when data is undefined', () => {
            const buf = encodeRequest(IpcCommand.RUN);
            const payload = decode(buf.subarray(4)) as { cmd: number; data: unknown };
            expect(payload).to.deep.equal({ cmd: IpcCommand.RUN, data: {} });
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
            const resp: IpcResponse = { ok: false, code: 'invalid_request', error: 'something went wrong' };
            const buf = makeResponseBuffer(resp);
            const decoded = decodeResponse(buf);
            expect(decoded.ok).to.equal(false);
            expect(decoded.code).to.equal('invalid_request');
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
        function makeRawEnvelope(kind: number, value0: number, value1: number, body: Buffer): Buffer {
            const payloadLen = 16 + body.length;
            const buf = Buffer.alloc(4 + payloadLen);
            buf.writeUInt32LE(payloadLen, 0);
            buf.write('V6RF', 4, 'ascii');
            buf[8] = 1;
            buf[9] = kind;
            buf.writeUInt16LE(0, 10);
            buf.writeUInt32LE(value0, 12);
            buf.writeUInt32LE(value1, 16);
            body.copy(buf, 20);
            return buf;
        }

        it('should decode a valid frame', () => {
            const width = 4;
            const height = 2;
            const pixelBytes = width * height * 4; // 32 bytes
            const pixels = Buffer.alloc(pixelBytes);
            for (let i = 0; i < pixelBytes; i++) {
                pixels[i] = i % 256;
            }
            const buf = makeRawEnvelope(1, width, height, pixels);

            const frame = decodeFrameRaw(buf);
            expect(frame.kind).to.equal('frame');
            if (frame.kind !== 'frame') { throw new Error('Expected frame response'); }
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

        it('should decode and consume a raw-frame error', () => {
            const message = 'no frame available';
            const frame = decodeFrameRaw(makeRawEnvelope(2, 1, Buffer.byteLength(message), Buffer.from(message)));

            expect(frame).to.deep.equal({ kind: 'error', code: 1, message });
        });

        it('should throw on pixel data size mismatch', () => {
            const buf = makeRawEnvelope(1, 4, 2, Buffer.alloc(10));
            expect(() => decodeFrameRaw(buf)).to.throw(V6Error);
        });

        it('should reject invalid magic, schema, kind, flags, and error length', () => {
            const valid = makeRawEnvelope(1, 1, 1, Buffer.alloc(4));
            const invalidMagic = Buffer.from(valid);
            invalidMagic.write('BAD!', 4, 'ascii');
            expect(() => decodeFrameRaw(invalidMagic)).to.throw(V6Error);

            const invalidSchema = Buffer.from(valid);
            invalidSchema[8] = 2;
            expect(() => decodeFrameRaw(invalidSchema)).to.throw(V6Error);

            const invalidKind = Buffer.from(valid);
            invalidKind[9] = 99;
            expect(() => decodeFrameRaw(invalidKind)).to.throw(V6Error);

            const invalidFlags = Buffer.from(valid);
            invalidFlags[10] = 1;
            expect(() => decodeFrameRaw(invalidFlags)).to.throw(V6Error);

            const invalidErrorLength = makeRawEnvelope(2, 1, 99, Buffer.from('short'));
            expect(() => decodeFrameRaw(invalidErrorLength)).to.throw(V6Error);
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
