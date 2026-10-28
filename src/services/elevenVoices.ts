import { dirname } from 'node:path'
import {
  addedVoiceFor,
  ElevenVoicesSchema,
  freeableVoices,
  type ElevenVoices,
} from '../core/elevenLibrary'
import { resolveInRoot } from '../core/paths'
import type { Voice } from '../core/voiceSearch'
import { elevenVoice, providerId } from '../core/voices'
import { ElevenLabsError, NO_ELEVENLABS_KEY, type ElevenLabsClient } from './elevenlabs'
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
 * The ElevenLabs voice to speak or cast `voice` with (the studio's id): a voice of the library the
 * studio added is the voice it became; one not on the user's voices yet is added first (with the
 * client `clientFor` gives, null meaning no key), taking one of the plan's voice slots, and
 * remembered with `character`, so it is added once; any other is itself.
 */
export async function voiceToSpeak(
  projectFile: string,
  clientFor: () => Promise<ElevenLabsClient | null>,
  voice: Voice,
  character: string,
  at: Date = new Date(),
): Promise<string> {
  const library = voice.library
  if (!library) return voice.id
  return writes.run(projectFile, async () => {
    const before = await readAddedVoices(projectFile)
    // Read first: ElevenLabs says a voice the studio added is the user's, under its library id.
    const known = addedVoiceFor(before, voice.id)
    if (known) return known
    if (library.added) return voice.id
    const client = await clientFor()
    if (!client) throw new Error(NO_ELEVENLABS_KEY)
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
    await writeAdded(projectFile, next)
    return id
  })
}

/** What freeing voice slots did: the names of the voices removed, and those ElevenLabs kept. */
export type FreedResult =
  | { ok: true; freed: string[]; failed: { name: string; message: string }[] }
  | { ok: false; reason: 'no-key'; message: string }

/**
 * Removes from the user's ElevenLabs voices those of `voices` (account ids) that the studio added
 * and that are not in `used` (see `freeableVoices`), freeing their voice slots, and forgets them.
 * A voice ElevenLabs no longer has counts as removed; one it would not remove is kept, with why.
 */
export async function freeVoices(
  projectFile: string,
  clientFor: () => Promise<ElevenLabsClient | null>,
  voices: string[],
  used: Set<string>,
): Promise<FreedResult> {
  const client = await clientFor()
  if (!client) return { ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY }
  return writes.run(projectFile, async () => {
    const before = await readAddedVoices(projectFile)
    const asked = new Set(voices)
    const freed: ElevenVoices['added'] = []
    const failed: { name: string; message: string }[] = []
    for (const added of freeableVoices(before, used).filter((a) => asked.has(a.voice))) {
      try {
        await client.deleteVoice(providerId(added.voice))
        freed.push(added)
      } catch (error) {
        if (error instanceof ElevenLabsError && error.status === 404) freed.push(added)
        else
          failed.push({
            name: added.name,
            message: error instanceof Error ? error.message : String(error),
          })
      }
    }
    if (freed.length) {
      await writeAdded(projectFile, {
        ...before,
        added: before.added.filter((a) => !freed.includes(a)),
      })
    }
    return { ok: true, freed: freed.map((a) => a.name), failed }
  })
}

/** Writes the voices the studio added. */
async function writeAdded(projectFile: string, file: ElevenVoices): Promise<void> {
  await writeAtomic(dirname(projectFile), ELEVEN_VOICES_FILE, `${JSON.stringify(file, null, 1)}\n`)
}
