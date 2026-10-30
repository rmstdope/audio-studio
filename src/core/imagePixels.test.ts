import { describe, expect, it } from 'bun:test'
import { lookOf, type Look } from './imageLook'
import { StyleSchema } from './images'
import { bringToLook, fitToSize, isCropped, type Pixels } from './imagePixels'

/** A picture made of `colour(x, y)`. */
function picture(
  width: number,
  height: number,
  colour: (x: number, y: number) => [number, number, number],
): Pixels {
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      data.set([...colour(x, y), 255], i)
    }
  }
  return { width, height, data }
}

const look = (raw: object): Look => lookOf(StyleSchema.parse({ look: 'x', palette: [], ...raw }))
const pixelAt = (p: Pixels, x: number, y: number) => [
  ...p.data.slice((y * p.width + x) * 4, (y * p.width + x) * 4 + 3),
]
const coloursIn = (p: Pixels) => {
  const seen = new Set<string>()
  for (let i = 0; i < p.data.length; i += 4)
    seen.add(`${p.data[i]},${p.data[i + 1]},${p.data[i + 2]}`)
  return seen
}
const ramp = picture(64, 64, (x) => [x * 4, x * 4, x * 4])

describe('size', () => {
  it('is exactly the listed size, whatever the shape of the picture', () => {
    const out = fitToSize(
      picture(100, 50, () => [1, 2, 3]),
      { width: 32, height: 18 },
    )
    expect([out.width, out.height, out.data.length]).toEqual([32, 18, 32 * 18 * 4])
  })
  it('crops to fill: keeps the middle and cuts the edges that do not fit', () => {
    // Left third red, middle third green, right third blue; a square from a wide picture keeps the middle.
    const wide = picture(90, 30, (x) => (x < 30 ? [255, 0, 0] : x < 60 ? [0, 255, 0] : [0, 0, 255]))
    const out = fitToSize(wide, { width: 10, height: 10 })
    expect(coloursIn(out)).toEqual(new Set(['0,255,0']))
    const tall = picture(30, 90, (_x, y) =>
      y < 30 ? [255, 0, 0] : y < 60 ? [0, 255, 0] : [0, 0, 255],
    )
    expect(coloursIn(fitToSize(tall, { width: 10, height: 10 }))).toEqual(new Set(['0,255,0']))
  })
  it('averages the area each new pixel covers', () => {
    const checker = picture(2, 2, (x, y) => ((x + y) % 2 ? [200, 200, 200] : [0, 0, 0]))
    expect(pixelAt(fitToSize(checker, { width: 1, height: 1 }), 0, 0)).toEqual([100, 100, 100])
  })
  it('knows when a picture has another shape', () => {
    expect(isCropped({ width: 1024, height: 576 }, { width: 320, height: 180 })).toBe(false)
    expect(isCropped({ width: 1024, height: 1024 }, { width: 320, height: 180 })).toBe(true)
  })
})

describe('colours', () => {
  const size = { width: 64, height: 64 }
  const six = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00']
  it('uses only the listed palette, with every dithering', () => {
    for (const dithering of ['flat', 'patterned', 'scattered']) {
      const out = bringToLook(ramp, look({ palette: six, dithering }), size)
      const allowed = new Set([
        '0,0,0',
        '255,255,255',
        '255,0,0',
        '0,255,0',
        '0,0,255',
        '255,255,0',
      ])
      for (const c of coloursIn(out)) expect(allowed.has(c)).toBe(true)
    }
  })
  it('flat colour picks the nearest colour; patterned mixes the two nearest in a pattern', () => {
    const grey = picture(16, 16, () => [128, 128, 128])
    const palette = ['#000000', '#ffffff']
    const flat = bringToLook(grey, look({ palette, dithering: 'flat' }), { width: 16, height: 16 })
    expect(coloursIn(flat).size).toBe(1)
    const patterned = bringToLook(grey, look({ palette }), { width: 16, height: 16 })
    expect(coloursIn(patterned)).toEqual(new Set(['0,0,0', '255,255,255']))
    // about half of each, and the 8 × 8 pattern repeats
    let white = 0
    for (let i = 0; i < patterned.data.length; i += 4) if (patterned.data[i] === 255) white++
    expect(white).toBeGreaterThan(100)
    expect(white).toBeLessThan(156)
    expect(pixelAt(patterned, 3, 5)).toEqual(pixelAt(patterned, 11, 13))
  })
  it('scattered dithering also mixes them, differently from the pattern', () => {
    const grey = picture(16, 16, () => [128, 128, 128])
    const out = bringToLook(
      grey,
      look({ palette: ['#000000', '#ffffff'], dithering: 'scattered' }),
      { width: 16, height: 16 },
    )
    expect(coloursIn(out)).toEqual(new Set(['0,0,0', '255,255,255']))
  })
  it('keeps a colour that is in the palette as it is, however it is dithered', () => {
    const red = picture(16, 16, () => [255, 0, 0])
    for (const dithering of ['flat', 'patterned', 'scattered']) {
      expect(
        coloursIn(bringToLook(red, look({ palette: six, dithering }), { width: 16, height: 16 })),
      ).toEqual(new Set(['255,0,0']))
    }
  })
  it('8-bit is one fixed set of 8 reds × 8 greens × 4 blues, the same for every picture', () => {
    const out = bringToLook(
      picture(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]),
      look({ colourDepth: '8-bit', dithering: 'flat' }),
      size,
    )
    const reds = new Set<number>()
    const blues = new Set<number>()
    for (let i = 0; i < out.data.length; i += 4) {
      reds.add(out.data[i]!)
      blues.add(out.data[i + 2]!)
    }
    for (const r of reds) expect([0, 36, 73, 109, 146, 182, 219, 255]).toContain(r)
    for (const b of blues) expect([0, 85, 170, 255]).toContain(b)
    // a colour of the set is kept
    const same = picture(8, 8, () => [219, 73, 170])
    expect(
      pixelAt(bringToLook(same, look({ colourDepth: '8-bit' }), { width: 8, height: 8 }), 0, 0),
    ).toEqual([219, 73, 170])
  })
  it('16-bit has 32 reds, 64 greens and 32 blues', () => {
    const out = bringToLook(ramp, look({ colourDepth: '16-bit', dithering: 'flat' }), size)
    expect(coloursIn(out).size).toBeLessThanOrEqual(64)
    const reds = new Set([...coloursIn(out)].map((c) => c.split(',')[0]))
    expect(reds.size).toBeLessThanOrEqual(32)
    expect(pixelAt(out, 0, 0)).toEqual([0, 0, 0])
    // 100 is not a level of 32: it moves to the nearest, 99 (level 12 of 31)
    const one = picture(4, 4, () => [100, 100, 100])
    expect(
      pixelAt(
        bringToLook(one, look({ colourDepth: '16-bit', dithering: 'flat' }), {
          width: 4,
          height: 4,
        }),
        0,
        0,
      ),
    ).toEqual([99, 101, 99])
  })
  it('full colour changes nothing but the size', () => {
    const src = picture(8, 8, (x, y) => [x * 30, y * 30, 7])
    expect(bringToLook(src, look({}), { width: 8, height: 8 }).data).toEqual(src.data)
  })
  it('gives the same bytes every time, and opaque pixels', () => {
    const a = bringToLook(ramp, look({ palette: six }), { width: 20, height: 10 })
    const b = bringToLook(ramp, look({ palette: six }), { width: 20, height: 10 })
    expect(a.data).toEqual(b.data)
    for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(255)
  })
})
