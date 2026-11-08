import { describe, expect, it } from 'bun:test'
import { inflateSync } from 'node:zlib'
import { decodePng, encodePng, encodeTransparentPng, pngSize } from './png'
import type { Pixels } from '../core/imagePixels'

const gradient = (w: number, h: number): Pixels => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) data.set([x * 7 + y, y * 5, (x * y) % 256, 255], (y * w + x) * 4)
  }
  return { width: w, height: h, data }
}

describe('png', () => {
  it('round-trips the pixels', () => {
    const picture = gradient(37, 19)
    const back = decodePng(encodePng(picture))
    expect([back.width, back.height]).toEqual([37, 19])
    expect(back.data).toEqual(picture.data)
  })
  it('reads the size from the start of the file', () => {
    expect(pngSize(encodePng(gradient(37, 19)).subarray(0, 33))).toEqual({ width: 37, height: 19 })
  })
  it('says a file is not a PNG when asked its size', () => {
    expect(() => pngSize(new TextEncoder().encode('not a picture'))).toThrow('not a PNG')
  })
  it('keeps the transparency of a picture written with it', () => {
    const picture = gradient(9, 5)
    picture.data[3] = 0
    picture.data[7] = 128
    const png = encodeTransparentPng(picture)
    expect(png[25]).toBe(6) // the colour type of RGBA
    const length = new DataView(png.buffer, png.byteOffset).getUint32(33)
    const raw = inflateSync(png.subarray(41, 41 + length))
    expect([raw[4], raw[8], raw[12]]).toEqual([0, 128, 255])
  })
  it('reads what other encoders write: RGBA with filters, and a palette picture', async () => {
    const source = encodePng(gradient(40, 30))
    const filtered = await new Bun.Image(source).resize(20, 15).png().bytes()
    const rgba = decodePng(filtered)
    expect([rgba.width, rgba.height]).toEqual([20, 15])
    const indexed = await new Bun.Image(source).png({ palette: true }).bytes()
    const palette = decodePng(indexed)
    expect([palette.width, palette.height]).toEqual([40, 30])
    for (let i = 3; i < palette.data.length; i += 4) expect(palette.data[i]).toBe(255)
  })
  it('says what is wrong with something that is not a usable png', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow('not a PNG')
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(() => decodePng(jpeg)).toThrow('not a PNG')
  })
})
