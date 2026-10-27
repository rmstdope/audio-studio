import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodeClip } from './audio'
import { createElevenLabsClient, type ElevenLabsClient } from './elevenlabs'
import type { MusicGenerator, MusicReady } from './music'

/** What a take says when there is no key, and where the key goes. */
const NO_KEY = {
  ok: false,
  message: 'There is no ElevenLabs key.',
  fix: 'Put ELEVENLABS_API_KEY=... in the project’s env file (from elevenlabs.io, Developers, API keys), or export it.',
} as const satisfies MusicReady

/** ElevenLabs' MP3 as 16-bit WAV, through a temporary file ffmpeg reads. */
async function decodeMp3(mp3: Uint8Array): Promise<Uint8Array> {
  const file = join(tmpdir(), `audio-studio-eleven-${randomUUID()}.mp3`)
  try {
    await writeFile(file, mp3)
    return (await decodeClip(file)).wav
  } finally {
    await rm(file, { force: true })
  }
}

/**
 * Eleven Music as a music generator: each take is made in the cloud from the brief, with its tempo
 * and key added, as long as asked, and decoded to WAV so it is shaped as every take is. It is
 * installed and ready when the project has an ElevenLabs key (`apiKey`, read on every use); the
 * account's state is Setup's, and a take that fails says why. ElevenLabs takes no seed with a
 * prompt, so a take has none. `client` and `decode` are replaced in tests.
 */
export function createElevenMusic({
  apiKey,
  client = createElevenLabsClient,
  decode = decodeMp3,
}: {
  apiKey: () => Promise<string | null>
  client?: (key: string) => ElevenLabsClient
  decode?: (mp3: Uint8Array) => Promise<Uint8Array>
}): MusicGenerator {
  return {
    installed: async () => (await apiKey()) !== null,
    ready: async () => ((await apiKey()) !== null ? { ok: true } : NO_KEY),
    async generate({ brief, bpm, key, seconds }, signal) {
      const found = await apiKey()
      if (!found) throw new Error(NO_KEY.message)
      const prompt = [brief, ...(bpm ? [`${bpm} BPM`] : []), ...(key ? [key] : [])].join(', ')
      const mp3 = await client(found).music({ prompt, lengthMs: seconds * 1000 }, signal)
      return { wav: await decode(mp3) }
    },
    close() {},
  }
}
