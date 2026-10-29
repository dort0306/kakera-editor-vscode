import { deflateSync } from 'node:zlib';
export function pngFixture(): Buffer {
  function chunk(name: string, bytes: Buffer): Buffer {
    const data = Buffer.concat([Buffer.from(name), bytes]), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    let sum = 0xffffffff;
    for (const byte of data) { sum ^= byte; for (let i = 0; i < 8; i++) sum = (sum >>> 1) ^ (sum & 1 ? 0xedb88320 : 0); }
    length.writeUInt32BE(bytes.length); crc.writeUInt32BE((sum ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, data, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,80,50,255]))), chunk('IEND', Buffer.alloc(0))]);
}
