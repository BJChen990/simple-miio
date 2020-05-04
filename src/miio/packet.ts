export const MAX_2_BIT_BUFFER = Buffer.alloc(2, 0xff);
export const MAX_4_BIT_BUFFER = Buffer.alloc(4, 0xff);
export const MAX_16_BIT_BUFFER = Buffer.alloc(16, 0xff);
export const DEFAULT_UNKNOWN_BUFFER = Buffer.alloc(4);
export const MAGIC_BUFFER = Buffer.of(0x21, 0x31);

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
export interface HeaderStruct {
  // Packet length: 16 bits unsigned int
  // Length in bytes of the whole packet, including the header.
  packetLength: number;

  // Unknown1: 32 bits
  // This value is always 0,
  // except in the "Hello" packet, when it's 0xFFFFFFFF
  unknown: number;

  // Device ID: 32 bits
  // Unique number. Possibly derived from the MAC address.
  // except in the "Hello" packet, when it's 0xFFFFFFFF
  deviceId: number;

  // Stamp: 32 bit unsigned int
  //     continously increasing counter
  timestamp: number;

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
