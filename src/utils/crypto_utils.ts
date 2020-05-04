import { createHash } from 'crypto';

export const md5 = (...bufferList: Buffer[]) =>
  bufferList.reduce((hash, buffer) => hash.update(buffer), createHash('md5')).digest();
