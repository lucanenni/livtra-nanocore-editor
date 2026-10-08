/** Standard CRC-32 (IEEE 802.3 / zlib: reflected polynomial `0xEDB88320`, init and final XOR
 * `0xFFFFFFFF`) — the checksum the NanoCore's profile-upload "finalize" command (`0x33`) carries
 * over the whole uploaded file. Confirmed against a real capture: the CRC-32 of the 12302-byte
 * file ToneCommand imported (`0xa3ae6122`) is exactly what it sent. Returns an unsigned 32-bit
 * number. */
const TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();

export function crc32(bytes: ArrayLike<number>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
