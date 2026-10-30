import { deflateSync } from 'node:zlib'
import type { ImageGenerator } from './images'

/** The CRC-32 of some bytes, as PNG chunks carry. */
function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

/** One PNG chunk: length, type, data, checksum. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** A PNG of `width` × `height` pixels in a diagonal pattern of a colour taken from the seed. */
export function fakePng(width: number, height: number, seed: number): Uint8Array {
  const rows = new Uint8Array((width * 3 + 1) * height)
  const hue = [(seed * 53) % 200, (seed * 97) % 200, (seed * 31) % 200]
  for (let y = 0; y < height; y++) {
    const start = y * (width * 3 + 1)
    for (let x = 0; x < width; x++) {
      const light = ((x + y) >> 5) % 2 ? 55 : 0
      for (let c = 0; c < 3; c++) rows[start + 1 + x * 3 + c] = hue[c]! + light
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', header),
    chunk('IDAT', new Uint8Array(deflateSync(rows))),
    chunk('IEND', new Uint8Array()),
  ]
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    png.set(part, at)
    at += part.length
  }
  return png
}

/**
 * A stand-in generator for working on the studio's own pages (`AUDIO_STUDIO_FAKE_IMAGES=1`): a
 * patterned picture after a few seconds, a failure for a prompt that says "fail". It makes no art.
 */
export function createFakeImages(delayMs = 3000): ImageGenerator {
  return {
    ready: () => ({ ok: true }),
    async generate(request) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (request.prompt.includes('fail')) throw new Error('The image generator: out of memory')
      return {
        png: fakePng(request.width / 4, request.height / 4, request.seed),
        seed: request.seed,
      }
    },
  }
}
