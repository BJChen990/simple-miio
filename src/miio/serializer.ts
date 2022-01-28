import {
  HandshakeRequestPacket,
  RequestPacket,
  ResponsePacket,
} from './packet';
import { md5 } from '../utils/crypto_utils';
import { createDecipheriv } from 'crypto';

export interface Packet {
  deviceId: number;
  timestamp: number;
  data: Buffer;
  isHandshake: boolean;
}

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
    return new HandshakeRequestPacket().raw;
  }
  return new RequestPacket(Buffer.from(token, 'hex'), packet.deviceId, packet.timestamp, packet.data).raw;
}

export function deserialize(buffer: Buffer) {
  return ResponsePacket.from(buffer);
}
