import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setDesigned } from '../core/audition'
import { DESIGN_COUNT, descriptionState, isDesignId, previewText, savedName } from '../core/design'
import { addDesigns, listDesigns, removeDesign } from '../core/designs'
import { resolveInRoot } from '../core/paths'
import type { Problem } from '../core/project'
import { ffmpegEncoder, type Encoder } from './audio'
import type { FishFactory } from './auditions'
import { changeDesigns, designId, designPreviewPath, readDesigns } from './designStore'
import { FishError, NO_KEY } from './fish'
import { ruledOutIds } from './ruledOut'
import { castOwnVoice, changeSession, sessionFor, type CastResult } from './sessions'
import { auditionFor, castProblems } from './takes'
import { knownCharacter, loadWorkspace, type ProjectFailure } from './workspace'

/** The description to start the design box with, or why it cannot be read. Null for an unknown character. */
export async function designsFor(
  projectFile: string,
  characterId: string,
): Promise<{ ok: true; description: string | null } | ProjectFailure | null> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  return { ok: true, description: (await readDesigns(projectFile, characterId)).description }
}

/** Designs made, or why not. Null for an unknown character. */
export type DesignResult =
  | { ok: true; added: number }
  | { ok: false; reason: 'invalid' | 'no-key' | 'fish' | 'failed'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Has Fish design voices from a description, each saying the character's audition phrase, and
 * keeps them for the character: their previews among the takes, the voices and the description in
 * the character's designs. If an audition is going on they join its board. Nothing is kept when
 * Fish fails (it bills nothing then). The caller has admitted the cost.
 */
export async function designVoices(
  projectFile: string,
  characterId: string,
  description: string,
  fishFor: FishFactory,
  encode: Encoder = ffmpegEncoder,
  at: Date = new Date(),
): Promise<DesignResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const { project, summary, cast } = loaded
  if (!summary.characters.some((c) => c.id === characterId)) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }
  const text = description.trim()
  const state = descriptionState(text)
  if (!state.canSend) {
    return {
      ok: false,
      reason: 'invalid',
      message: state.tooLong ?? 'Describe the voice you want first.',
    }
  }
  const root = dirname(projectFile)
  const fish = await fishFor(root, project)
  if (!fish) return { ok: false, reason: 'no-key', message: NO_KEY }
  // The last description sent, kept before Fish answers: the box opens with it again after a failure.
  await changeDesigns(projectFile, characterId, (designs) => ({ ...designs, description: text }))
  const stamp = at.toISOString()
  try {
    const candidates = await fish.designVoice({
      instruction: text,
      referenceText: previewText(auditionFor(cast, characterId, project).phrase),
      language: project.narration.audition.language || null,
      count: DESIGN_COUNT,
    })
    const ids = candidates.map((_, index) => designId(characterId, stamp, index))
    await Promise.all(
      candidates.map((candidate, index) =>
        encode(candidate.wav, resolveInRoot(root, designPreviewPath(ids[index]!)), {
          bitrate: '192k',
          channels: 1,
        }),
      ),
    )
    const kept = await changeDesigns(projectFile, characterId, (designs) =>
      addDesigns(designs, text, stamp, ids),
    )
    const ruled = await ruledOutIds(projectFile, characterId)
    // An audition going on shows them at once; with none, the next one will.
    await changeSession(projectFile, characterId, (s) => setDesigned(s, listDesigns(kept), ruled))
    return { ok: true, added: ids.length }
  } catch (error) {
    if (error instanceof FishError) return { ok: false, reason: 'fish', message: error.detail }
    return {
      ok: false,
      reason: 'failed',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Casts a shortlisted designed voice: first saves its preview to the user's Fish account as a
 * private voice named `<name> (designed)` (Fish makes no voice from a design until then), then
 * casts that voice, which ends the audition. If Fish cannot save it nothing is cast and the design
 * stays shortlisted. The saved voice leaves the character's kept designs.
 */
export async function castDesign(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
): Promise<CastResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const character = loaded.summary.characters.find((c) => c.id === characterId)
  if (!character) return null
  const found = await sessionFor(projectFile, characterId)
  if (!found?.ok || !found.session) {
    return { ok: false, reason: 'no-session', message: 'There is no audition to cast from.' }
  }
  if (
    !isDesignId(voiceId) ||
    !found.session.shortlist.includes(voiceId) ||
    !found.session.voices[voiceId]?.design
  ) {
    return {
      ok: false,
      reason: 'not-shortlisted',
      message: 'Only a shortlisted voice can be cast; shortlist it first.',
    }
  }
  const root = dirname(projectFile)
  const failed = (message: string): CastResult => ({
    ok: false,
    reason: 'save',
    voice: voiceId,
    message,
  })
  const fish = await fishFor(root, loaded.project)
  if (!fish) return failed(NO_KEY)
  let saved
  try {
    const existing = (await fish.listOwnVoices()).map((v) => v.title)
    const title = savedName(character.name, existing)
    const bytes = await readFile(resolveInRoot(root, designPreviewPath(voiceId))).catch(() => null)
    if (!bytes) return failed('The preview of this design is gone from the studio’s cache.')
    const made = await fish.createVoice({
      title,
      files: [{ name: `${voiceId}.mp3`, type: 'audio/mpeg', bytes: new Uint8Array(bytes) }],
    })
    saved = { id: made.id, name: made.title || title }
  } catch (error) {
    return failed(error instanceof FishError ? error.detail : errorText(error))
  }
  const cast = await castOwnVoice(projectFile, characterId, saved)
  if (cast?.ok) {
    await changeDesigns(projectFile, characterId, (designs) => removeDesign(designs, voiceId))
  }
  return cast
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
