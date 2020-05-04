import {
  MAGIC_BUFFER,
  HEADER_BYTES,
  MAX_4_BIT_BUFFER,
  MAX_16_BIT_BUFFER,
  DEFAULT_UNKNOWN_BUFFER,
} from './packet';
import { md5 } from '../utils/crypto_utils';
import { createCipheriv, createDecipheriv } from 'crypto';

export interface Packet {
  deviceId: number;
  timestamp: number;
  data: Buffer;
  isHandshake: boolean;
}

type Parameters<T extends (...args: any[]) => any> = T extends (...args: infer K) => any
  ? K
  : never;
type ReturnType<T extends (...args: any[]) => any> = T extends (...args: any[]) => infer K
  ? K
  : never;

const INVALID_MI_BUFFER_VALUE = 0;

function memoizer<T extends (...args: any[]) => any>(
  getHash: (...args: Parameters<T>) => string,
  fn: T,
): (...args: Parameters<T>) => ReturnType<T> {
  const cacheMap: { [key: string]: ReturnType<T> } = {};
  const memoized: (...args: Parameters<T>) => ReturnType<T> = (...args: Parameters<T>) => {
    const hash = getHash(...args);
    const cachedValue = cacheMap[hash];
    if (cachedValue) {
      return cachedValue;
    }
    cacheMap[hash] = fn(...args);
    return cacheMap[hash];
  };
  return memoized;
}

export function numToBytes(value: number, bytes: number) {
  const buffer = Buffer.alloc(bytes);
  if (bytes === 1) {
    buffer.writeUInt8(value);
  } else if (bytes === 2) {
    buffer.writeUInt16BE(value);
  } else if (bytes === 4) {
    buffer.writeUInt32BE(value);
  } else {
    throw new Error('Only supports number under 32 bits');
  }
  return buffer;
}

const getHexStringBuffer = memoizer(
  (str: string) => str,
  (str: string) => Buffer.from(str, 'hex'),
);
const getCipherInfo = memoizer(
  (token: string) => token,
  (token: string) => {
    const tokenBuffer = getHexStringBuffer(token);
    const key = md5(tokenBuffer);
    const iv = md5(key, tokenBuffer);
    return { key, iv };
  },
);

export function serialize(packet: Packet, token: string): Buffer {
  if (!token && !packet.isHandshake) {
    throw new Error('Only handshake packet can be called without cipher');
  }
  if (packet.isHandshake) {
    return Buffer.concat([
      MAGIC_BUFFER,
      numToBytes(HEADER_BYTES, 2),
      MAX_4_BIT_BUFFER,
      MAX_4_BIT_BUFFER,
      MAX_4_BIT_BUFFER,
      MAX_16_BIT_BUFFER,
    ]);
  }
  const { key, iv } = getCipherInfo(token);
  const cipher = createCipheriv('aes-128-cbc', key, iv);
  const data = Buffer.concat([cipher.update(Buffer.from(packet.data)), cipher.final()]);
  const packetLength = numToBytes(HEADER_BYTES + data.byteLength, 2);
  const header = Buffer.concat([
    MAGIC_BUFFER,
    packetLength,
    DEFAULT_UNKNOWN_BUFFER,
    numToBytes(packet.deviceId, 4),
    numToBytes(packet.timestamp, 4),
  ]);
  const checksum = md5(
    ...[header, getHexStringBuffer(token), data.byteLength > 0 ? data : undefined].filter(
      (buffer: Buffer | undefined): buffer is Buffer => !!buffer,
    ),
  );
  return Buffer.concat([header, checksum, data]);
}

export function deserialize(buffer: Buffer, token: string): Packet {
  const packetLength = buffer.slice(2, 4);
  const deviceId = buffer.slice(8, 12);
  const timestamp = buffer.slice(12, 16);
  const checksum = buffer.slice(16, 32);
  const data = buffer.slice(32);
  if (data.byteLength === 0) {
    return {
      isHandshake: true,
      data,
      timestamp: timestamp.readUInt32BE(),
      deviceId: deviceId.readUInt32BE(),
    };
  }

  const header = Buffer.concat([
    MAGIC_BUFFER,
    packetLength,
    DEFAULT_UNKNOWN_BUFFER,
    deviceId,
    timestamp,
  ]);
  const localChecksum = md5(
    ...[header, getHexStringBuffer(token), data.byteLength > 0 ? data : undefined].filter(
      (buffer: Buffer | undefined): buffer is Buffer => !!buffer,
    ),
  );
  if (!checksum.equals(localChecksum)) {
    throw new Error('Checksum mismatch.');
  }
  const { key, iv } = getCipherInfo(token);
  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  const decryptedData = Buffer.concat([decipher.update(data), decipher.final()]);

  return {
    isHandshake: false,
    timestamp: timestamp.readUInt32BE(),
    data: Buffer.from(decryptedData.filter(value => value !== INVALID_MI_BUFFER_VALUE)),
    deviceId: deviceId.readUInt32BE(),
  };
}
