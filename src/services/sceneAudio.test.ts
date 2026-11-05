import { describe, expect, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { writeWav } from '../core/wav'
import { ffmpegSceneAudio } from './sceneAudio'
import type { RenderPart } from './sceneLoudness'

const hasFfmpeg = Bun.which('ffmpeg') !== null

/** A mono sine of `seconds` at 440 Hz and `amplitude` (0 to 1), as a WAV file in `root`. */
function tone(root: string, name: string, seconds: number, amplitude: number): string {
  const rate = 44100
  const data = new Uint8Array(rate * seconds * 2)
  const view = new DataView(data.buffer)
  for (let i = 0; i < rate * seconds; i++) {
    view.setInt16(
      i * 2,
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * amplitude * 32767),
      true,
    )
  }
  const file = join(root, name)
  writeFileSync(
    file,
    writeWav({ format: { channels: 1, sampleRate: rate, bitsPerSample: 16 }, data }),
  )
  return file
}

const part = (file: string, over: Partial<RenderPart> = {}): RenderPart => ({
  source: { kind: 'effect', id: 'x' },
  level: 1,
  loop: true,
  starts: [0],
  file,
  ...over,
})

describe.skipIf(!hasFfmpeg)('ffmpegSceneAudio', () => {
  const root = tempRepo({})
  const audio = ffmpegSceneAudio(root)

  it('reads a clip’s length', async () => {
    const root = tempRepo({})
    expect(await audio.seconds(tone(root, 'a.wav', 3, 0.1))).toBeCloseTo(3, 1)
  })

  it('measures a looped clip, and a level of half is 6 dB quieter', async () => {
    const root = tempRepo({})
    const file = tone(root, 'a.wav', 3, 0.2)
    const full = await audio.loudness([part(file)], 60)
    const half = await audio.loudness([part(file, { level: 0.5 })], 60)
    expect(full).toBeLessThan(0)
    expect(full! - half!).toBeCloseTo(6.02, 0)
  })

  it('makes a second sound louder, and a level above 1 raises a clip', async () => {
    const dir = tempRepo({})
    const file = tone(dir, 'a.wav', 3, 0.1)
    const one = await audio.loudness([part(file)], 60)
    const two = await audio.loudness([part(file), part(file)], 60)
    const triple = await audio.loudness([part(file, { level: 2 })], 60)
    expect(two! - one!).toBeCloseTo(6.02, 0)
    expect(triple! - one!).toBeCloseTo(6.02, 0)
  })

  it('places one-shot starts inside the window', async () => {
    const root = tempRepo({})
    const file = tone(root, 'a.wav', 2, 0.2)
    const lufs = await audio.loudness([part(file, { loop: false, starts: [5, 30, 55] })], 60)
    const looped = await audio.loudness([part(file)], 60)
    // Silence between the clips is gated out of an integrated loudness, as it is for the game.
    expect(Math.abs(lufs! - looped!)).toBeLessThan(1)
  })

  it('gives null for silence', async () => {
    const root = tempRepo({})
    const file = tone(root, 'a.wav', 2, 0.2)
    expect(await audio.loudness([part(file, { level: 0 })], 60)).toBeNull()
  })

  it('names an unreadable clip by its path from the project root, never the absolute one', async () => {
    mkdirSync(join(root, 'audio/effects'), { recursive: true })
    const bad = join(root, 'audio/effects/wind-howl.mp3')
    writeFileSync(bad, 'not audio')
    const one = await audio.seconds(bad).catch((e: Error) => e.message)
    expect(one).toContain('ffprobe could not read audio/effects/wind-howl.mp3: Invalid data')
    expect(one).not.toContain(root)
    const mix = await audio.loudness([part(bad)], 60).catch((e: Error) => e.message)
    expect(mix).toContain('ffmpeg could not read audio/effects/wind-howl.mp3')
    expect(mix).not.toContain(root)
  })

  it('names every clip of a mix, in order, in full', async () => {
    mkdirSync(join(root, '.content-studio/effect-takes'), { recursive: true })
    const a = join(root, '.content-studio/effect-takes/a.mp3')
    const b = join(root, 'b.mp3')
    writeFileSync(a, 'x')
    writeFileSync(b, 'x')
    const mix = await audio.loudness([part(a), part(b)], 60).catch((e: Error) => e.message)
    expect(mix).toContain('could not read .content-studio/effect-takes/a.mp3, b.mp3:')
    expect(mix).not.toContain(root)
  })
})
