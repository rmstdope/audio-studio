import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { readWav, writeWav } from '../core/wav'
import type { Encoder } from './audio'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter } from './limit'
import type { Transcriber } from './transcriber'
import { recordLine, removeOrphans } from './narration'
import { inPartTurn } from './partFiles'
import { adoptPart, loadPart } from './workspace'

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

  it('records a line asked for twice at once only once', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const limiter = createLimiter()
    const projectFile = join(root, 'audio-studio.json')
    const once = () =>
      recordLine(projectFile, 'act1', 'k1', async () => fish, { encode: keepWav, limiter })
    await Promise.all([once(), once()])
    expect(requests).toHaveLength(1)
  })

  it('adopts in the part’s turn, so it never writes over a recording’s lock entry', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/manifest.json': { k4: { file: 'k4.mp3', speaker: 'mira' } },
      'audio/act1/k4.mp3': 'old clip',
    })
    const projectFile = join(root, 'audio-studio.json')
    let release = () => {}
    const held = inPartTurn(projectFile, 'act1', () => new Promise<void>((r) => (release = r)))
    const adopting = adoptPart(projectFile, 'act1')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(false)
    release()
    await held
    expect(await adopting).toMatchObject({ ok: true, adopted: 1 })
  })

  it('answers a write that fails part-way, leaving no temporary file and the line stale', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/narration.lock.json': {},
      'audio/act1/k1.mp3': 'old clip',
    })
    const lockFolder = join(root, 'tts/act1')
    const lockDown: Encoder = async (wav, file, options) => {
      await keepWav(wav, file, options)
      chmodSync(lockFolder, 0o555)
    }
    try {
      const result = await record(root, 'k1', fakeFish().fish, lockDown)
      expect(result).toMatchObject({ ok: false, reason: 'write' })
    } finally {
      chmodSync(lockFolder, 0o755)
    }
    expect(readdirSync(join(root, 'audio/act1')).filter((f) => f.startsWith('.'))).toEqual([])
    expect(readdirSync(lockFolder).filter((f) => f.includes('.tmp'))).toEqual([])
    const part = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.status).toBe('untracked')
  })

  it('leaves the old clip in place when the manifest turns out broken, and no stray file', async () => {
    const root = tempRepo({ ...files, 'audio/act1/k1.mp3': 'old clip' })
    const breakManifest: Encoder = async (wav, file, options) => {
      await keepWav(wav, file, options)
      writeFileSync(join(root, 'audio/act1/manifest.json'), '{ broken')
    }
    const result = await record(root, 'k1', fakeFish().fish, breakManifest)
    expect(result && !result.ok && 'problems' in result).toBe(true)
    expect(readFileSync(join(root, 'audio/act1/k1.mp3'), 'utf8')).toBe('old clip')
    expect(readdirSync(join(root, 'audio/act1')).sort()).toEqual(['k1.mp3', 'manifest.json'])
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

describe('removeOrphans', () => {
  const orphanFiles = {
    ...files,
    'audio/act1/manifest.json': {
      gone: { file: 'gone.mp3', speaker: 'mira', duration: 1, words: [] },
      k4: { file: 'k4.mp3', speaker: 'mira', duration: 1, words: [] },
      sneaky: { file: '../../tts/cast.json', speaker: 'mira', duration: 1, words: [] },
    },
    'audio/act1/gone.mp3': 'old',
    'audio/act1/k4.mp3': 'current',
    'tts/act1/narration.lock.json': {
      gone: {
        fp: 'x',
        voice: 'v',
        model: 'm',
        parts: { cue: '', text: '', said: '', settings: '' },
        at: 't',
      },
    },
  }

  it('removes the clips, manifest and lock entries of lines no longer in the dialog', async () => {
    const root = tempRepo(orphanFiles)
    const removed = await removeOrphans(join(root, 'audio-studio.json'), 'act1', [
      'gone',
      'k4',
      'sneaky',
    ])
    // `sneaky` points outside the clips folder: it is left alone, entry and all.
    expect(removed).toBe(1)
    expect(existsSync(join(root, 'audio/act1/gone.mp3'))).toBe(false)
    expect(existsSync(join(root, 'audio/act1/k4.mp3'))).toBe(true)
    expect(existsSync(join(root, 'tts/cast.json'))).toBe(true)
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8'))
    expect(Object.keys(manifest)).toEqual(['k4', 'sneaky'])
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock).toEqual({})
  })
})

describe('recordLine, only if needed', () => {
  it('skips a line that is up to date by now, without asking Fish', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    await record(root, 'k1', fish)
    const again = await recordLine(
      join(root, 'audio-studio.json'),
      'act1',
      'k1',
      async () => fish,
      {
        encode: keepWav,
        limiter: createLimiter(),
        onlyIfNeeded: true,
      },
    )
    expect(again).toEqual({ ok: true, key: 'k1', skipped: true })
    expect(requests).toHaveLength(1)
  })
})

describe('removeOrphans, shared and odd files', () => {
  it('keeps a clip another line still uses, and never deletes a file that is not a clip', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/manifest.json': {
        k4: { file: 'shared.mp3', speaker: 'mira', duration: 1, words: [] },
        old: { file: 'shared.mp3', speaker: 'mira', duration: 1, words: [] },
        odd: { file: 'notes.txt', speaker: 'mira', duration: 1, words: [] },
      },
      'audio/act1/shared.mp3': 'in use',
      'audio/act1/notes.txt': 'keep',
    })
    const removed = await removeOrphans(join(root, 'audio-studio.json'), 'act1', ['old', 'odd'])
    expect(removed).toBe(1)
    expect(existsSync(join(root, 'audio/act1/shared.mp3'))).toBe(true)
    expect(existsSync(join(root, 'audio/act1/notes.txt'))).toBe(true)
  })
})

