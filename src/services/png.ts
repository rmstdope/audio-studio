import { deflateSync, inflateSync } from 'node:zlib'
import type { Pixels } from '../core/imagePixels'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** The CRC-32 table of the PNG chunks. */
const CRC = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** The CRC-32 of `bytes`. */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC[(c ^ b) & 255]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** One PNG chunk: length, type, data and CRC. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** The PNG of `pixels`: 8-bit RGB (the studio's pictures are opaque), no filtering, so it is the same bytes every time. */
export function encodePng(pixels: Pixels): Uint8Array {
  const { width, height, data } = pixels
  const raw = new Uint8Array(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    let o = y * (1 + width * 3)
    raw[o++] = 0
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      raw[o++] = data[i]!
      raw[o++] = data[i + 1]!
      raw[o++] = data[i + 2]!
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header.set([8, 2, 0, 0, 0], 8)
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** The samples per pixel of each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

/** The Paeth predictor of PNG filter 4. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * The pixels of a PNG: 8 bits per sample, any colour type, not interlaced (what the image models
 * write). A picture with transparency is read as it is, its alpha ignored by the look. Anything
 * else throws a sentence saying why.
 */
export function decodePng(bytes: Uint8Array): Pixels {
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) {
    throw new Error('The picture is not a PNG.')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0
  let height = 0
  let depth = 0
  let type = 0
  let interlace = 0
  let palette: Uint8Array = new Uint8Array()
  const idat: Uint8Array[] = []
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at)
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    if (name === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      depth = data[8]!
      type = data[9]!
      interlace = data[12]!
    } else if (name === 'PLTE') palette = data
    else if (name === 'IDAT') idat.push(data)
    else if (name === 'IEND') break
    at += 12 + length
  }
  const channels = CHANNELS[type]
  if (!width || !height || channels === undefined) throw new Error('The PNG has no usable header.')
  if (depth !== 8 || interlace !== 0) {
    throw new Error(
      'The PNG is not 8 bits per colour and non-interlaced, which is all the studio reads.',
    )
  }
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of idat) {
    joined.set(part, offset)
    offset += part.length
  }
  const raw = inflateSync(joined)
  const stride = width * channels
  if (raw.length < height * (stride + 1)) throw new Error('The PNG is cut short.')
  const rows = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!
      const left = i >= channels ? rows[y * stride + i - channels]! : 0
      const up = y ? rows[(y - 1) * stride + i]! : 0
      const upLeft = y && i >= channels ? rows[(y - 1) * stride + i - channels]! : 0
      const value =
        filter === 0
          ? x
          : filter === 1
            ? x + left
            : filter === 2
              ? x + up
              : filter === 3
                ? x + ((left + up) >> 1)
                : filter === 4
                  ? x + paeth(left, up, upLeft)
                  : -1
      if (value < 0) throw new Error('The PNG uses a filter the studio does not know.')
      rows[y * stride + i] = value & 255
    }
  }
  const data = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const s = p * channels
    let r: number
    let g: number
    let b: number
    if (type === 2 || type === 6) [r, g, b] = [rows[s]!, rows[s + 1]!, rows[s + 2]!]
    else if (type === 3) {
      const index = rows[s]! * 3
      ;[r, g, b] = [palette[index] ?? 0, palette[index + 1] ?? 0, palette[index + 2] ?? 0]
    } else r = g = b = rows[s]!
    data.set([r, g, b, 255], p * 4)
  }
  return { width, height, data }
}
