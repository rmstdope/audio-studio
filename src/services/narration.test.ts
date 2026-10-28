import { createBudget } from '../core/spend'
import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { HEARD_DIR, heardFor } from './heard'
import { readWav, writeWav } from '../core/wav'
import type { Encoder } from './audio'
import type { ElevenLabsClient, SpeechRequest } from './elevenlabs'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter, type Limiter } from './limit'
import type { Transcriber } from './transcriber'
import { acceptLine, measureLine, recordLine, removeOrphans } from './narration'
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
    async listOwnVoices() {
      return []
    },
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
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
    speakers: { narrator: { voice: 'v-n', style: '[warm]' }, mira: { voice: 'v-m', speed: 1.15 } },
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
  it('speaks a character at its own speed', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    await record(root, 'k4', fish)
    expect(requests.map((r) => r.speed)).toEqual([1.15])
  })

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

  it('records a long line with each cue where it was placed, and each piece starting with the cue in effect', async () => {
    const text = files['tts/act1/script.json'][1]!.text
    const root = tempRepo({
      ...files,
      'tts/act1/cues.json': {
        k2: `[warm] ${text.replace('A long sentence that goes on. A long', 'A long sentence that goes on. A [hushed] long')}`,
      },
    })
    const { fish, requests } = fakeFish()
    await record(root, 'k2', fish)
    expect(requests.map((r) => r.text.split(' ').slice(0, 2).join(' '))).toEqual([
      '[warm] A',
      '[hushed] A',
    ])
    expect(requests[0]!.text).toContain('A [hushed] long sentence')
    expect(requests[1]!.text).not.toContain('[warm]')
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

describe('removeOrphans, a dialog that is gone', () => {
  it('removes nothing, whatever it is asked for', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson(),
      'audio/act1/manifest.json': { a: { file: 'a.mp3', speaker: 'mira', duration: 1, words: [] } },
      'audio/act1/a.mp3': 'clip',
    })
    expect(await removeOrphans(join(root, 'audio-studio.json'), 'act1', ['a'])).toBe(0)
    expect(existsSync(join(root, 'audio/act1/a.mp3'))).toBe(true)
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

  it('hears a known name Whisper spells one letter off, at the start of the line', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await recordChecked(root, hearing(['El-eor', 'wakes', 'up.']), fish)
    expect(result).toEqual({ ok: true, key: 'k1', duration: 1, heard: 1, takes: 1 })
    expect(requests).toHaveLength(1)
  })

  it('keeps what Whisper heard of a kept take heard poorly, and forgets it once heard in full', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await recordChecked(root, hearing(['wakes'], ['wakes', 'up.'], ['up.']), fakeFish().fish)
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({
      ok: true,
      heard: { at: lock.k1.at, text: 'Elior wakes up.', words: ['wakes', 'up.'], missed: [0] },
    })
    await recordChecked(root, hearing(['El-ee-or', 'wakes', 'up.']), fakeFish().fish)
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({ ok: true, heard: null })
    expect(readdirSync(join(root, HEARD_DIR))).toEqual([])
  })

  it('records the line even when what Whisper heard cannot be kept', async () => {
    const root = tempRepo({ ...files, [HEARD_DIR]: 'a file where the folder would go' })
    const result = await recordChecked(root, hearing(['wakes']), fakeFish().fish)
    expect(result).toMatchObject({ ok: true, key: 'k1', heard: 0.333 })
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.k1.heard).toBe(0.333)
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

  it('records a take heard as a word the project says sounds the same as heard', async () => {
    const own = projectJson()
    ;(own.narration as { quality?: unknown }).quality = {
      chunkLimit: 100,
      soundAlike: [['Welcome', 'Wellcum']],
    }
    const root = tempRepo({ ...files, 'audio-studio.json': own })
    const wellcum: Transcriber = {
      transcribe: async () => [
        { start: 0, end: 1, words: [{ word: 'Wellcum.', start: 0, end: 0.6 }] },
      ],
      close() {},
    }
    const projectFile = join(root, 'audio-studio.json')
    const result = await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      encode: keepWav,
      limiter: createLimiter(),
      transcriber: wellcum,
    })
    expect(result).toMatchObject({ ok: true, heard: 1, takes: 1 })
  })

  it('counts a word heard as one the project says sounds the same', async () => {
    const own = projectJson()
    ;(own.narration as { quality?: unknown }).quality = {
      chunkLimit: 100,
      soundAlike: [['Welcome', 'Wellcum']],
    }
    const root = tempRepo({ ...files, 'audio-studio.json': own })
    const projectFile = join(root, 'audio-studio.json')
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      encode: keepWav,
      limiter: createLimiter(),
    })
    const wellcum: Transcriber = {
      transcribe: async () => [
        { start: 0, end: 1, words: [{ word: 'Wellcum.', start: 0, end: 0.6 }] },
      ],
      close() {},
    }
    const result = await measureLine(projectFile, 'act1', 'k4', {
      ...measureOptions,
      transcriber: wellcum,
    })
    expect(result).toMatchObject({ ok: true, heard: 1 })
  })

  it('checks a clip already checked again when asked, with the rules of today', async () => {
    const half: Transcriber = {
      transcribe: async () => [
        { start: 0, end: 1, words: [{ word: 'Welcom', start: 0, end: 0.5 }] },
      ],
      close() {},
    }
    const { root, projectFile } = await recorded(half)
    const lockOf = () =>
      JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    const at = lockOf().k4.at
    expect(lockOf().k4.heard).toBe(0)
    // Without asking, a clip already checked is not measured again.
    expect(await measureLine(projectFile, 'act1', 'k4', measureOptions)).toMatchObject({
      ok: false,
      reason: 'not-recorded',
    })
    const again = await measureLine(projectFile, 'act1', 'k4', { ...measureOptions, again: true })
    expect(again).toEqual({ ok: true, key: 'k4', heard: 1, duration: 1.25 })
    const { heard: _, ...kept } = lockOf().k4
    expect(lockOf().k4).toEqual({ ...kept, heard: 1, at })
    const loaded = await loadPart(projectFile, 'act1')
    expect(loaded?.ok && loaded.part.lines.find((l) => l.key === 'k4')?.status).toBe('ok')
    expect(await heardFor(projectFile, 'act1', 'k4')).toMatchObject({ ok: true, heard: null })
  })

  it('skips a line no longer weak when the job reaches it, if asked only when needed', async () => {
    const half: Transcriber = {
      transcribe: async () => [
        { start: 0, end: 1, words: [{ word: 'Welcom', start: 0, end: 0.5 }] },
      ],
      close() {},
    }
    const { projectFile } = await recorded(half)
    await acceptLine(projectFile, 'act1', 'k4')
    const options = { ...measureOptions, again: true, onlyIfNeeded: true }
    expect(await measureLine(projectFile, 'act1', 'k4', options)).toEqual({
      ok: true,
      key: 'k4',
      skipped: true,
    })
  })

  it('checks again only a weak line: not one never checked, nor one accepted', async () => {
    const unchecked = await recorded()
    expect(
      await measureLine(unchecked.projectFile, 'act1', 'k4', { ...measureOptions, again: true }),
    ).toMatchObject({ ok: false, reason: 'not-recorded' })
    const half: Transcriber = {
      transcribe: async () => [
        { start: 0, end: 1, words: [{ word: 'Welcom', start: 0, end: 0.5 }] },
      ],
      close() {},
    }
    const weak = await recorded(half)
    await acceptLine(weak.projectFile, 'act1', 'k4')
    expect(
      await measureLine(weak.projectFile, 'act1', 'k4', { ...measureOptions, again: true }),
    ).toMatchObject({ ok: false, reason: 'not-recorded' })
  })

  it('keeps what Whisper heard of a measured clip heard poorly', async () => {
    const { root, projectFile } = await recorded()
    const half: Transcriber = {
      transcribe: async () => [
        { start: 0, end: 1, words: [{ word: 'Welcom', start: 0, end: 0.5 }] },
      ],
      close() {},
    }
    await measureLine(projectFile, 'act1', 'k4', { ...measureOptions, transcriber: half })
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(await heardFor(projectFile, 'act1', 'k4')).toEqual({
      ok: true,
      heard: { at: lock.k4.at, text: 'Welcome.', words: ['Welcom'], missed: [0] },
    })
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

describe('recordLine, stages kept apart', () => {
  const options = { encode: keepWav, limiter: createLimiter() }

  it('records as a draft when the final model is the draft one', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await recordLine(projectFile, 'act1', 'k1', async () => fakeFish().fish, options)
    const { fish, requests } = fakeFish()
    const again = await recordLine(projectFile, 'act1', 'k1', async () => fish, {
      ...options,
      stage: 'final',
      onlyIfNeeded: true,
    })
    expect(again).toEqual({ ok: true, key: 'k1', skipped: true })
    expect(requests).toHaveLength(0)
  })

  it('does not take a weak final clip back to the draft model in a draft job', async () => {
    const withFinal = JSON.parse(JSON.stringify(files['audio-studio.json']))
    withFinal.narration.models = { final: 's2-pro' }
    const root = tempRepo({ ...files, 'audio-studio.json': withFinal })
    const projectFile = join(root, 'audio-studio.json')
    const poor: Transcriber = { transcribe: async () => [], close() {} }
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
      ...options,
      stage: 'final',
      transcriber: poor,
      budget: createBudget({ model: 's2-pro', dollars: 1 }),
    })
    const { fish, requests } = fakeFish()
    const draft = await recordLine(projectFile, 'act1', 'k4', async () => fish, {
      ...options,
      onlyIfNeeded: true,
      retakeWeak: true,
      transcriber: poor,
    })
    expect(draft).toEqual({ ok: true, key: 'k4', skipped: true })
    expect(requests).toHaveLength(0)
  })

  it('does not share a draft recording with a final one of the same line', async () => {
    const withFinal = JSON.parse(JSON.stringify(files['audio-studio.json']))
    withFinal.narration.models = { final: 's2-pro' }
    const root = tempRepo({ ...files, 'audio-studio.json': withFinal })
    const projectFile = join(root, 'audio-studio.json')
    const { fish, requests } = fakeFish()
    await Promise.all([
      recordLine(projectFile, 'act1', 'k1', async () => fish, options),
      recordLine(projectFile, 'act1', 'k1', async () => fish, {
        ...options,
        stage: 'final',
        onlyIfNeeded: true,
        budget: createBudget({ model: 's2-pro', dollars: 1 }),
      }),
    ])
    expect(requests.map((r) => r.model).sort()).toEqual(['s2-pro', 's2.1-pro-free'])
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.final).toBe(true)
  })
})

