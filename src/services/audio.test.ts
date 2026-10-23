import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { writeWav } from '../core/wav'
import { ffmpegEncoder } from './audio'

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
