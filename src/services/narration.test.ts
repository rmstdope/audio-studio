import { createBudget } from '../core/spend'
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
import { measureLine, recordLine, removeOrphans } from './narration'
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
    async credit() {
      return 25
    },
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

describe('measureLine', () => {
  const heardAll: Transcriber = {
    async transcribe() {
      return [
        {
          start: 0,
          end: 0.95,
          words: [['Welcome.', 0.1, 0.6]].map(([word, start, end]) => ({
            word: word as string,
            start: start as number,
            end: end as number,
          })),
        },
      ]
    },
    close() {},
  }
  const measureOptions = {
    transcriber: heardAll,
    decode: async () => ({ wav: silence(1.25), seconds: 1.25 }),
  }

  async function recorded(transcriber: Transcriber | null = null) {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      encode: keepWav,
      limiter: createLimiter(),
      transcriber,
    })
    return { root, projectFile }
  }

  it('measures a clip never checked: word timings, duration and how well it is heard', async () => {
    const { root, projectFile } = await recorded()
    const result = await measureLine(projectFile, 'act1', 'k4', measureOptions)
    expect(result).toEqual({ ok: true, key: 'k4', heard: 1, duration: 1.25 })
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/manifest.json'), 'utf8'))
    expect(manifest.k4).toMatchObject({
      duration: 1.25,
      words: [{ word: 'Welcome.', start: 0.1, end: 0.6 }],
    })
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.k4.heard).toBe(1)
  })

  it('makes a clip heard poorly weak', async () => {
    const { projectFile } = await recorded()
    const nothing: Transcriber = { transcribe: async () => [], close() {} }
    expect(
      await measureLine(projectFile, 'act1', 'k4', { ...measureOptions, transcriber: nothing }),
    ).toMatchObject({ ok: true, heard: 0 })
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k4')?.status).toBe('weak')
  })

  it('gives Whisper the clip decoded to WAV, as narrate.py --retime does', async () => {
    const { projectFile } = await recorded()
    const decoded = silence(1.25)
    const seen: { path: string; wav: Uint8Array } = { path: '', wav: new Uint8Array() }
    const listening: Transcriber = {
      async transcribe(_model, file) {
        seen.path = file
        seen.wav = new Uint8Array(readFileSync(file))
        return []
      },
      close() {},
    }
    await measureLine(projectFile, 'act1', 'k4', {
      transcriber: listening,
      decode: async () => ({ wav: decoded, seconds: 1.25 }),
    })
    expect(seen.path.endsWith('.wav')).toBe(true)
    expect(seen.wav).toEqual(decoded)
  })

  it('refuses a line without a clip the studio knows', async () => {
    const root = tempRepo(files)
    const result = await measureLine(join(root, 'audio-studio.json'), 'act1', 'k4', measureOptions)
    expect(result).toMatchObject({ ok: false, reason: 'not-recorded' })
  })
})

describe('recordLine, retaking a weak line', () => {
  it('skips a weak line in a job that was not asked to retake weak lines', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const poor: Transcriber = { transcribe: async () => [], close() {} }
    const options = { encode: keepWav, limiter: createLimiter() }
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      ...options,
      transcriber: poor,
    })
    const { fish, requests } = fakeFish()
    const again = await recordLine(projectFile, 'act1', 'k4', async () => fish, {
      ...options,
      transcriber: poor,
      onlyIfNeeded: true,
    })
    expect(again).toEqual({ ok: true, key: 'k4', skipped: true })
    expect(requests).toHaveLength(0)
  })

  it('records a weak line when a job asks for it', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const poor: Transcriber = { transcribe: async () => [], close() {} }
    const options = { encode: keepWav, limiter: createLimiter() }
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      ...options,
      transcriber: poor,
    })
    const { fish, requests } = fakeFish()
    const again = await recordLine(projectFile, 'act1', 'k4', async () => fish, {
      ...options,
      transcriber: poor,
      onlyIfNeeded: true,
      retakeWeak: true,
    })
    expect(again).toMatchObject({ ok: true, takes: 3 })
    expect(requests).toHaveLength(3)
  })
})