describe('recordLine, a draft finishing after a final recording', () => {
  const options = { encode: keepWav, limiter: createLimiter() }
  function finalRepo() {
    const withFinal = JSON.parse(JSON.stringify(files['audio-studio.json']))
    withFinal.narration.models = { final: 's2-pro' }
    return tempRepo({ ...files, 'audio-studio.json': withFinal })
  }

  it('does not overwrite a final clip that landed meanwhile', async () => {
    const root = finalRepo()
    const projectFile = join(root, 'audio-studio.json')
    const { fish } = fakeFish()
    let release!: () => void
    const draftMayAnswer = new Promise<void>((resolve) => (release = resolve))
    const slowDraft: FishClient = {
      ...fish,
      async tts(request) {
        if (request.model === 's2.1-pro-free') await draftMayAnswer
        return fish.tts(request)
      },
    }
    const draft = recordLine(projectFile, 'act1', 'k1', async () => slowDraft, options)
    const final = await recordLine(projectFile, 'act1', 'k1', async () => slowDraft, {
      ...options,
      stage: 'final',
      budget: createBudget({ model: 's2-pro', dollars: 1 }),
    })
    expect(final).toMatchObject({ ok: true })
    release()
    expect(await draft).toEqual({ ok: true, key: 'k1', skipped: true })
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.final).toBe(true)
  })

  it('retakes a weak final clip in a final job asked to retake weak lines', async () => {
    const root = finalRepo()
    const projectFile = join(root, 'audio-studio.json')
    const poor: Transcriber = { transcribe: async () => [], close() {} }
    const final = {
      ...options,
      stage: 'final' as const,
      transcriber: poor,
      budget: createBudget({ model: 's2-pro', dollars: 1 }),
    }
    await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, final)
    const { fish, requests } = fakeFish()
    const again = await recordLine(projectFile, 'act1', 'k4', async () => fish, {
      ...final,
      onlyIfNeeded: true,
      retakeWeak: true,
      budget: createBudget({ model: 's2-pro', dollars: 1 }),
    })
    expect(again).toMatchObject({ ok: true })
    expect(requests.map((r) => r.model)).toContain('s2-pro')
  })
})

