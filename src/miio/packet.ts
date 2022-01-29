import { createCipheriv, createDecipheriv } from 'crypto';
import { md5 } from '../utils/crypto_utils';
import { Preconditions } from '../utils/preconditions';

export const MAX_2_BYTES_BUFFER = Buffer.alloc(2, 0xff);
export const MAX_4_BYTES_BUFFER = Buffer.alloc(4, 0xff);
export const MAX_4_BYTES_NUMBER = MAX_4_BYTES_BUFFER.readUInt32BE();
export const MAX_16_BYTES_BUFFER = Buffer.alloc(16, 0xff);
export const DEFAULT_UNKNOWN_BUFFER = Buffer.alloc(4, 0x00);
export const MAGIC_BUFFER = Buffer.of(0x21, 0x31);

export function numToBytes(value: number, bytes: 1 | 2 | 4) {
  const buffer = Buffer.alloc(bytes);
  switch (bytes) {
  case 1:
    buffer.writeUInt8(value);
    break;
  case 2:
    buffer.writeUInt16BE(value);
    break;
  case 4:
    buffer.writeUInt32BE(value);
    break;
  default:
    throw new Error();
  }
  return buffer;
}

// 2 (magic number) + 2 (data length) +
// 4 (unknown) +
// 4 (device ID) +
// 4 (timestamp) +
// 16 (checksum) bytes
export const HEADER_BYTES = 32;

/**
 *  0                   1                   2                   3
 *  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 * +-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
 * | Magic number = 0x2131         | Packet Length (incl. header)  |
 * |-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-|
 * | Unknown1                                                      |
 * |-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-|
 * | Device ID ("did")                                             |
 * |-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-|
 * | Stamp                                                         |
 * |-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-|
 * | MD5 checksum                                                  |
 * | ... or Device Token in response to the "Hello" packet         |
 * |-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-|
 * | optional variable-sized data (encrypted)                      |
 * |...............................................................|
 *
 *                 Mi Home Binary Protocol header
 *        Note that one tick mark represents one bit position.
 */
export interface Packet {
  magicNumber: Buffer;

  // Packet length: 16 bits unsigned int
  // Length in bytes of the whole packet, including the header.
  packetLength: number;

  // Unknown1: 32 bits
  // This value is always 0,
  // except in the "Hello" packet, when it's 0xFFFFFFFF
  unknown1: Buffer;

  // Device ID: 32 bits
  // Unique number. Possibly derived from the MAC address.
  // except in the "Hello" packet, when it's 0xFFFFFFFF
  deviceId: number;

  // Stamp: 32 bit unsigned int
  //     continously increasing counter
  stamp: number;

  // MD5 checksum:
  //     calculated for the whole packet including the MD5 field itself,
  //     which must be initialized with 0.
  //
  //     In the special case of the response to the "Hello" packet,
  //     this field contains the 128-bit device token instead.
  checksum: Buffer;

  // optional variable-sized data:
  //     encrypted with AES-128: see below.
  //     length = packet_length - 0x20
  data: Buffer;
}

export abstract class ResponsePacket implements Packet {
  static from(buffer: Buffer) {
    const magicNumber = buffer.slice(0, 2);
    const packetLength = buffer.slice(2, 4).readUInt16BE();
    const deviceid = buffer.slice(8, 12).readUInt32BE();
    const stamp = buffer.slice(12, 16).readUInt32BE();
    const checksum = buffer.slice(16, 32);
    const data = buffer.slice(32);
    Preconditions.checkArgument(
      magicNumber.equals(MAGIC_BUFFER),
      `Incorrect magic number: ${magicNumber}`
    );
    Preconditions.checkArgument(
      packetLength === buffer.byteLength,
      `Packet length mismatch. (${packetLength}/${buffer.byteLength})`
    );
    if (data.byteLength === 0) {
      return new HandshakeResponsePacket(
        packetLength,
        deviceid,
        stamp,
        checksum,
        data
      );
    }
    return new NormalResponsePacket(
      packetLength,
      deviceid,
      stamp,
      checksum,
      data
    );
  }

  readonly magicNumber = MAGIC_BUFFER;
  readonly unknown1 = DEFAULT_UNKNOWN_BUFFER;

  constructor(
    readonly packetLength: number,
    readonly deviceId: number,
    readonly stamp: number,
    readonly checksum: Buffer,
    readonly data: Buffer
  ) {}

  abstract isChecksumValid(token?: Buffer): boolean;
  abstract getDecryptedData(token?: Buffer): Buffer;
}

export class HandshakeResponsePacket extends ResponsePacket {
  readonly type = 'HANDSHAKE';

  isChecksumValid() {
    return true;
  }
  getDecryptedData() {
    return this.data;
  }
}

