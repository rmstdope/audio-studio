import { describe, expect, it } from 'bun:test'
import {
  NOTHING_LINE,
  preciseClock,
  SILENT_LINE,
  cutLine,
  findTrim,
  trimFailure,
  trimWav,
  trimmedSeconds,
} from './musicTrim'
import { wavSeconds } from './musicTake'
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

describe('findTrim', () => {
  it('cuts the near-silence at both ends, keeping a little lead-in', () => {
    const found = findTrim(
      wavOf([
        [1.25, 50],
        [3, 8000],
        [3.05, 100],
      ]),
    )
    expect(found.kind).toBe('cut')
    if (found.kind !== 'cut') return
    expect(found.start).toBeCloseTo(1.2, 3)
    expect(found.end).toBeCloseTo(3.0, 3)
  })
  it('cuts one end only when the other already starts on its sound', () => {
    const found = findTrim(
      wavOf([
        [2, 8000],
        [1.5, 0],
      ]),
    )
    expect(found).toMatchObject({ kind: 'cut', start: 0 })
  })
  it('says nothing to cut when each end has under 0.05 s to cut', () => {
    expect(
      findTrim(
        wavOf([
          [0.08, 0],
          [2, 8000],
          [0.08, 0],
        ]),
      ),
    ).toEqual({ kind: 'nothing' })
  })
  it('says silent when no sample is above the threshold', () => {
    expect(findTrim(wavOf([[3, 200]]))).toEqual({ kind: 'silent' })
  })
})

describe('trimWav', () => {
  it('keeps only the part between the cuts', () => {
    const wav = wavOf([
      [1, 0],
      [2, 8000],
      [1, 0],
    ])
    const out = trimWav(wav, { start: 1, end: 1 })
    expect(wavSeconds(out)).toBeCloseTo(2, 3)
  })
  it('gives the trimmed length', () => {
    expect(trimmedSeconds(10, { start: 1.2, end: 3 })).toBeCloseTo(5.8, 6)
  })
})

describe('words', () => {
  it('says how much went from each end, to one decimal', () => {
    expect(cutLine({ start: 1.2, end: 3.0 })).toBe('1.2 s cut from the start, 3.0 s from the end')
    expect(cutLine({ start: 0.04, end: 2.96 })).toBe('0.0 s cut from the start, 3.0 s from the end')
  })
  it('keeps the agreed lines', () => {
    expect(NOTHING_LINE).toBe('Starts and ends on its sound: nothing to cut.')
    expect(SILENT_LINE).toBe('Near-silent throughout: there is no sound to keep.')
  })
  it('names the take and what the game plays when a trim fails', () => {
    expect(
      trimFailure(6, 'The take’s sound file could not be read.', { inGame: false, undo: false }),
    ).toBe(
      'Take 6 could not be trimmed: the take’s sound file could not be read. The take is as it was.',
    )
    expect(trimFailure(1, 'disk full', { inGame: true, undo: false })).toBe(
      'Take 1 could not be trimmed: disk full. The game still plays it as it was.',
    )
    expect(trimFailure(1, 'disk full', { inGame: true, undo: true })).toBe(
      'Take 1 could not be untrimmed: disk full. The game still plays it trimmed.',
    )
    expect(trimFailure(2, 'disk full', { inGame: false, undo: true })).toBe(
      'Take 2 could not be untrimmed: disk full. The take is as it was.',
    )
  })
})

describe('preciseClock', () => {
  it('shows tenths of a second', () => {
    expect(preciseClock(5.84)).toBe('0:05.8')
    expect(preciseClock(65.96)).toBe('1:06.0')
  })
})
