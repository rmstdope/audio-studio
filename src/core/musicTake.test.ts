import { describe, expect, test } from 'bun:test'
import {
  MusicBoardSchema,
  LOOP_EXTRA_SECONDS,
  SEAM_SECONDS,
  generatedSeconds,
  peaks,
  seamWav,
  shapeLoop,
  shapeStinger,
  wavSeconds,
} from './musicTake'
import { readWav, writeWav, type Wav } from './wav'

const RATE = 100

/** A mono 16-bit WAV at 100 Hz whose sample i is `at(i / RATE)`. */
function make(seconds: number, at: (t: number) => number): Wav {
  const samples = new Int16Array(Math.round(seconds * RATE))
  samples.forEach((_, i) => (samples[i] = Math.round(at(i / RATE))))
  return {
    format: { channels: 1, sampleRate: RATE, bitsPerSample: 16 },
    data: new Uint8Array(samples.buffer),
  }
}

function samplesOf(wav: Wav): Int16Array {
  return new Int16Array(
    wav.data.buffer.slice(wav.data.byteOffset, wav.data.byteOffset + wav.data.length),
  )
}

describe('generatedSeconds', () => {
  test('a loop is made 20 seconds longer than it plays, a stinger at the shortest', () => {
    expect(generatedSeconds('loop', 80)).toBe(80 + LOOP_EXTRA_SECONDS)
    expect(generatedSeconds('stinger', 6)).toBe(10)
  })
})

describe('shapeLoop', () => {
  test('is exactly as long as asked', () => {
    const shaped = shapeLoop(
      make(40, () => 1000),
      20,
    )
    expect(wavSeconds(shaped)).toBe(20)
  })

  test('keeps the middle of the take and blends the 4 s after the cut over the start', () => {
    // 0 until the cut, 10000 after it: the start must turn into 10000 where the tail is.
    const source = make(30, (t) => (t < 20 ? 0 : 10000))
    const out = samplesOf(shapeLoop(source, 20))
    expect(out[SEAM_SECONDS * RATE + 10]).toBe(0)
    // Equal-power crossfade: the first sample is all tail, the last of the blend all head.
    expect(out[0]).toBe(10000)
    expect(out[SEAM_SECONDS * RATE - 1]).toBeLessThan(500)
    // Halfway the two contribute, so it is neither pure head nor pure tail.
    const middle = out[(SEAM_SECONDS * RATE) / 2]!
    expect(middle).toBeGreaterThan(5000)
    expect(middle).toBeLessThan(9000)
  })

  test('keeps a loud blend in range instead of wrapping it round to the other sign', () => {
    // ACE-Step peaks its takes at -1 dBFS (about 29200). Where head and tail are both that loud,
    // the equal-power sum reaches about 1.4 times full scale, which a 16-bit sample cannot hold.
    const source = make(30, () => 29000)
    const out = samplesOf(shapeLoop(source, 20))
    expect(Math.min(...out)).toBeGreaterThanOrEqual(29000)
    expect(out[(SEAM_SECONDS * RATE) / 2]).toBe(32767)
    const below = samplesOf(
      shapeLoop(
        make(30, () => -29000),
        20,
      ),
    )
    expect(Math.max(...below)).toBeLessThanOrEqual(-29000)
    expect(below[(SEAM_SECONDS * RATE) / 2]).toBe(-32768)
  })

  test('refuses a take too short to close its loop', () => {
    expect(() =>
      shapeLoop(
        make(22, () => 1),
        20,
      ),
    ).toThrow('too short')
  })
})