describe('acceptLine', () => {
  const heardHalf: Transcriber = {
    transcribe: async () => [{ start: 0, end: 1, words: [{ word: 'Welcom', start: 0, end: 0.5 }] }],
    close() {},
  }
  const lockOf = (root: string) =>
    JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))

  async function recordedWith(transcriber: Transcriber) {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const again = () =>
      recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, {
        encode: keepWav,
        limiter: createLimiter(),
        transcriber,
      })
    await again()
    return { root, projectFile, again }
  }

  it('accepts a weak line as it is, until it is recorded again', async () => {
    const { root, projectFile, again } = await recordedWith(heardHalf)
    expect(await acceptLine(projectFile, 'act1', 'k4')).toEqual({ ok: true, key: 'k4' })
    expect(lockOf(root).k4).toMatchObject({ heard: 0, accepted: true })
    const loaded = await loadPart(projectFile, 'act1')
    expect(loaded?.ok && loaded.part.lines.find((l) => l.key === 'k4')).toMatchObject({
      status: 'ok',
      accepted: true,
    })
    await again()
    expect(lockOf(root).k4.accepted).toBeUndefined()
  })

  it('accepts only a weak line', async () => {
    const { projectFile } = await recordedWith(heardHalf)
    expect(await acceptLine(projectFile, 'act1', 'k1')).toMatchObject({
      ok: false,
      reason: 'not-weak',
    })
    expect(await acceptLine(projectFile, 'act1', 'nope')).toBeNull()
  })
})