describe('measureLine, edge cases', () => {
  const heardAll: Transcriber = {
    async transcribe() {
      return [{ start: 0, end: 0.95, words: [{ word: 'Welcome.', start: 0.1, end: 0.6 }] }]
    },
    close() {},
  }

  async function unchecked() {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      encode: keepWav,
      limiter: createLimiter(),
    })
    return { root, projectFile }
  }

  it('writes nothing when the clip was recorded again while it was measured', async () => {
    const { root, projectFile } = await unchecked()
    const lockFile = join(root, 'tts/act1/narration.lock.json')
    const result = await measureLine(projectFile, 'act1', 'k4', {
      transcriber: heardAll,
      decode: async () => {
        // The same line recorded again, with the same inputs, while this clip is measured.
        await new Promise((resolve) => setTimeout(resolve, 5))
        await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
          encode: keepWav,
          limiter: createLimiter(),
        })
        return { wav: silence(1.25), seconds: 1.25 }
      },
    })
    expect(result).toEqual({ ok: true, key: 'k4', skipped: true })
    expect(JSON.parse(readFileSync(lockFile, 'utf8')).k4.heard).toBeUndefined()
  })

  it('refuses when takes are not checked', async () => {
    const { projectFile } = await unchecked()
    const result = await measureLine(projectFile, 'act1', 'k4', { transcriber: null })
    expect(result).toMatchObject({ ok: false, reason: 'unchecked' })
  })

  it('reports a clip that cannot be decoded', async () => {
    const { projectFile } = await unchecked()
    const result = await measureLine(projectFile, 'act1', 'k4', {
      transcriber: heardAll,
      decode: async () => {
        throw new Error('not audio')
      },
    })
    expect(result).toMatchObject({ ok: false, reason: 'decode', message: 'not audio' })
  })

  it('measures only clips never measured', async () => {
    const { projectFile } = await unchecked()
    const options = {
      transcriber: heardAll,
      decode: async () => ({ wav: silence(1.25), seconds: 1.25 }),
    }
    expect(await measureLine(projectFile, 'act1', 'k4', options)).toMatchObject({
      ok: true,
      heard: 1,
    })
    expect(await measureLine(projectFile, 'act1', 'k4', options)).toMatchObject({
      ok: false,
      reason: 'not-recorded',
    })
  })
})

describe('recordLine, a paid model', () => {
  /** The test project with a paid draft model. */
  function paidRepo() {
    const paid = JSON.parse(JSON.stringify(files['audio-studio.json']))
    paid.narration.models = { draft: 's2-pro' }
    return tempRepo({ ...files, 'audio-studio.json': paid })
  }

  it('sends nothing to Fish without a budget for it', async () => {
    const root = paidRepo()
    const { fish, requests } = fakeFish()
    const result = await recordLine(
      join(root, 'audio-studio.json'),
      'act1',
      'k1',
      async () => fish,
      {
        encode: keepWav,
        limiter: createLimiter(),
      },
    )
    expect(result).toMatchObject({ ok: false, reason: 'spend' })
    expect(requests).toHaveLength(0)
  })

  it('spends from the budget it is given, and stops where the budget ends', async () => {
    const root = paidRepo()
    const projectFile = join(root, 'audio-studio.json')
    const options = { encode: keepWav, limiter: createLimiter() }
    const short = await recordLine(projectFile, 'act1', 'k1', async () => fakeFish().fish, {
      ...options,
      budget: createBudget({ model: 's2-pro', dollars: 0.0000001 }),
    })
    expect(short).toMatchObject({ ok: false, reason: 'spend' })
    const { fish, requests } = fakeFish()
    const budget = createBudget({ model: 's2-pro', dollars: 1 })
    expect(
      await recordLine(projectFile, 'act1', 'k1', async () => fish, { ...options, budget }),
    ).toMatchObject({ ok: true })
    expect(requests).toHaveLength(1)
    expect(budget.left).toBeLessThan(1)
  })

  it('refuses a model changed after the budget was given', async () => {
    const root = paidRepo()
    const { fish, requests } = fakeFish()
    const result = await recordLine(
      join(root, 'audio-studio.json'),
      'act1',
      'k1',
      async () => fish,
      {
        encode: keepWav,
        limiter: createLimiter(),
        budget: createBudget({ model: 's2.1-pro-free', dollars: 0 }),
      },
    )
    expect(result).toMatchObject({
      ok: false,
      reason: 'spend',
      message: expect.stringContaining('s2-pro'),
    })
    expect(requests).toHaveLength(0)
  })
})

describe('recordLine, the final recording', () => {
  /** The test project with a paid final model, the draft one free. */
  function finalRepo() {
    const withFinal = JSON.parse(JSON.stringify(files['audio-studio.json']))
    withFinal.narration.models = { final: 's2-pro' }
    return tempRepo({ ...files, 'audio-studio.json': withFinal })
  }
  const budget = () => createBudget({ model: 's2-pro', dollars: 1 })

  it('records with the final model, and the clip is final', async () => {
    const root = finalRepo()
    const projectFile = join(root, 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const result = await recordLine(projectFile, 'act1', 'k1', async () => fish, {
      encode: keepWav,
      limiter: createLimiter(),
      stage: 'final',
      budget: budget(),
    })
    expect(result).toMatchObject({ ok: true })
    expect(requests.map((r) => r.model)).toEqual(['s2-pro'])
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')).toMatchObject({
      status: 'ok',
      final: true,
    })
  })

  it('records an up-to-date draft clip again in a final job, but not a final one', async () => {
    const root = finalRepo()
    const projectFile = join(root, 'audio-studio.json')
    const options = { encode: keepWav, limiter: createLimiter() }
    await recordLine(projectFile, 'act1', 'k1', async () => fakeFish().fish, options)
    const { fish, requests } = fakeFish()
    const final = { ...options, stage: 'final' as const, onlyIfNeeded: true, budget: budget() }
    expect(await recordLine(projectFile, 'act1', 'k1', async () => fish, final)).toMatchObject({
      ok: true,
    })
    expect(requests).toHaveLength(1)
    expect(await recordLine(projectFile, 'act1', 'k1', async () => fish, final)).toEqual({
      ok: true,
      key: 'k1',
      skipped: true,
    })
    expect(requests).toHaveLength(1)
  })
})
