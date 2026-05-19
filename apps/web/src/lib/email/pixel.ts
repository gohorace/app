/**
 * 43-byte standard 1×1 transparent GIF89a, served from /t/o/[token].
 *
 * Cached as a module-level Buffer so each pixel hit doesn't re-allocate.
 * Image format reference: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
 *
 * Why GIF and not PNG: a 1×1 transparent GIF is 43 bytes; the smallest
 * comparable PNG is ~67 bytes and varies by encoder. Every byte saved is
 * a byte fewer for Gmail / Apple Mail / Outlook to prefetch through their
 * image proxies, which is the dominant cost at scale.
 */

export const TRANSPARENT_GIF: Buffer = Buffer.from([
  // Header
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61,             // "GIF89a"
  // Logical screen descriptor
  0x01, 0x00,                                     // width  = 1
  0x01, 0x00,                                     // height = 1
  0x80,                                           // packed: global color table flag, 1-bit table
  0x00,                                           // background color index
  0x00,                                           // pixel aspect ratio
  // Global color table (2 entries)
  0x00, 0x00, 0x00,                               // color 0: black
  0xff, 0xff, 0xff,                               // color 1: white
  // Graphic control extension (marks color 0 transparent)
  0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00,
  // Image descriptor
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  // Image data (1 pixel, color 0)
  0x02, 0x02, 0x44, 0x01, 0x00,
  // Trailer
  0x3b,
])

// Sanity check at module load — if the constant is ever edited and the
// length drifts, fail loud rather than serve a malformed image.
if (TRANSPARENT_GIF.length !== 43) {
  throw new Error(
    `TRANSPARENT_GIF must be exactly 43 bytes (got ${TRANSPARENT_GIF.length})`,
  )
}