describe('recording in a language besides the source', () => {
  const several = projectJson()
  const narration = several.narration as Record<string, unknown>
  narration.languages = ['en', 'sv']
  narration.quality = { chunkLimit: 100 }
  narration.paths = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }
  const swedish = {
    'audio-studio.json': several,
    'tts/cast.json': {
      speakers: {
        narrator: { voice: 'v-n', style: '[warm]', languages: { sv: { voice: 'v-n-sv' } } },
        mira: { voice: 'v-m' },
      },
      pronounce: { Elior: 'El-ee-or' },
    },
    'tts/act1/en/script.json': [
      { key: 'k1', speaker: 'narrator', text: 'Elior wakes up.' },
      { key: 'k2', speaker: 'mira', text: 'Welcome.' },
      { key: 'k3', speaker: 'narrator', text: 'Not translated.' },
    ],
    'tts/act1/sv/script.json': [
      { key: 'k1', speaker: 'narrator', text: 'Elior vaknar.' },
      { key: 'k2', speaker: 'mira', text: 'Välkommen.' },
    ],
    'tts/act1/en/cues.json': { k1: '[worried]' },
  }
  const projectFile = (root: string) => join(root, 'audio-studio.json')
  const recordSv = (root: string, key: string, fish: FishClient) =>
    recordLine(projectFile(root), 'act1', key, async () => fish, {
      encode: keepWav,
      limiter: createLimiter(),
      language: 'sv',
    })

  it('records into the language’s own clips, manifest and lock, with its voice, the source cue and no English pronunciation', async () => {
    const root = tempRepo(swedish)
    const { fish, requests } = fakeFish()
    const result = await recordSv(root, 'k1', fish)
    expect(result).toMatchObject({ ok: true, key: 'k1' })
    expect(requests.map((r) => [r.text, r.voice])).toEqual([['[worried] Elior vaknar.', 'v-n-sv']])
    expect(existsSync(join(root, 'audio/act1/sv/k1.mp3'))).toBe(true)
    expect(existsSync(join(root, 'audio/act1/en/k1.mp3'))).toBe(false)
    const manifest = JSON.parse(readFileSync(join(root, 'audio/act1/sv/manifest.json'), 'utf8'))
    expect(Object.keys(manifest)).toEqual(['k1'])
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/sv/narration.lock.json'), 'utf8'))
    expect(lock.k1.voice).toBe('v-n-sv')
    expect(existsSync(join(root, 'tts/act1/en/narration.lock.json'))).toBe(false)
    const part = await loadPart(projectFile(root), 'act1', 'sv')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.status).toBe('ok')
  })

  it('does not record a character with no voice in the language, nor a line not translated', async () => {
    const root = tempRepo(swedish)
    const { fish, requests } = fakeFish()
    expect(await recordSv(root, 'k2', fish)).toMatchObject({ ok: false, reason: 'uncast' })
    expect(await recordSv(root, 'k3', fish)).toMatchObject({ ok: false, reason: 'untranslated' })
    expect(requests).toEqual([])
  })

  it('leaves the source language as it was', async () => {
    const root = tempRepo(swedish)
    const { fish } = fakeFish()
    await recordSv(root, 'k1', fish)
    const part = await loadPart(projectFile(root), 'act1', 'en')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'k1')?.status).toBe('missing')
  })

  it('accepts, measures and removes orphans in the language', async () => {
    const root = tempRepo(swedish)
    const { fish } = fakeFish()
    await recordSv(root, 'k1', fish)
    // A clip whose line left the Swedish dialog.
    const lockFile = join(root, 'tts/act1/sv/narration.lock.json')
    const manifestFile = join(root, 'audio/act1/sv/manifest.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const lock = JSON.parse(readFileSync(lockFile, 'utf8'))
    writeFileSync(
      manifestFile,
      JSON.stringify({ ...manifest, old: { file: 'old.mp3', speaker: 'mira' } }),
    )
    writeFileSync(lockFile, JSON.stringify({ ...lock, old: lock.k1 }))
    writeFileSync(join(root, 'audio/act1/sv/old.mp3'), 'x')
    expect(await removeOrphans(projectFile(root), 'act1', ['old'], 'sv')).toBe(1)
    expect(existsSync(join(root, 'audio/act1/sv/old.mp3'))).toBe(false)
    expect(existsSync(join(root, 'audio/act1/sv/k1.mp3'))).toBe(true)
    expect(await acceptLine(projectFile(root), 'act1', 'k1', 'sv')).toMatchObject({
      ok: false,
      reason: 'not-weak',
    })
  })

  it('has Whisper listen in the line’s own language, and keeps what it heard per language', async () => {
    const root = tempRepo(swedish)
    const { fish } = fakeFish()
    const asked: (string | undefined)[] = []
    const transcriber: Transcriber = {
      async transcribe(_model, _path, language) {
        asked.push(language)
        return []
      },
      close() {},
    }
    await recordLine(projectFile(root), 'act1', 'k1', async () => fish, {
      encode: keepWav,
      limiter: createLimiter(),
      transcriber,
      language: 'sv',
    })
    expect(new Set(asked)).toEqual(new Set(['sv']))
    // Heard below full, so it is kept: under the language's own name, never the source's.
    const kept = await heardFor(projectFile(root), 'act1', 'k1', 'sv')
    expect(kept).toMatchObject({ ok: true, heard: { text: 'Elior vaknar.' } })
    expect(await heardFor(projectFile(root), 'act1', 'k1')).toMatchObject({
      ok: true,
      heard: null,
    })
  })

  it('tells Whisper no language in a project with one language', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const asked: (string | undefined)[] = []
    const transcriber: Transcriber = {
      async transcribe(_model, _path, language) {
        asked.push(language)
        return []
      },
      close() {},
    }
    await recordLine(join(root, 'audio-studio.json'), 'act1', 'k1', async () => fish, {
      encode: keepWav,
      limiter: createLimiter(),
      transcriber,
    })
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((language) => language === undefined)).toBe(true)
  })
})

