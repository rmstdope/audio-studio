import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Voice } from '../src/core/voiceSearch'
import type { ElevenAccount } from '../src/core/setup'
import type { ElevenLabsClient, SpeechRequest } from '../src/services/elevenlabs'

/** A minimal valid project file; override any top-level key. */
export function projectJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Test Game',
    narration: {
      partLabel: 'Act',
      parts: [
        { id: 'act1', title: 'Act I' },
        { id: 'act2', title: 'Act II' },
      ],
      characters: 'tts/cast.json',
      paths: {
        dialog: 'tts/{part}/script.json',
        cues: 'tts/{part}/cues.json',
        lock: 'tts/{part}/narration.lock.json',
        clips: 'audio/{part}',
        manifest: 'audio/{part}/manifest.json',
      },
    },
    ...overrides,
  }
}

/** A temporary consumer repository holding `files` (path → JSON value, or raw text; undefined leaves it out). */
export function tempRepo(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'audio-studio-test-'))
  for (const [path, content] of Object.entries(files)) {
    if (content === undefined) continue
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  }
  return root
}

/**
 * An ElevenLabs client that knows `voices` (by ElevenLabs' own id), speaks with `speak` and has
 * `account`, when given; anything else it is asked rejects. `asked` lists the voices looked up,
 * `spoken` the speech asked for.
 */
export function fakeEleven(
  voices: Record<string, Voice> = {},
  {
    speak,
    account,
  }: { speak?: () => Uint8Array | Promise<Uint8Array>; account?: ElevenAccount } = {},
): { client: ElevenLabsClient; asked: string[]; spoken: SpeechRequest[] } {
  const asked: string[] = []
  const spoken: SpeechRequest[] = []
  const unused = () => Promise.reject(new Error('not used'))
  const client: ElevenLabsClient = {
    subscription: account ? async () => account : unused,
    music: unused,
    tts: speak ? async (request) => (spoken.push(request), await speak()) : unused,
    sharedVoices: unused,
    addSharedVoice: unused,
    async voice(id) {
      asked.push(id)
      const found = voices[id]
      if (!found)
        throw new Error('ElevenLabs answered 404: A voice with the voice_id was not found.')
      return found
    },
  }
  return { client, asked, spoken }
}

/** An ElevenLabs voice as the client gives it: George, with a preview. */
export function elevenVoiceOf(id: string, title = 'George'): Voice {
  return {
    id: `eleven:${id}`,
    title,
    description: 'Warm storyteller',
    tags: ['british'],
    languages: ['en'],
    uses: 0,
    likes: 0,
    author: '',
    sample: { text: '', audio: `https://example.com/${id}.mp3` },
  }
}
