import { HEADER_BYTES, MAGIC_BUFFER, PacketImpl } from '../packet';

export function createPacket(data: any) {
  const dataBuff = Buffer.from(JSON.stringify(data));
  return new PacketImpl(
    MAGIC_BUFFER,
    dataBuff.byteLength + HEADER_BYTES,
    Buffer.alloc(4),
    5,
    10,
    Buffer.alloc(16),
    dataBuff
  );
}