describe('recordLine with an ElevenLabs voice', () => {
  /** An ElevenLabs client that speaks a second of silence, recording what it was asked. */
  function fakeEleven() {
    const requests: SpeechRequest[] = []
    const client: ElevenLabsClient = {
      subscription: () => Promise.reject(new Error('not used')),
      sharedVoices: () => Promise.reject(new Error('not used')),
      addSharedVoice: () => Promise.reject(new Error('not used')),
      music: () => Promise.reject(new Error('not used')),
      voice: () => Promise.reject(new Error('not used')),
      async tts(request) {
        requests.push(request)
        return silence(1)
      },
    }
    return { client, requests }
  }
  /** The fixture with mira cast with an ElevenLabs voice at `speed`. */
  const elevenRoot = (speed = 1.1) =>
    tempRepo({
      ...files,
      'tts/cast.json': {
        speakers: {
          narrator: { voice: 'v-n', style: '[warm]' },
          mira: { voice: 'eleven:abc', speed },
        },
        pronounce: {},
      },
    })
  const recordEleven = (
    root: string,
    eleven: ElevenLabsClient | null,
    credits = 100,
    fish = fakeFish().fish,
  ) =>
    recordLine(join(root, 'audio-studio.json'), 'act1', 'k4', async () => fish, {
      encode: keepWav,
      limiter: createLimiter(),
      elevenlabs: async () => eleven,
      credits: createBudget({ model: 'eleven_v3', dollars: credits }),
    })
  /** A limiter that runs every job at once, noting the limit it was asked for under `name`. */
  const watched = (name: string, used: [string, number][]): Limiter => ({
    run: (_key, limit, job) => (used.push([name, limit]), job()),
  })

  it('speaks the line with ElevenLabs, in its voice, model, settings and speed, and Fish not at all', async () => {
    const root = elevenRoot()
    const { client, requests } = fakeEleven()
    const fish = fakeFish()
    const result = await recordEleven(root, client, 100, fish.fish)
    expect(result).toMatchObject({ ok: true, key: 'k4' })
    expect(fish.requests).toEqual([])
    expect(requests).toEqual([
      {
        text: 'Welcome.',
        voice: 'abc',
        model: 'eleven_v3',
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.1 },
        language: 'en',
      },
    ])
    const lock = JSON.parse(readFileSync(join(root, 'tts/act1/narration.lock.json'), 'utf8'))
    expect(lock.k4).toMatchObject({ voice: 'eleven:abc', model: 'eleven_v3' })
  })

  it('speaks with the project’s ElevenLabs voice settings when it names them', async () => {
    const root = elevenRoot()
    const tuned = structuredClone(project)
    ;(tuned.narration as { elevenlabs?: unknown }).elevenlabs = {
      tts: { stability: 1, similarityBoost: 0.4, style: 0.3 },
    }
    writeFileSync(join(root, 'audio-studio.json'), JSON.stringify(tuned))
    const { client, requests } = fakeEleven()
    expect(await recordEleven(root, client)).toMatchObject({ ok: true })
    expect(requests[0]!.settings).toEqual({
      stability: 1,
      similarityBoost: 0.4,
      style: 0.3,
      speed: 1.1,
    })
  })

  it('charges the confirmed credits a character, refusing what goes past them', async () => {
    const root = elevenRoot()
    expect(await recordEleven(root, fakeEleven().client, 3)).toMatchObject({
      ok: false,
      reason: 'spend',
      message: 'this would go past the confirmed budget (3 credits left); plan again',
    })
  })

  it('is never charged to the Fish budget, whatever it holds', async () => {
    const result = await recordLine(
      join(elevenRoot(), 'audio-studio.json'),
      'act1',
      'k4',
      async () => fakeFish().fish,
      {
        encode: keepWav,
        limiter: createLimiter(),
        elevenlabs: async () => fakeEleven().client,
        budget: createBudget({ model: 'eleven_v3', dollars: 100 }),
      },
    )
    expect(result).toMatchObject({ ok: false, reason: 'spend' })
  })

  it('waits for ElevenLabs’ own slots, at most two at once, and Fish’s line for Fish’s', async () => {
    const used: [string, number][] = []
    const root = elevenRoot()
    const options = {
      encode: keepWav,
      limiter: watched('fish', used),
      elevenLimiter: watched('elevenlabs', used),
      elevenlabs: async () => fakeEleven().client,
      credits: createBudget({ model: 'eleven_v3', dollars: 100 }),
    }
    const projectFile = join(root, 'audio-studio.json')
    expect(
      await recordLine(projectFile, 'act1', 'k4', async () => fakeFish().fish, options),
    ).toMatchObject({ ok: true })
    expect(
      await recordLine(projectFile, 'act1', 'k1', async () => fakeFish().fish, options),
    ).toMatchObject({ ok: true })
    // The project allows four at once; ElevenLabs takes at most two.
    expect(used).toEqual([
      ['elevenlabs', 2],
      ['fish', 4],
    ])
  })

  it('refuses without an ElevenLabs key, and at a speed ElevenLabs does not take', async () => {
    expect(await recordEleven(elevenRoot(), null)).toEqual({
      ok: false,
      reason: 'no-key',
      message: 'Set ELEVENLABS_API_KEY in the project’s env file, or in the environment.',
    })
    const fast = await recordEleven(elevenRoot(1.5), fakeEleven().client)
    expect(fast).toMatchObject({ ok: false, reason: 'speed' })
  })
})
