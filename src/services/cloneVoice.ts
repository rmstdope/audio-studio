import { dirname } from 'node:path'
import { MAX_FILES } from '../core/cloneVoice'
import type { FishFactory } from './auditions'
import { FishError, NO_KEY, type CreateVoiceRequest } from './fish'
import { knownCharacter, openProject, type ProjectFailure } from './workspace'

/** The voice made, or why it was not. Null for an unknown character. */
export type CloneResult =
  | { ok: true; voice: { id: string; name: string } }
  | { ok: false; reason: 'invalid' | 'no-key' | 'fish' | 'failed'; message: string }
  | ProjectFailure
  | null

/**
 * Makes a private voice on the user's Fish account from recordings, for a character's page.
 * Checks what the page checked (a name, 1 to 20 files) again, since the page is not trusted;
 * the length of each recording is Fish's to judge. Nothing of the project's is written: the voice
 * lives on Fish until the user casts it.
 */
export async function cloneVoice(
  projectFile: string,
  characterId: string,
  request: CreateVoiceRequest,
  fishFor: FishFactory,
): Promise<CloneResult> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  const title = request.title.trim()
  if (!title) return { ok: false, reason: 'invalid', message: 'The voice needs a name.' }
  if (request.files.length < 1 || request.files.length > MAX_FILES) {
    return {
      ok: false,
      reason: 'invalid',
      message: `Fish takes 1 to ${MAX_FILES} recordings, not ${request.files.length}.`,
    }
  }
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const fish = await fishFor(dirname(projectFile), opened.project)
  if (!fish) return { ok: false, reason: 'no-key', message: NO_KEY }
  try {
    const voice = await fish.createVoice({ title, files: request.files })
    return { ok: true, voice: { id: voice.id, name: voice.title || title } }
  } catch (error) {
    // Fish saying no is a refusal; anything else (no answer, a broken connection) leaves it
    // unknown whether the voice was made.
    if (error instanceof FishError) return { ok: false, reason: 'fish', message: error.detail }
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
