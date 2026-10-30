import { describe, expect, it } from 'bun:test'
import { StyleSchema } from './images'
import { describeLook, explainStyleProblem, lookChanges, lookKey, lookOf } from './imageLook'

const base = { look: 'pixel art', palette: [] as string[] }
const size = { width: 320, height: 180 }
const six = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#ffff00']

describe("the game's look from its style", () => {
  it('lists a palette first: it wins over a colour depth', () => {
    const style = StyleSchema.parse({ ...base, palette: six, colourDepth: '8-bit' })
    expect(lookOf(style).colours.kind).toBe('palette')
    expect(describeLook(lookOf(style), size)).toBe(
      "320 × 180 · the game's palette, 6 colours · patterned dithering",
    )
  })
  it('names the colour depth when no palette is listed, and is full colour by default', () => {
    const eight = lookOf(StyleSchema.parse({ ...base, colourDepth: '8-bit' }))
    expect(describeLook(eight, size)).toBe('320 × 180 · 8-bit colour · patterned dithering')
    const sixteen = lookOf(StyleSchema.parse({ ...base, colourDepth: '16-bit', dithering: 'flat' }))
    expect(describeLook(sixteen, size)).toBe('320 × 180 · 16-bit colour · flat colour')
    const full = lookOf(StyleSchema.parse({ ...base, dithering: 'scattered' }))
    expect(describeLook(full, size)).toBe('320 × 180 · full colour')
  })
  it('names scattered dithering and a single colour', () => {
    const one = lookOf(StyleSchema.parse({ ...base, palette: ['#000000'], dithering: 'scattered' }))
    expect(describeLook(one, size)).toBe(
      "320 × 180 · the game's palette, 1 colour · scattered dithering",
    )
  })
  it('refuses a depth or dithering the game does not know', () => {
    expect(StyleSchema.safeParse({ ...base, colourDepth: '4-bit' }).success).toBe(false)
    expect(StyleSchema.safeParse({ ...base, dithering: 'blue noise' }).success).toBe(false)
  })
  it("says the palette can't be read when the style is unusable", () => {
    expect(describeLook(null, size)).toBe("320 × 180 · the game's palette — can't be read")
  })
})

describe('what a look is brought to', () => {
  const key = (raw: object, s = size) => lookKey(lookOf(StyleSchema.parse({ ...base, ...raw })), s)
  it('is the same for the same look and differs for each part of it', () => {
    expect(key({ palette: six })).toBe(key({ palette: six }))
    expect(key({ palette: six })).not.toBe(key({ palette: six.slice(1) }))
    expect(key({ colourDepth: '8-bit' })).not.toBe(key({ colourDepth: '16-bit' }))
    expect(key({ colourDepth: '8-bit' })).not.toBe(key({ colourDepth: '8-bit', dithering: 'flat' }))
    expect(key({})).not.toBe(key({}, { width: 64, height: 64 }))
  })
  it('does not depend on dithering in full colour, nor on a depth beside a palette', () => {
    expect(key({ dithering: 'flat' })).toBe(key({ dithering: 'scattered' }))
    expect(key({ palette: six, colourDepth: '8-bit' })).toBe(key({ palette: six }))
  })
  it('names what changed between two keys', () => {
    expect(lookChanges(key({ palette: six }), key({ palette: six.slice(1) }))).toEqual([
      'its palette',
    ])
    expect(lookChanges(key({ colourDepth: '8-bit' }), key({ colourDepth: '16-bit' }))).toEqual([
      'its colour depth',
    ])
    expect(lookChanges(key({ palette: six }), key({ palette: six, dithering: 'flat' }))).toEqual([
      'its dithering',
    ])
    expect(lookChanges(key({}), key({}, { width: 64, height: 64 }))).toEqual(["an image's size"])
    expect(lookChanges(null, key({}))).toEqual(['its look'])
  })
})

describe("explaining a style that can't be used", () => {
  it('names the palette colour that is not one', () => {
    const raw = { ...base, palette: ['#000000', '#ffffff', '#7fb0e'] }
    const parsed = StyleSchema.safeParse(raw)
    expect(parsed.success).toBe(false)
    expect(explainStyleProblem(raw, 'images/style.json')).toBe(
      "Can't bring this take to the game's look: the style file's palette has a colour that isn't one: palette 3, “#7fb0e”.",
    )
  })
  it('falls back to the file and the place', () => {
    expect(explainStyleProblem({ palette: [] }, 'images/style.json')).toContain(
      "Can't bring this take to the game's look: images/style.json",
    )
    expect(explainStyleProblem(null, 'images/style.json')).toContain('images/style.json')
  })
})