describe('recordLine, only if needed, racing a hand recording', () => {
  it('skips the line when a hand recording finishes while the job is getting ready', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const limiter = createLimiter()
    let release = () => {}
    const held = new Promise<void>((r) => (release = r))
    const job = recordLine(projectFile, 'act1', 'k1', async () => (await held, fish), {
      encode: keepWav,
      limiter,
      onlyIfNeeded: true,
    })
    await recordLine(projectFile, 'act1', 'k1', async () => fish, { encode: keepWav, limiter })
    release()
    expect(await job).toEqual({ ok: true, key: 'k1', skipped: true })
    expect(requests).toHaveLength(1)
  })

  it('reports a line whose speaker lost its voice as uncast, not as up to date', async () => {
    const root = tempRepo({ ...files, 'tts/cast.json': { speakers: {}, pronounce: {} } })
    const result = await recordLine(
      join(root, 'audio-studio.json'),
      'act1',
      'k1',
      async () => fakeFish().fish,
      {
        encode: keepWav,
        limiter: createLimiter(),
        onlyIfNeeded: true,
      },
    )
    expect(result).toMatchObject({ ok: false, reason: 'uncast' })
  })
})

describe('recordLine, checked with Whisper', () => {
  /** A transcriber hearing, per call, the next of `hearings` (words of "Elior wakes up."). */
  function hearing(...hearings: string[][]): Transcriber & { calls: number } {
    const t = {
      calls: 0,
      async transcribe() {
        const words = hearings[Math.min(t.calls++, hearings.length - 1)]!
        return [
          {
            start: 0,
            end: 0.95,
            words: words.map((word, i) => ({ word, start: i * 0.3, end: i * 0.3 + 0.25 })),
          },
        ]
      },
      close() {},
    }
    return t
  }

  const recordChecked = (root: string, transcriber: Transcriber, fish: FishClient) =>
    recordLine(join(root, 'audio-studio.json'), 'act1', 'k1', async () => fish, {
      encode: keepWav,
      limiter: createLimiter(),
      transcriber,
    })

  it('keeps a take heard in full, with Whisper’s word timings', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await recordChecked(root, hearing(['El-ee-or', 'wakes', 'up.']), fish)
    expect(result).toEqual({ ok: true, key: 'k1', duration: 1, heard: 1, takes: 1 })
    expect(requests).toHaveLength(1)
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8'))
    expect(manifest.k1.words).toEqual([
      { word: 'Elior', start: 0, end: 0.25 },
      { word: 'wakes', start: 0.3, end: 0.55 },
      { word: 'up.', start: 0.6, end: 0.85 },
    ])
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.k1).toMatchObject({ heard: 1, takes: 1 })
  })

  it('takes again while a take is heard poorly, keeping the first good one', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await recordChecked(root, hearing(['wakes'], ['El-ee-or', 'wakes', 'up.']), fish)
    expect(result).toMatchObject({ ok: true, heard: 1, takes: 2 })
    expect(requests).toHaveLength(2)
  })

  it('keeps the best of every take when none is heard well enough, and the line shows weak', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await recordChecked(root, hearing(['wakes'], ['wakes', 'up.'], ['up.']), fish)
    expect(result).toMatchObject({ ok: true, heard: 0.667, takes: 3 })
    expect(requests).toHaveLength(3)
    const part = await loadPart(join(root, 'audio-studio.json'), 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.status).toBe('weak')
  })

  it('writes nothing when Whisper fails', async () => {
    const root = tempRepo(files)
    const broken: Transcriber = {
      transcribe: () => Promise.reject(new Error('Whisper could not start')),
      close() {},
    }
    const result = await recordChecked(root, broken, fakeFish().fish)
    expect(result).toEqual({ ok: false, reason: 'transcribe', message: 'Whisper could not start' })
    expect(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8')).toBe(manifestText)
    expect(existsSync(join(root, 'tts/act1/narration.lock.json'))).toBe(false)
  })

  it('records one unchecked take when the project says so', async () => {
    const unchecked = projectJson()
    ;(unchecked.narration as { quality?: unknown }).quality = {
      chunkLimit: 100,
      transcriber: 'none',
    }
    const root = tempRepo({ ...files, 'audio-studio.json': unchecked })
    const transcriber = hearing(['nothing'])
    const result = await recordChecked(root, transcriber, fakeFish().fish)
    expect(result).toEqual({ ok: true, key: 'k1', duration: 1 })
    expect(transcriber.calls).toBe(0)
  })
})

describe('recordLine, a later take failing', () => {
  it('keeps the best take so far when a later one cannot be made', async () => {
    const root = tempRepo(files)
    let calls = 0
    const flaky: FishClient = {
      ...fakeFish().fish,
      async tts() {
        if (calls++ > 0) throw new Error('busy')
        return silence(1)
      },
    }
    const heard: Transcriber = {
      async transcribe() {
        return [{ start: 0, end: 0.95, words: [{ word: 'wakes', start: 0.3, end: 0.55 }] }]
      },
      close() {},
    }
    const result = await recordLine(
      join(root, 'audio-studio.json'),
      'act1',
      'k1',
      async () => flaky,
      {
        encode: keepWav,
        limiter: createLimiter(),
        transcriber: heard,
      },
    )
    expect(result).toMatchObject({ ok: true, heard: 0.333, takes: 1 })
  })
})
