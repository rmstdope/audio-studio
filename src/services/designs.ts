import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setDesigned } from '../core/audition'
import { DESIGN_COUNT, descriptionState, previewText, savedName } from '../core/design'
import { addDesigns, listDesigns, markSaved, removeDesign } from '../core/designs'
import { resolveInRoot } from '../core/paths'
import { declaredLanguage, type Problem } from '../core/project'
import {
  ELEVEN_DESIGN_MODEL,
  elevenDescriptionState,
  elevenDesignCredits,
  elevenDesignText,
} from '../core/elevenDesign'
import { elevenVoice } from '../core/voices'
import { ffmpegEncoder, type Encoder } from './audio'
import type { FishFactory } from './auditions'
import { createSerial } from './serial'
import { changeDesigns, designId, designPreviewPath, readDesigns } from './designStore'
import { FishError, NO_KEY } from './fish'
import { ElevenLabsError, NO_ELEVENLABS_KEY, type ElevenLabsFactory } from './elevenlabs'
import { appendTry } from './spending'
import { writeAtomic } from './files'
import { ruledOutIds } from './ruledOut'
import { castOwnVoice, changeSession, sessionFor, type CastResult } from './sessions'
import { auditionIn, castProblems } from './takes'
import {
  cacheNameFor,
  knownCharacter,
  loadWorkspace,
  readPart,
  type ProjectFailure,
} from './workspace'

/** The description to start the design box with, or why it cannot be read. Null for an unknown character. */
export async function designsFor(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<{ ok: true; description: string | null } | ProjectFailure | null> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  return {
    ok: true,
    description: (await readDesigns(projectFile, characterId, language)).description,
  }
}

/** Designs made, or why not. Null for an unknown character. */
export type DesignResult =
  | { ok: true; added: number }
  | {
      ok: false
      reason: 'invalid' | 'no-key' | 'no-phrase' | 'fish' | 'elevenlabs' | 'failed'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Has Fish design voices from a description, each saying the character's audition phrase, and
 * keeps them for the character: their previews among the takes, the voices and the description in
 * the character's designs for the language. If an audition is going on they join its board. Nothing is kept when
 * Fish fails (it bills nothing then). The caller has admitted the cost.
 */
export async function designVoices(
  projectFile: string,
  characterId: string,
  description: string,
  fishFor: FishFactory,
  encode: Encoder = ffmpegEncoder,
  asked?: string,
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
  // The preview says the audition phrase of the language: without one there is nothing to say.
  const seen = auditionIn(project, cast, summary, characterId, asked)
  if (seen.audition.phrase === null) {
    return {
      ok: false,
      reason: 'no-phrase',
      message: 'There is no audition phrase to design with; write one first.',
    }
  }
  const root = dirname(projectFile)
  const fish = await fishFor(root, project)
  if (!fish) return { ok: false, reason: 'no-key', message: NO_KEY }
  // The last description sent, kept before Fish answers: the box opens with it again after a failure.
  await changeDesigns(
    projectFile,
    characterId,
    (designs) => ({ ...designs, description: text }),
    asked,
  )
  const stamp = at.toISOString()
  try {
    const candidates = await fish.designVoice({
      instruction: text,
      referenceText: previewText(seen.audition.phrase),
      language: seen.language,
      count: DESIGN_COUNT,
    })
    const ids = candidates.map((_, index) => designId(characterId, seen.language, stamp, index))
    await Promise.all(
      candidates.map((candidate, index) =>
        encode(candidate.wav, resolveInRoot(root, designPreviewPath(ids[index]!)), {
          bitrate: '192k',
          channels: 1,
        }),
      ),
    )
    const kept = await changeDesigns(
      projectFile,
      characterId,
      (designs) => addDesigns(designs, text, stamp, ids),
      asked,
    )
    const ruled = await ruledOutIds(projectFile, characterId, asked)
    // An audition going on shows them at once; with none, the next one will.
    await changeSession(
      projectFile,
      characterId,
      (s) => setDesigned(s, listDesigns(kept), ruled),
      undefined,
      asked,
    )
    return { ok: true, added: ids.length }
  } catch (error) {
    if (error instanceof FishError) return { ok: false, reason: 'fish', message: error.detail }
    // Not Fish refusing: whether it billed is unknown (it answered, or never did).
    return { ok: false, reason: 'failed', message: errorText(error) }
  }
}

/** What an ElevenLabs design would say and cost, or why there is none. Null for an unknown character. */
export type ElevenDesignPlan =
  | { ok: true; text: string | null; credits: number }
  | { ok: false; reason: 'no-phrase'; message: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * What the previews of an ElevenLabs design for the character would say (`elevenDesignText`: the
 * audition phrase of the language, then her lines in the order of the parts; null for ElevenLabs'
 * own text), and the credits it uses.
 */
export async function elevenDesignFor(
  projectFile: string,
  characterId: string,
  asked?: string,
): Promise<ElevenDesignPlan> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const { project, summary, cast } = loaded
  const character = summary.characters.find((c) => c.id === characterId)
  if (!character) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }
  const seen = auditionIn(project, cast, summary, characterId, asked)
  if (seen.audition.phrase === null) {
    return {
      ok: false,
      reason: 'no-phrase',
      message: 'There is no audition phrase to design with; write one first.',
    }
  }
  const phrase = seen.audition.phrase
  const lines: string[] = []
  for (const { part } of character.languages[seen.language]?.appearances ?? []) {
    // Parts are read only until there is enough to say.
    if (elevenDesignText(phrase, lines) !== null) break
    const read = await readPart(projectFile, part, asked)
    if (!read?.ok || read.dialog.status !== 'ok') continue
    for (const line of read.dialog.lines) {
      if (line.speaker === characterId && line.text) lines.push(line.text)
    }
  }
  const text = elevenDesignText(phrase, lines)
  return { ok: true, text, credits: elevenDesignCredits(text) }
}

