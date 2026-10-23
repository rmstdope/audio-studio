import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWhisperWorker } from './transcriber'

const fake = join(import.meta.dir, '../../test/fixtures/fake-whisper.ts')
const worker = createWhisperWorker({ command: [process.execPath, fake] })
afterAll(() => worker.close())

describe('createWhisperWorker', () => {
  it('asks the worker and gives its segments, several at once', async () => {
    const [a, b] = await Promise.all([
      worker.transcribe('tiny', '/clips/she-stops.wav'),
      worker.transcribe('tiny', '/clips/here.wav'),
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
    await expect(worker.transcribe('tiny', '/clips/fail.wav')).rejects.toThrow(
      'Whisper: RuntimeError: bad audio',
    )
    expect((await worker.transcribe('tiny', '/clips/ok.wav'))[0]!.words![0]!.word).toBe('ok')
  })

  it('reports a worker that dies, and starts a new one next time', async () => {
    await expect(worker.transcribe('tiny', '/clips/crash.wav')).rejects.toThrow('stopped')
    expect((await worker.transcribe('tiny', '/clips/again.wav'))[0]!.words![0]!.word).toBe('again')
  })

  it('gives up on a request that takes too long, failing the waiting ones with the reason', async () => {
    const slow = createWhisperWorker({ command: [process.execPath, fake], timeoutMs: 500 })
    const waiting = Promise.allSettled([
      slow.transcribe('tiny', '/clips/hang.wav'),
      slow.transcribe('tiny', '/clips/next.wav'),
    ])
    const [first, second] = await waiting
    expect(first.status === 'rejected' && String(first.reason)).toContain('took longer than')
    expect(second.status === 'rejected' && String(second.reason)).toContain('took longer than')
    expect((await slow.transcribe('tiny', '/clips/after.wav'))[0]!.words![0]!.word).toBe('after')
    slow.close()
  })

  it('says what is missing when the worker cannot start', async () => {
    const missing = createWhisperWorker({ command: ['no-such-command-xyz'] })
    await expect(missing.transcribe('tiny', '/clips/a.wav')).rejects.toThrow(
      'Whisper could not start',
    )
    missing.close()
  })
})

// Live: downloads mlx-whisper and its model (about 1.6 GB) the first time. Opt in with AUDIO_STUDIO_LIVE=1.
const realWhisper =
  process.env.AUDIO_STUDIO_LIVE === '1' &&
  process.platform === 'darwin' &&
  Boolean(Bun.which('uv') && Bun.which('say') && Bun.which('ffmpeg'))

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
    const real = createWhisperWorker()
    try {
      const segments = await real.transcribe(
        'mlx-community/whisper-large-v3-turbo',
        join(dir, 'speech.wav'),
      )
      const words = segments.flatMap((s) => s.words ?? []).map((w) => w.word.trim().toLowerCase())
      expect(words).toEqual(['the', 'storm', 'is', 'gone.'])
    } finally {
      real.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
