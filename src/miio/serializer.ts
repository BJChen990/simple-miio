import { createCipheriv, createDecipheriv } from 'crypto';
import { md5 } from '../utils/crypto_utils';
import { Preconditions } from '../utils/preconditions';
import { HandshakeRequest, HandshakeResponse, HEADER_BYTES, MiIORequest, MiIOResponse, NormalResponse, numToBytes, Packet, PacketImpl } from './packet';

export const MAX_2_BYTES_BUFFER = Buffer.alloc(2, 0xff);
export const MAX_4_BYTES_BUFFER = Buffer.alloc(4, 0xff);
export const MAX_4_BYTES_NUMBER = MAX_4_BYTES_BUFFER.readUInt32BE();
export const MAX_16_BYTES_BUFFER = Buffer.alloc(16, 0xff);
export const MIN_16_BYTES_BUFFER = Buffer.alloc(16, 0x00);
export const DEFAULT_UNKNOWN_BUFFER = Buffer.alloc(4, 0x00);
export const MAGIC_BUFFER = Buffer.of(0x21, 0x31);

export interface Serializer<Req> {
  serialize(req: Req): Packet;
}
export interface Deserializer<Res> {
  deserialize(packet: Packet): Res;
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
    return Buffer.concat([cipher.update(data), cipher.final()]);
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

export class ResponseDeserializer implements Deserializer<MiIOResponse> {
  constructor(private readonly token: Buffer) {}

  private isChecksumValid(packet: Packet) {
    const header = Buffer.concat([
      packet.magicNumber,
      numToBytes(packet.packetLength, 2),
      packet.unknown1,
      numToBytes(packet.deviceId, 4),
      numToBytes(packet.stamp, 4),
    ]);
    const localChecksum = md5(
      ...[
        header,
        this.token,
        packet.data.byteLength > 0 ? packet.data : undefined,
      ].filter((buffer: Buffer | undefined): buffer is Buffer => !!buffer)
    );
    return packet.checksum.equals(localChecksum);
  }

  private decryptedData(data: Buffer) {
    if (data.byteLength === 0) {
      return data;
    }
    const key = md5(this.token);
    const iv = md5(key, this.token);
    const decipher = createDecipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private isHandshake(packet: Packet) {
    return (
      packet.unknown1.equals(DEFAULT_UNKNOWN_BUFFER) &&
      packet.packetLength === HEADER_BYTES &&
      packet.checksum.equals(MIN_16_BYTES_BUFFER)
    );
  }

  deserialize(packet: Packet) {
    if (this.isHandshake(packet)) {
      return new HandshakeResponse(
        packet.deviceId,
        packet.stamp,
        this.decryptedData(packet.data)
      );
    }
    Preconditions.checkArgument(
      this.isChecksumValid(packet),
      'Checksum failed.'
    );
    return new NormalResponse(
      packet.deviceId,
      packet.stamp,
      this.decryptedData(packet.data)
    );
  }
}
