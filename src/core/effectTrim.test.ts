import { describe, expect, it } from 'bun:test'
import { EFFECT_TRIM_RULES, effectCutLine, effectTrimOffered } from './effectTrim'
import { findTrim } from './musicTrim'
import type { Wav } from './wav'

/** A mono 1000 Hz WAV from runs of [seconds, amplitude]. */
function wavOf(runs: [number, number][]): Wav {
  const samples: number[] = []
  for (const [seconds, amplitude] of runs) {
    for (let i = 0; i < seconds * 1000; i++) samples.push(i % 2 ? amplitude : -amplitude)
  }
  const data = new Int16Array(samples)
  return {
    format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
    data: new Uint8Array(data.buffer),
  }
}

describe('effect trim rules', () => {
  it('cut a start well under a tenth of a second', () => {
    const found = findTrim(
      wavOf([
        [0.04, 50],
        [0.5, 8000],
      ]),
      EFFECT_TRIM_RULES,
    )
    expect(found).toMatchObject({ kind: 'cut', end: 0 })
    if (found.kind === 'cut') expect(found.start).toBeCloseTo(0.03, 3)
  })
  it('leave a side with under 0.02 s to cut alone', () => {
    const found = findTrim(
      wavOf([
        [0.025, 50],
        [0.5, 8000],
      ]),
      EFFECT_TRIM_RULES,
    )
    expect(found.kind).toBe('nothing')
  })
  it('cut both ends and keep the stinger default unchanged', () => {
    const wav = wavOf([
      [0.04, 50],
      [0.5, 8000],
      [0.1, 50],
    ])
    expect(findTrim(wav, EFFECT_TRIM_RULES)).toMatchObject({ kind: 'cut' })
    expect(findTrim(wav)).toMatchObject({ kind: 'cut', start: 0, end: expect.any(Number) })
  })
})

describe('effectCutLine', () => {
  it('names both ends, in hundredths of a second', () => {
    expect(effectCutLine({ start: 0.22, end: 0.14 })).toBe(
      '0.22 s cut from the start, 0.14 s from the end',
    )
  })
  it('names only the end that lost something', () => {
    expect(effectCutLine({ start: 0.31, end: 0 })).toBe('0.31 s cut from the start')
    expect(effectCutLine({ start: 0, end: 0.14 })).toBe('0.14 s cut from the end')
  })
})

describe('effectTrimOffered', () => {
  it('is for a take made to play once on an effect that plays once', () => {
    expect(effectTrimOffered({ loops: false }, false)).toBe(true)
    expect(effectTrimOffered({ loops: true }, true)).toBe(false)
    expect(effectTrimOffered({ loops: true }, false)).toBe(false)
    expect(effectTrimOffered({ loops: false }, true)).toBe(false)
  })
})