describe('shapeStinger', () => {
  const tone = (t: number) => 8000 * Math.sin(t * 40)

  test('cuts the silence after the sound and fades it out', () => {
    const source = make(10, (t) => (t < 4 ? tone(t) : 0))
    const shaped = shapeStinger(source, 10)
    const seconds = wavSeconds(shaped)
    expect(seconds).toBeGreaterThan(4)
    expect(seconds).toBeLessThan(5)
    const out = samplesOf(shaped)
    expect(Math.abs(out[out.length - 1]!)).toBeLessThan(200)
    expect(Math.abs(out[100]!)).toBeGreaterThan(1000)
  })

  test('is cut at the length asked when the sound runs on', () => {
    const shaped = shapeStinger(make(10, tone), 6)
    expect(wavSeconds(shaped)).toBe(6)
    const out = samplesOf(shaped)
    expect(Math.abs(out[out.length - 1]!)).toBeLessThan(200)
  })

  test('survives a take that is all silence', () => {
    expect(
      wavSeconds(
        shapeStinger(
          make(10, () => 0),
          6,
        ),
      ),
    ).toBeGreaterThan(0)
  })
})

describe('peaks', () => {
  test('gives the loudest sample of each stretch, scaled to the loudest of all', () => {
    const wav = make(4, (t) => (t < 2 ? 1000 : 4000))
    expect(peaks(wav, 4)).toEqual([0.25, 0.25, 1, 1])
  })

  test('is flat for silence', () => {
    expect(
      peaks(
        make(1, () => 0),
        3,
      ),
    ).toEqual([0, 0, 0])
  })

  test('round-trips through a WAV file', () => {
    const wav = make(1, () => 100)
    expect(wavSeconds(readWav(writeWav(wav)))).toBe(1)
  })
})

describe('seamWav', () => {
  test('is the last seconds of a loop followed by its first, as the game plays them', () => {
    const wav = make(20, (t) => (t < 10 ? 1000 : 2000))
    const out = seamWav(wav)
    expect(wavSeconds(out)).toBe(2 * SEAM_SECONDS)
    const samples = samplesOf(out)
    expect(samples[0]).toBe(2000)
    expect(samples[SEAM_SECONDS * RATE - 1]).toBe(2000)
    expect(samples[SEAM_SECONDS * RATE]).toBe(1000)
  })

  test('takes the whole of a loop shorter than the seam, twice', () => {
    expect(wavSeconds(seamWav(make(3, () => 1)))).toBe(6)
  })
})

describe('MusicBoardSchema', () => {
  const take = {
    n: 1,
    hash: 'abcdef0123456789',
    seed: 5,
    seconds: 30,
    peaks: [0.5],
    inputs: { brief: 'b', kind: 'loop', seconds: 30, bpm: null, key: null },
  }
  test('accepts a board with takes', () => {
    expect(MusicBoardSchema.safeParse({ next: 2, takes: [take] }).success).toBe(true)
  })
  test('refuses a take number of 0, a hash that is not 16 hex digits, and an unknown kind', () => {
    for (const bad of [
      { ...take, n: 0 },
      { ...take, hash: 'xyz' },
      { ...take, inputs: { ...take.inputs, kind: 'jingle' } },
    ]) {
      expect(MusicBoardSchema.safeParse({ next: 2, takes: [bad] }).success).toBe(false)
    }
    expect(MusicBoardSchema.safeParse({ next: 0, takes: [] }).success).toBe(false)
  })
})

describe('a take at another sample rate and in stereo', () => {
  /** A 44.1 kHz stereo tone, as Stable Audio makes. */
  function stereo(seconds: number) {
    const rate = 44100
    const frames = Math.round(seconds * rate)
    const samples = new Int16Array(frames * 2)
    for (let i = 0; i < frames; i++) {
      samples[2 * i] = Math.round(8000 * Math.sin(i / 20))
      samples[2 * i + 1] = Math.round(6000 * Math.sin(i / 25))
    }
    return {
      format: { channels: 2, sampleRate: rate, bitsPerSample: 16 },
      data: new Uint8Array(samples.buffer),
    }
  }
  test('cuts a loop at its length', () => {
    const wav = shapeLoop(stereo(27 + 20), 27)
    expect(wavSeconds(wav)).toBe(27)
    expect(wav.format).toMatchObject({ channels: 2, sampleRate: 44100 })
  })
  test('cuts a stinger at its length', () => {
    expect(wavSeconds(shapeStinger(stereo(10), 6))).toBe(6)
  })
})