/**
 * Has ElevenLabs design voices from a description (Eleven v3 design), each saying `planned`'s
 * text (what was confirmed; what `elevenDesignFor` gives when absent), and keeps them for the
 * character as Fish's designs are kept, with the id each is saved by; the credits it charged (its
 * text's characters) go in the spending record. If an audition is going on they join its board.
 * Nothing is kept when ElevenLabs fails. The caller has admitted the cost.
 */
export async function designElevenVoices(
  projectFile: string,
  characterId: string,
  description: string,
  elevenFor: ElevenLabsFactory,
  asked?: string,
  at: Date = new Date(),
  planned?: { text: string | null },
): Promise<DesignResult> {
  const text = description.trim()
  const state = elevenDescriptionState(text)
  if (!state.canSend) {
    return {
      ok: false,
      reason: 'invalid',
      message: state.tooLong ?? 'Describe the voice you want in 20 characters or more.',
    }
  }
  let preview: string | null
  if (planned) preview = planned.text
  else {
    const plan = await elevenDesignFor(projectFile, characterId, asked)
    if (!plan?.ok) return plan
    preview = plan.text
  }
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  const root = dirname(projectFile)
  const client = await elevenFor(root, loaded.project)
  if (!client) return { ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY }
  await changeDesigns(
    projectFile,
    characterId,
    (designs) => ({ ...designs, description: text }),
    asked,
  )
  const language = declaredLanguage(loaded.project.narration, asked)
  const stamp = at.toISOString()
  try {
    const designed = await client.designVoices({ description: text, text: preview })
    const said = [...designed.text].length
    try {
      // Charged by ElevenLabs as soon as it answered: logged even if the studio cannot keep them.
      await appendTry(projectFile, {
        id: randomUUID(),
        at: stamp,
        kind: 'design',
        character: characterId,
        language,
        model: ELEVEN_DESIGN_MODEL,
        characters: said,
        credits: said,
      })
    } catch {
      // Only the record of what it cost is lost.
    }
    if (!designed.previews.length) {
      return { ok: false, reason: 'failed', message: 'ElevenLabs sent no voices' }
    }
    const ids = designed.previews.map((_, index) => designId(characterId, language, stamp, index))
    for (const [index, preview] of designed.previews.entries()) {
      await writeAtomic(root, designPreviewPath(ids[index]!), preview.audio)
    }
    const kept = await changeDesigns(
      projectFile,
      characterId,
      (designs) =>
        addDesigns(
          designs,
          text,
          stamp,
          ids,
          designed.previews.map((p) => p.generated),
        ),
      asked,
    )
    const ruled = await ruledOutIds(projectFile, characterId, asked)
    await changeSession(
      projectFile,
      characterId,
      (s) => setDesigned(s, listDesigns(kept), ruled),
      undefined,
      asked,
    )
    return { ok: true, added: ids.length }
  } catch (error) {
    if (error instanceof ElevenLabsError) {
      return { ok: false, reason: 'elevenlabs', message: error.detail }
    }
    return { ok: false, reason: 'failed', message: errorText(error) }
  }
}

