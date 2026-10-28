import { dirname } from 'node:path'
import { addedVoiceFor, ElevenVoicesSchema, type ElevenVoices } from '../core/elevenLibrary'
import { resolveInRoot } from '../core/paths'
import type { Voice } from '../core/voiceSearch'
import { elevenVoice, providerId } from '../core/voices'
import type { ElevenLabsClient } from './elevenlabs'
import { readJson, writeAtomic } from './files'
import { createSerial } from './serial'

/** The voices the studio added from ElevenLabs' library, in the project's tool cache. */
export const ELEVEN_VOICES_FILE = '.audio-studio/eleven-voices.json'

/** Additions to a project's voices, one at a time, so a library voice is added once. */
const writes = createSerial()

/** The voices the studio added from ElevenLabs' library; none if there is no file, or it does not fit. */
export async function readAddedVoices(projectFile: string): Promise<ElevenVoices> {
  const json = await readJson(resolveInRoot(dirname(projectFile), ELEVEN_VOICES_FILE))
  const parsed = json.status === 'ok' ? ElevenVoicesSchema.safeParse(json.value) : null
  return parsed?.success ? parsed.data : { version: 1, added: [] }
}

/**
 * The ElevenLabs voice to speak or cast `voice` with (the studio's id): a voice of the library
 * not on the user's voices yet is added first, taking one of the plan's voice slots, and
 * remembered with `character`, so it is added once; any other is itself.
 */
export async function voiceToSpeak(
  projectFile: string,
  client: ElevenLabsClient,
  voice: Voice,
  character: string,
  at: Date = new Date(),
): Promise<string> {
  const library = voice.library
  if (!library || library.added) return voice.id
  return writes.run(projectFile, async () => {
    const before = await readAddedVoices(projectFile)
    const known = addedVoiceFor(before, voice.id)
    if (known) return known
    const id = elevenVoice(
      await client.addSharedVoice(library.owner, providerId(voice.id), voice.title),
    )
    const next: ElevenVoices = {
      ...before,
      added: [
        ...before.added,
        { library: voice.id, voice: id, name: voice.title, character, at: at.toISOString() },
      ],
    }
    await writeAtomic(
      dirname(projectFile),
      ELEVEN_VOICES_FILE,
      `${JSON.stringify(next, null, 1)}\n`,
    )
    return id
  })
}
