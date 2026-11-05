import { describe, expect, it } from 'bun:test'
import {
  EMPTY_LINE,
  FadesSchema,
  applyFades,
  fadeGain,
  fadesLine,
  fadesProblem,
  hasFades,
  lengthAtX,
  stepHandle,
  tooLongLine,
  type Fades,
} from './fades'
import type { Wav } from './wav'

/** A mono 16-bit WAV of constant `level`, `seconds` long at 100 Hz (so a frame is 10 ms). */
function flat(seconds: number, level = 10000, channels = 1): Wav {
  const frames = Math.round(seconds * 100)
  const samples = new Int16Array(frames * channels).fill(level)
  return {
    format: { channels, sampleRate: 100, bitsPerSample: 16 },
    data: new Uint8Array(samples.buffer),
  }
}

function read(wav: Wav): Int16Array {
  return new Int16Array(wav.data.buffer, wav.data.byteOffset, wav.data.byteLength / 2)
}

const none: Fades = { in: 0, out: 0, shape: 'smooth' }

describe('fades', () => {
  it('knows whether a take has any', () => {
    expect(hasFades(none)).toBe(false)
    expect(hasFades({ ...none, in: 0.1 })).toBe(true)
    expect(hasFades({ ...none, out: 0.1 })).toBe(true)
  })

  it('leaves a take with no fades as it was', () => {
    expect(read(applyFades(flat(2), none))).toEqual(read(flat(2)))
  })

  it('fades in from silence and out to silence, straight', () => {
    const out = read(applyFades(flat(2), { in: 1, out: 1, shape: 'straight' }))
    expect(out[0]).toBe(0)
    expect(out[50]).toBeGreaterThan(4900)
    expect(out[50]).toBeLessThan(5100)
    expect(out[199]).toBe(0)
    // Between the fades the sound is untouched (here they meet at the middle).
    const mid = read(applyFades(flat(4), { in: 1, out: 1, shape: 'straight' }))
    expect(mid[200]).toBe(10000)
  })

  it('smooth is even to the ear: half way is half the power, and it starts and ends at zero', () => {
    const out = read(applyFades(flat(4), { in: 1, out: 1, shape: 'smooth' }))
    expect(out[0]).toBe(0)
    expect(out[399]).toBe(0)
    expect(out[50]).toBe(5000)
    expect(out[25]).toBeLessThan(out[50]!)
  })

  it('fades every channel of a stereo take', () => {
    const out = read(applyFades(flat(2, 10000, 2), { in: 1, out: 0, shape: 'straight' }))
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0)
    expect(out[2 * 50]).toBe(out[2 * 50 + 1])
  })

  it('gain is 1 outside the fades and follows the shape inside', () => {
    const f: Fades = { in: 1, out: 2, shape: 'straight' }
    expect(fadeGain(f, 10, 0)).toBe(0)
    expect(fadeGain(f, 10, 0.5)).toBeCloseTo(0.5)
    expect(fadeGain(f, 10, 5)).toBe(1)
    expect(fadeGain(f, 10, 9)).toBeCloseTo(0.5)
    expect(fadeGain(f, 10, 10)).toBe(0)
  })

  it('refuses lengths that cannot be used, in the agreed words', () => {
    expect(fadesProblem({ ...none, in: 3, out: 2 }, 4.2)).toBe(tooLongLine(4.2))
    expect(tooLongLine(4.2)).toBe("The fades together can't be longer than the take (4.2 s).")
    expect(fadesProblem({ ...none, in: -1 }, 4.2)).toBe(EMPTY_LINE)
    expect(fadesProblem({ ...none, in: Number.NaN }, 4.2)).toBe(EMPTY_LINE)
    expect(EMPTY_LINE).toBe('Type a length of 0 s or more.')
    expect(fadesProblem({ ...none, in: 2, out: 2.2 }, 4.2)).toBeNull()
  })

  it('validates a body', () => {
    expect(FadesSchema.safeParse({ in: 0.3, out: 1.5, shape: 'smooth' }).success).toBe(true)
    expect(FadesSchema.safeParse({ in: -1, out: 0, shape: 'smooth' }).success).toBe(false)
    expect(FadesSchema.safeParse({ in: 0, out: 0, shape: 'wavy' }).success).toBe(false)
  })

  it('says its fades in one line', () => {
    expect(fadesLine({ in: 0.3, out: 1.5, shape: 'smooth' })).toBe(
      'Fades in 0.3 s · out 1.5 s · smooth',
    )
    expect(fadesLine({ in: 0.1, out: 0, shape: 'smooth' })).toBe('Fade in 0.1 s · smooth')
    expect(fadesLine({ in: 0, out: 1.5, shape: 'straight' })).toBe('Fade out 1.5 s · straight')
    expect(fadesLine({ in: 1, out: 2, shape: 'straight' })).toBe(
      'Fades in 1 s · out 2 s · straight',
    )
  })

  it('moves a handle 0.05 s, or 0.5 s with Shift, within the take', () => {
    expect(stepHandle(0.3, 1, false, 0, 4)).toBe(0.35)
    expect(stepHandle(0.3, -1, true, 0, 4)).toBe(0)
    expect(stepHandle(0.1, 1, false, 0, 4)).toBe(0.15)
    expect(stepHandle(3.9, 1, true, 0, 4)).toBe(4)
    expect(stepHandle(1, 1, false, 0, 1)).toBe(1)
  })

  it('turns a pointer position into a length on the 0.05 s grid', () => {
    expect(lengthAtX(50, 100, 4)).toBe(2)
    expect(lengthAtX(-10, 100, 4)).toBe(0)
    expect(lengthAtX(130, 100, 4)).toBe(4)
    expect(lengthAtX(11, 100, 4)).toBe(0.45)
  })
})
