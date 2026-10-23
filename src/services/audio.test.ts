import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { readWav, writeWav } from '../core/wav'
import { createFfmpegEncoder, decodeClip, ffmpegEncoder } from './audio'

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
