import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWhisperWorker } from './transcriber'

const fake = join(import.meta.dir, '../../test/fixtures/fake-whisper.ts')
const worker = createWhisperWorker({ model: 'tiny', command: [process.execPath, fake] })
afterAll(() => worker.close())

describe('createWhisperWorker', () => {
  it('asks the worker and gives its segments, several at once', async () => {
    const [a, b] = await Promise.all([
      worker.transcribe('/clips/she-stops.wav'),
      worker.transcribe('/clips/here.wav'),
    ])
    expect(a).toEqual([
      {
        start: 0,
        end: 2,
        words: [
          { word: 'she', start: 0, end: 0.5 },
          { word: 'stops', start: 1, end: 1.5 },
        ],
      },
    ])
    expect(b[0]!.words!.map((w) => w.word)).toEqual(['here'])
  })

  it('passes on the worker’s error, and keeps working', async () => {
    await expect(worker.transcribe('/clips/fail.wav')).rejects.toThrow(
      'Whisper: RuntimeError: bad audio',
    )
    expect((await worker.transcribe('/clips/ok.wav'))[0]!.words![0]!.word).toBe('ok')
  })

  it('reports a worker that dies, and starts a new one next time', async () => {
    await expect(worker.transcribe('/clips/crash.wav')).rejects.toThrow('stopped')
    expect((await worker.transcribe('/clips/again.wav'))[0]!.words![0]!.word).toBe('again')
  })

  it('says what is missing when the worker cannot start', async () => {
    const missing = createWhisperWorker({ model: 'tiny', command: ['no-such-command-xyz'] })
    await expect(missing.transcribe('/clips/a.wav')).rejects.toThrow('Whisper could not start')
    missing.close()
  })
})

const realWhisper =
  process.platform === 'darwin' && Bun.which('uv') && Bun.which('say') && Bun.which('ffmpeg')

describe.skipIf(!realWhisper)('createWhisperWorker, with real Whisper (macOS)', () => {
  it('hears real speech, word by word', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'audio-studio-whisper-'))
    Bun.spawnSync(['say', '-o', join(dir, 'speech.aiff'), 'The storm is gone.'])
    Bun.spawnSync([
      'ffmpeg',
      '-loglevel',
      'error',
      '-y',
      '-i',
      join(dir, 'speech.aiff'),
      '-ac',
      '1',
      join(dir, 'speech.wav'),
    ])
    const real = createWhisperWorker({ model: 'mlx-community/whisper-large-v3-turbo' })
    try {
      const segments = await real.transcribe(join(dir, 'speech.wav'))
      const words = segments.flatMap((s) => s.words ?? []).map((w) => w.word.trim().toLowerCase())
      expect(words).toEqual(['the', 'storm', 'is', 'gone.'])
    } finally {
      real.close()
    }
  }, 600_000)
})