export class NormalResponsePacket extends ResponsePacket {
  readonly type = 'NORMAL';

  isChecksumValid(token: Buffer) {
    const header = Buffer.concat([
      MAGIC_BUFFER,
      numToBytes(this.packetLength, 2),
      this.unknown1,
      numToBytes(this.deviceId, 4),
      numToBytes(this.stamp, 4),
    ]);
    const localChecksum = md5(
      ...[
        header,
        token,
        this.data.byteLength > 0 ? this.data : undefined,
      ].filter((buffer: Buffer | undefined): buffer is Buffer => !!buffer)
    );
    return this.checksum.equals(localChecksum);
  }

  getDecryptedData(token: Buffer) {
    const key = md5(token);
    const iv = md5(key, token);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(this.data), decipher.final()]);
  }
}

export class PacketImpl implements Packet {
  constructor(
    readonly magicNumber: Buffer,
    readonly packetLength: number,
    readonly unknown1: Buffer,
    readonly deviceId: number,
    readonly stamp: number,
    readonly checksum: Buffer,
    readonly data: Buffer
  ) {}

  get raw() {
    return Buffer.concat([
      MAGIC_BUFFER,
      numToBytes(this.packetLength, 2),
      this.unknown1,
      numToBytes(this.deviceId, 4),
      numToBytes(this.stamp, 4),
      this.checksum,
      this.data,
    ]);
  }

  static from(buffer: Buffer) {
    const magicNumber = buffer.slice(0, 2);
    const packetLength = buffer.slice(2, 4).readUInt16BE();
    const unknown1 = buffer.slice(4, 8);
    const deviceid = buffer.slice(8, 12).readUInt32BE();
    const stamp = buffer.slice(12, 16).readUInt32BE();
    const checksum = buffer.slice(16, 32);
    const data = buffer.slice(32);
    Preconditions.checkArgument(
      magicNumber.equals(MAGIC_BUFFER),
      `Incorrect magic number: ${magicNumber}`
    );
    Preconditions.checkArgument(
      packetLength === buffer.byteLength,
      `Packet length mismatch. (${packetLength}/${buffer.byteLength})`
    );
    return new PacketImpl(
      magicNumber,
      packetLength,
      unknown1,
      deviceid,
      stamp,
      checksum,
      data,
    );
  }
}
export interface BaseMiIORequest {
  deviceId: number;
  stamp: number;
  data: Buffer;
}

export class HandshakeRequest implements BaseMiIORequest {
  readonly type = 'HANDSHAKE';
  readonly deviceId = MAX_4_BYTES_NUMBER;
  readonly stamp = MAX_4_BYTES_NUMBER;
  readonly data = Buffer.of();
}

export class NormalRequest implements BaseMiIORequest {
  readonly type = 'NORMAL';
  constructor(
    readonly deviceId: number,
    readonly stamp: number,
    readonly data: Buffer
  ) {}
}

export type MiIORequest = HandshakeRequest | NormalRequest;

export interface Serializer<T> {
  serialize(req: T): Packet;
}

export class RequestSerializer implements Serializer<MiIORequest> {
  constructor(private readonly token: Buffer) {}

  private encryptData(data: Buffer) {
    if (data.byteLength === 0) {
      return Buffer.of();
    }
    const key = md5(this.token);
    const iv = md5(key, this.token);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  }

  private calculateChecksum(
    { type, deviceId, stamp }: MiIORequest,
    encryptedData: Buffer
  ) {
    const unknown1 =
      type === 'HANDSHAKE' ? MAX_4_BYTES_BUFFER : DEFAULT_UNKNOWN_BUFFER;
    const metadata = Buffer.concat([
      MAGIC_BUFFER,
      numToBytes(HEADER_BYTES + encryptedData.byteLength, 2),
      unknown1,
      numToBytes(deviceId, 4),
      numToBytes(stamp, 4),
    ]);
    return md5(
      ...[
        metadata,
        this.token,
        encryptedData.byteLength === 0 ? undefined : encryptedData,
      ].filter((buffer?: Buffer): buffer is Buffer => !!buffer)
    );
  }

  serialize(req: MiIORequest): PacketImpl {
    const { data, deviceId, stamp, type } = req;
    const encryptedData = this.encryptData(data);
    const unknown1 =
      type === 'HANDSHAKE' ? MAX_4_BYTES_BUFFER : DEFAULT_UNKNOWN_BUFFER;
    const checksum =
      type === 'HANDSHAKE'
        ? MAX_16_BYTES_BUFFER
        : this.calculateChecksum(req, encryptedData);
    return new PacketImpl(
      MAGIC_BUFFER,
      HEADER_BYTES + encryptedData.byteLength,
      unknown1,
      deviceId,
      stamp,
      checksum,
      encryptedData
    );
  }
}
