import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWav, writeWav } from '../core/wav'
import { wavSeconds } from '../core/musicTake'
import { tempRepo } from '../../test/helpers'
import { ffmpegEncoder } from './audio'
import type { ElevenLabsClient, MusicPieceRequest } from './elevenlabs'
import { createElevenMusic } from './elevenMusic'

const wav = writeWav({
  format: { channels: 2, sampleRate: 44100, bitsPerSample: 16 },
  data: new Uint8Array(400),
})

/** A client whose music is three bytes of "MP3", recording what it was asked. */
function fakeClient() {
  const asked: MusicPieceRequest[] = []
  const client: ElevenLabsClient = {
    subscription: async () => {
      throw new Error('not used')
    },
    music: async (request) => {
      asked.push(request)
      return new Uint8Array([1, 2, 3])
    },
    tts: async () => {
      throw new Error('not used')
    },
  }
  return { client, asked }
}

const request = {
  brief: 'warm lute',
  kind: 'loop',
  seconds: 50,
  bpm: 84,
  key: 'D major',
  seed: 7,
  model: 'eleven',
} as const

describe('createElevenMusic', () => {
  it('is installed and ready with a key, and says where the key goes without one', async () => {
    const keyed = createElevenMusic({ apiKey: async () => 'k' })
    expect(await keyed.installed('eleven')).toBe(true)
    expect(await keyed.ready('eleven')).toEqual({ ok: true })
    const none = createElevenMusic({ apiKey: async () => null })
    expect(await none.installed('eleven')).toBe(false)
    expect(await none.ready('eleven')).toEqual({
      ok: false,
      message: 'There is no ElevenLabs key.',
      fix: 'Put ELEVENLABS_API_KEY=... in the project’s env file (from elevenlabs.io, Developers, API keys), or export it.',
    })
  })

  it('asks for the brief with its tempo and key, as long as asked, and gives the decoded take with no seed', async () => {
    const { client, asked } = fakeClient()
    const decoded: Uint8Array[] = []
    const music = createElevenMusic({
      apiKey: async () => 'k',
      client: (key) => (key === 'k' ? client : fakeClient().client),
      decode: async (mp3) => {
        decoded.push(mp3)
        return wav
      },
    })
    const take = await music.generate(request)
    expect(asked).toEqual([{ prompt: 'warm lute, 84 BPM, D major', lengthMs: 50_000 }])
    expect([...decoded[0]!]).toEqual([1, 2, 3])
    expect(take).toEqual({ wav })
    expect(take).not.toHaveProperty('seed')
  })

  it('sends the brief alone when it has no tempo or key', async () => {
    const { client, asked } = fakeClient()
    const music = createElevenMusic({
      apiKey: async () => 'k',
      client: () => client,
      decode: async () => wav,
    })
    await music.generate({ ...request, bpm: null, key: null })
    expect(asked[0]!.prompt).toBe('warm lute')
  })

  it('refuses a take without a key, saying so', async () => {
    const music = createElevenMusic({ apiKey: async () => null })
    await expect(music.generate(request)).rejects.toThrow('There is no ElevenLabs key.')
  })
})

describe.skipIf(Bun.which('ffmpeg') === null)('createElevenMusic, decoding with ffmpeg', () => {
  it('turns ElevenLabs’ MP3 into 16-bit WAV of its length, leaving no temporary file', async () => {
    const second = writeWav({
      format: { channels: 2, sampleRate: 44100, bitsPerSample: 16 },
      data: new Uint8Array(44100 * 4),
    })
    const mp3File = join(tempRepo({}), 'piece.mp3')
    await ffmpegEncoder(second, mp3File, { bitrate: '128k', channels: 2 })
    const mp3 = new Uint8Array(readFileSync(mp3File))
    const leftover = () => readdirSync(tmpdir()).filter((f) => f.startsWith('audio-studio-eleven-'))
    const before = leftover()
    const take = await createElevenMusic({
      apiKey: async () => 'k',
      client: () => ({ ...fakeClient().client, music: async () => mp3 }),
    }).generate(request)
    const { format } = readWav(take.wav)
    expect(format.bitsPerSample).toBe(16)
    expect(wavSeconds(readWav(take.wav))).toBeCloseTo(1, 1)
    expect(leftover()).toEqual(before)
  })
})
