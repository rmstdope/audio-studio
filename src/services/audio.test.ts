import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { readWav, writeWav } from '../core/wav'
import { createFfmpegEncoder, decodeClip, ffmpegEncoder, levelClip } from './audio'

const hasFfmpeg = Bun.which('ffmpeg') !== null

describe.skipIf(!hasFfmpeg)('ffmpegEncoder', () => {
  const tone = writeWav({
    format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
    data: new Uint8Array(16000 * 2),
  })

  it('encodes a WAV into an MP3, leaving no temporary file', async () => {
    const root = tempRepo({})
    const file = join(root, 'clips', 'k1.mp3')
    await ffmpegEncoder(tone, file, { bitrate: '64k', channels: 1 })
    const bytes = readFileSync(file)
    expect(bytes.length).toBeGreaterThan(100)
    expect(readdirSync(join(root, 'clips'))).toEqual(['k1.mp3'])
  })

  it('reports ffmpeg’s own error when it stops reading early', async () => {
    const root = tempRepo({})
    const big = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(20_000_000),
    })
    const failing = ffmpegEncoder(big, join(root, 'k3.mp3'), { bitrate: 'zzz', channels: 1 })
    await expect(failing).rejects.toThrow('ffmpeg could not encode')
    await expect(failing).rejects.not.toThrow('EPIPE')
  })

  it('stops an encode that takes too long, keeping no file', async () => {
    const root = tempRepo({})
    const big = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(20_000_000),
    })
    const file = join(root, 'k4.mp3')
    const slow = createFfmpegEncoder({ timeoutMs: 1 })
    await expect(slow(big, file, { bitrate: '64k', channels: 1 })).rejects.toThrow(
      'took longer than',
    )
    expect(existsSync(file)).toBe(false)
  })

  it('fails on audio it cannot read, keeping no file', async () => {
    const root = tempRepo({})
    const file = join(root, 'k2.mp3')
    await expect(
      ffmpegEncoder(new Uint8Array([1, 2, 3]), file, { bitrate: '64k', channels: 1 }),
    ).rejects.toThrow('ffmpeg could not encode')
    expect(existsSync(file)).toBe(false)
    expect(readdirSync(root)).toEqual([])
  })
})

describe.skipIf(!hasFfmpeg)('decodeClip', () => {
  it('says when decoding takes too long', async () => {
    const root = tempRepo({})
    const file = join(root, 'one.mp3')
    const second = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(16000 * 2),
    })
    await ffmpegEncoder(second, file, { bitrate: '64k', channels: 1 })
    expect(decodeClip(file, { timeoutMs: 1 })).rejects.toThrow('took longer than')
  })

  it('decodes a clip to WAV at its own rate, and measures its length from it', async () => {
    const root = tempRepo({})
    const file = join(root, 'one.mp3')
    const second = writeWav({
      format: { channels: 1, sampleRate: 16000, bitsPerSample: 16 },
      data: new Uint8Array(16000 * 2),
    })
    await ffmpegEncoder(second, file, { bitrate: '64k', channels: 1 })
    // Piped, ffmpeg cannot fill in the sizes in the header (0xFFFFFFFF): the data is read to the end.
    const { wav, seconds } = await decodeClip(file)
    const { format, data } = readWav(wav)
    expect(format).toMatchObject({ channels: 1, sampleRate: 16000 })
    expect(data.length).toBe(Math.round(seconds * 16000) * 2)
    expect(seconds).toBeGreaterThan(0.95)
    expect(seconds).toBeLessThan(1.1)
  })
})

/** Two seconds of a 220 Hz tone at 24 kHz, at `amplitude` (0–1). */
function sine(amplitude: number): Uint8Array {
  const rate = 24000
  const data = new Uint8Array(rate * 2 * 2)
  const view = new DataView(data.buffer)
  for (let i = 0; i < rate * 2; i++) {
    view.setInt16(
      i * 2,
      Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * amplitude * 32767),
      true,
    )
  }
  return writeWav({ format: { channels: 1, sampleRate: rate, bitsPerSample: 16 }, data })
}

/** A file's integrated loudness, as ffmpeg's loudnorm measures it. */
async function lufsOf(file: string): Promise<number> {
  const run = Bun.spawnSync([
    'ffmpeg',
    '-hide_banner',
    '-nostats',
    '-i',
    file,
    '-af',
    'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
    '-f',
    'null',
    '-',
  ])
  const json = run.stderr
    .toString()
    .match(/\{[^{}]*\}/g)!
    .at(-1)!
  return Number(JSON.parse(json).input_i)
}

describe.skipIf(!hasFfmpeg || !Bun.which('ffprobe'))('levelClip', () => {
  it('brings a clip to the target loudness, keeping its rate, channels and bit rate', async () => {
    const root = tempRepo({})
    const file = join(root, 'quiet.mp3')
    await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1 })
    expect(Math.abs((await lufsOf(file)) + 16)).toBeGreaterThan(3)
    await levelClip(file, -16)
    expect(Math.abs((await lufsOf(file)) + 16)).toBeLessThanOrEqual(0.5)
    const probe = Bun.spawnSync([
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'stream=sample_rate,channels,bit_rate',
      '-of',
      'json',
      file,
    ])
    expect(JSON.parse(probe.stdout.toString()).streams[0]).toMatchObject({
      sample_rate: '24000',
      channels: 1,
      bit_rate: '64000',
    })
  })

  it('refuses a clip too silent to measure, leaving it as it was', async () => {
    const root = tempRepo({})
    const file = join(root, 'silent.mp3')
    const silent = writeWav({
      format: { channels: 1, sampleRate: 24000, bitsPerSample: 16 },
      data: new Uint8Array(24000 * 2),
    })
    await ffmpegEncoder(silent, file, { bitrate: '64k', channels: 1 })
    const before = readFileSync(file)
    await expect(levelClip(file, -16)).rejects.toThrow('too short or silent')
    expect(readFileSync(file)).toEqual(before)
    expect(readdirSync(root)).toEqual(['silent.mp3'])
  })

  it('says how loud the clip came out', async () => {
    const root = tempRepo({})
    const file = join(root, 'quiet.mp3')
    await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1 })
    expect(Math.abs((await levelClip(file, -16)) + 16)).toBeLessThanOrEqual(0.5)
  })

  it('leaves no clip when the encoder cannot level it', async () => {
    const root = tempRepo({})
    const file = join(root, 'clips', 'k1.mp3')
    const silent = writeWav({
      format: { channels: 1, sampleRate: 24000, bitsPerSample: 16 },
      data: new Uint8Array(24000 * 2),
    })
    await expect(
      ffmpegEncoder(silent, file, { bitrate: '64k', channels: 1, lufs: -16 }),
    ).rejects.toThrow('too short or silent')
    expect(readdirSync(join(root, 'clips'))).toEqual([])
  })

  it('is done by the encoder when the project names a loudness', async () => {
    const root = tempRepo({})
    const file = join(root, 'clips', 'k1.mp3')
    await ffmpegEncoder(sine(0.05), file, { bitrate: '64k', channels: 1, lufs: -16 })
    expect(Math.abs((await lufsOf(file)) + 16)).toBeLessThanOrEqual(0.5)
    expect(readdirSync(join(root, 'clips'))).toEqual(['k1.mp3'])
  })
})