/** Casts of designs, one at a time per character and language: a second press waits for the first. */
const casts = createSerial()

/**
 * Casts a shortlisted designed voice: first saves its preview to the user's Fish account as a
 * private voice named `<name> (designed)` (Fish makes no voice from a design until then), then
 * casts that voice, which ends the audition. If Fish cannot save it nothing is cast and the design
 * stays shortlisted. A voice saved whose cast then failed is remembered, so trying again casts it
 * and saves no second one. The saved voice leaves the character's kept designs once cast.
 */
export async function castDesign(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
  language?: string,
  elevenFor: ElevenLabsFactory = async () => null,
): Promise<CastResult> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return casts.run(`${projectFile}\n${name}`, async () => {
    const loaded = await loadWorkspace(projectFile)
    if (!loaded.ok) return loaded
    const character = loaded.summary.characters.find((c) => c.id === characterId)
    if (!character) return null
    const found = await sessionFor(projectFile, characterId, language)
    if (!found?.ok || !found.session) {
      return { ok: false, reason: 'no-session', message: 'There is no audition to cast from.' }
    }
    if (!found.session.shortlist.includes(voiceId) || !found.session.voices[voiceId]?.design) {
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
    let saved = (await readDesigns(projectFile, characterId, language)).saved[voiceId]
    const design = found.session.voices[voiceId]!.design!
    if (!saved && design.generated) {
      // ElevenLabs saves the preview it made by its id, as a voice of the user's.
      const client = await elevenFor(root, loaded.project)
      if (!client) return failed(NO_ELEVENLABS_KEY)
      const title = savedName(character.name, [])
      try {
        const id = await client.saveDesignedVoice({
          generated: design.generated,
          name: title,
          description: design.description,
        })
        saved = { id: elevenVoice(id), name: title }
      } catch (error) {
        return failed(error instanceof ElevenLabsError ? error.detail : errorText(error))
      }
      const voice = saved
      await changeDesigns(projectFile, characterId, (d) => markSaved(d, voiceId, voice), language)
    }
    if (!saved) {
      const fish = await fishFor(root, loaded.project)
      if (!fish) return failed(NO_KEY)
      try {
        const existing = (await fish.listOwnVoices()).map((v) => v.title)
        const title = savedName(character.name, existing)
        const bytes = await readFile(resolveInRoot(root, designPreviewPath(voiceId))).catch(
          () => null,
        )
        if (!bytes) return failed('The preview of this design is gone from the studio’s cache.')
        const made = await fish.createVoice({
          title,
          files: [{ name: `${voiceId}.mp3`, type: 'audio/mpeg', bytes: new Uint8Array(bytes) }],
        })
        saved = { id: made.id, name: made.title || title }
      } catch (error) {
        return failed(error instanceof FishError ? error.detail : errorText(error))
      }
      const voice = saved
      await changeDesigns(projectFile, characterId, (d) => markSaved(d, voiceId, voice), language)
    }
    const cast = await castOwnVoice(projectFile, characterId, saved, language)
    if (cast?.ok) {
      await changeDesigns(projectFile, characterId, (d) => removeDesign(d, voiceId), language)
    }
    return cast
  })
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
