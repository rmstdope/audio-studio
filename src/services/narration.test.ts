import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { readWav, writeWav } from '../core/wav'
import type { Encoder } from './audio'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter } from './limit'
import { recordLine } from './narration'
import { loadPart } from './workspace'

/** A WAV of `seconds` of silence at 1000 Hz. */
function silence(seconds: number): Uint8Array {
  return writeWav({
    format: { channels: 1, sampleRate: 1000, bitsPerSample: 16 },
    data: new Uint8Array(Math.round(seconds * 1000) * 2),
  })
}

function fakeFish() {
  const requests: TtsRequest[] = []
  const fish: FishClient = {
    listVoices: () => Promise.reject(new Error('not used')),
    getVoice: () => Promise.reject(new Error('not used')),
    async tts(request) {
      requests.push(request)
      return silence(1)
    },
  }
  return { fish, requests }
}

/** An encoder that keeps the WAV as it is, so tests need no ffmpeg. */
const keepWav: Encoder = async (wav, file) => {
  await mkdir(dirname(file), { recursive: true })
  writeFileSync(file, wav)
}

const project = projectJson()
;(project.narration as { quality?: unknown }).quality = { chunkLimit: 100 }

const manifestText =
  '{\n "old": {\n  "file": "old.mp3",\n  "speaker": "mira",\n  "duration": 1.0,\n  "words": [\n   {\n    "word": "Gone\\u2026",\n    "start": 0.0,\n    "end": 1.0\n   }\n  ]\n }\n}\n'

const files = {
  'audio-studio.json': project,
  'tts/cast.json': {
    speakers: { narrator: { voice: 'v-n', style: '[warm]' }, mira: { voice: 'v-m' } },
    pronounce: { Elior: 'El-ee-or' },
  },
  'tts/act1/script.json': [
    { key: 'k1', speaker: 'narrator', text: 'Elior wakes up.' },
    {
      key: 'k2',
      speaker: 'narrator',
      text: `${'A long sentence that goes on. '.repeat(4)}The end.`,
    },
    { key: 'k3', speaker: 'tilda', text: 'No voice.' },
    { key: 'k4', speaker: 'mira', text: 'Welcome.' },
  ],
  'audio/act1/manifest.json': manifestText,
}

function record(root: string, key: string, fish: FishClient, encode: Encoder = keepWav) {
  return recordLine(join(root, 'audio-studio.json'), 'act1', key, async () => fish, {
    encode,
    limiter: createLimiter(),
  })
}

describe('recordLine', () => {
  it('records a line in its voice and style, and updates the manifest and lock', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await record(root, 'k1', fish)
    expect(result).toEqual({ ok: true, key: 'k1', duration: 1 })
    expect(requests).toEqual([
      {
        text: '[warm] El-ee-or wakes up.',
        voice: 'v-n',
        model: 's2.1-pro-free',
        temperature: 0.7,
        topP: 0.7,
        speed: 1,
        format: 'wav',
      },
    ])
    expect(readWav(readFileSync(join(root, 'audio/act1/k1.mp3'))).data.length).toBe(2000)
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8'))
    expect(manifest.k1).toEqual({
      file: 'k1.mp3',
      speaker: 'narrator',
      duration: 1,
      words: [
        { word: 'Elior', start: 0, end: 0.333 },
        { word: 'wakes', start: 0.333, end: 0.667 },
        { word: 'up.', start: 0.667, end: 1 },
      ],
    })
    const part = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.status).toBe('ok')
  })

  it('records a long line in sentence-sized pieces, joined with a short pause', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await record(root, 'k2', fish)
    expect(requests.length).toBe(2)
    expect(requests.every((r) => r.text.startsWith('[warm] '))).toBe(true)
    expect(result).toEqual({ ok: true, key: 'k2', duration: 2.25 })
  })

  it('writes the manifest the way it was written, changing only its own entry', async () => {
    const root = tempRepo(files)
    await record(root, 'k4', fakeFish().fish)
    const text = readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8')
    expect(
      text.startsWith('{\n "k4": {\n  "file": "k4.mp3",\n  "speaker": "mira",\n  "duration": 1.0,'),
    ).toBe(true)
    expect(text.endsWith(manifestText.slice(1))).toBe(true)
  })

  it('keeps both of two lines recorded at once', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    await Promise.all([record(root, 'k1', fish), record(root, 'k4', fish)])
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8'))
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(Object.keys(manifest).sort()).toEqual(['k1', 'k4', 'old'])
    expect(Object.keys(lock).sort()).toEqual(['k1', 'k4'])
  })

  it('refuses a line whose speaker has no voice, and knows no unknown line', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    expect(await record(root, 'k3', fish)).toMatchObject({ ok: false, reason: 'uncast' })
    expect(await record(root, 'nope', fish)).toBeNull()
    expect(requests).toEqual([])
  })

  it('changes nothing when Fish or the encoder fails', async () => {
    const root = tempRepo(files)
    const failing: FishClient = { ...fakeFish().fish, tts: () => Promise.reject(new Error('busy')) }
    expect(await record(root, 'k1', failing)).toEqual({
      ok: false,
      reason: 'fish',
      message: 'busy',
    })
    const broken: Encoder = () => Promise.reject(new Error('no ffmpeg'))
    expect(await record(root, 'k1', fakeFish().fish, broken)).toEqual({
      ok: false,
      reason: 'encode',
      message: 'no ffmpeg',
    })
    expect(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8')).toBe(manifestText)
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(false)
  })

  it('refuses while a file of the part is broken', async () => {
    const root = tempRepo({ ...files, 'tts/act1/narration.lock.json': '{ broken' })
    const result = await record(root, 'k1', fakeFish().fish)
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.file).toBe(
      'tts/act1/narration.lock.json',
    )
  })
})
