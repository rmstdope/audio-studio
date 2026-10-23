import { describe, expect, it } from 'bun:test'
import { joinWavs, readWav } from './wav'

/** A 16-bit mono WAV of `frames` frames at `rate`, optionally with a streaming placeholder length. */
function wav(frames: number, rate = 1000, placeholder = false): Uint8Array {
  const data = frames * 2
  const bytes = new Uint8Array(44 + data)
  const view = new DataView(bytes.buffer)
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + data, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, placeholder ? 0xfffffff0 : data, true)
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * 2, 1, true)
  return bytes
}

describe('readWav', () => {
  it('reads the format and the audio, measuring what is there, not the header', () => {
    const read = readWav(wav(500, 1000, true))
    expect(read.format).toMatchObject({ channels: 1, sampleRate: 1000, bitsPerSample: 16 })
    expect(read.data.length).toBe(1000)
  })

  it('refuses what is not a WAV', () => {
    expect(() => readWav(new Uint8Array([1, 2, 3]))).toThrow('not a WAV')
  })
})

describe('joinWavs', () => {
  it('joins pieces with a gap of silence, and gives the length of what was read', () => {
    const { wav: joined, seconds } = joinWavs([wav(500, 1000, true), wav(250, 1000, true)], 0.25)
    expect(seconds).toBeCloseTo(0.5 + 0.25 + 0.25, 6)
    const read = readWav(joined)
    expect(read.data.length).toBe((500 + 250 + 250) * 2)
    expect(new DataView(read.data.buffer, read.data.byteOffset).getInt16(500 * 2, true)).toBe(0)
  })

  it('refuses pieces of different formats', () => {
    expect(() => joinWavs([wav(10, 1000), wav(10, 2000)], 0.1)).toThrow('format')
  })
})
