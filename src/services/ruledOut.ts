import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveInRoot } from '../core/paths'
import {
  RuledOutSchema,
  allowAgain,
  emptyRuledOut,
  listRuledOut,
  ruleOut,
  type RuledOut,
  type RuledOutVoice,
} from '../core/ruledOut'
import { characterFile, readJson, writeAtomic } from './files'
import { createSerial } from './serial'
import { knownCharacter, type ProjectFailure } from './workspace'

/** Where the voices ruled out per character are kept, in the project's tool cache. */
export const RULED_OUT_DIR = '.audio-studio/ruled-out'

/** A character's ruled-out voices, the latest first; null for an unknown character. */
export type RuledOutResult = { ok: true; voices: RuledOutVoice[] } | ProjectFailure | null

/** Changes to one character's ruled-out voices, one at a time. */
const writes = createSerial()

/** The voices ruled out for a character, the latest first. */
export async function ruledOutVoices(
  projectFile: string,
  characterId: string,
): Promise<RuledOutResult> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  return { ok: true, voices: listRuledOut(await read(projectFile, characterId)) }
}

/** The ids of the voices ruled out for a character, to leave out of a search. */
export async function ruledOutIds(projectFile: string, characterId: string): Promise<string[]> {
  return Object.keys((await read(projectFile, characterId)).voices)
}

/**
 * Rules `out` out and allows `allowed` again, for a character known to be in the project. Writes
 * only when that changes something. Gives the voices ruled out now.
 */
export async function updateRuledOut(
  projectFile: string,
  characterId: string,
  { out = [], allowed = [] }: { out?: { id: string; title: string }[]; allowed?: string[] },
  at = new Date(),
): Promise<RuledOut> {
  return change(projectFile, characterId, (ruled) =>
    allowAgain(ruleOut(ruled, out, at.toISOString()), allowed),
  )
}

/**
 * Allows voices again for a character, so later searches may show them; `'all'` forgets every
 * ruled-out voice. Gives the voices still ruled out.
 */
export async function allowVoices(
  projectFile: string,
  characterId: string,
  ids: string[] | 'all',
): Promise<RuledOutResult> {
  const known = await knownCharacter(projectFile, characterId)
  if (known !== true) return known
  const left =
    ids === 'all'
      ? await change(projectFile, characterId, () => emptyRuledOut(characterId))
      : await updateRuledOut(projectFile, characterId, { allowed: ids })
  return { ok: true, voices: listRuledOut(left) }
}

/**
 * Applies `edit` to the saved voices and saves the result, if it changed anything; none left
 * removes the file.
 */
function change(
  projectFile: string,
  characterId: string,
  edit: (ruled: RuledOut) => RuledOut,
): Promise<RuledOut> {
  return writes.run(`${projectFile}\n${characterId}`, async () => {
    const before = await read(projectFile, characterId)
    const next = edit(before)
    if (JSON.stringify(next.voices) === JSON.stringify(before.voices)) return before
    const root = dirname(projectFile)
    const file = characterFile(RULED_OUT_DIR, characterId)
    if (Object.keys(next.voices).length) {
      await writeAtomic(root, file, `${JSON.stringify(next, null, 1)}\n`)
    } else {
      await rm(resolveInRoot(root, file), { force: true })
    }
    return next
  })
}

/** The saved voices; none if there is no file, or it does not fit (a hand edit, another version). */
async function read(projectFile: string, characterId: string): Promise<RuledOut> {
  const file = resolveInRoot(dirname(projectFile), characterFile(RULED_OUT_DIR, characterId))
  const json = await readJson(file)
  if (json.status !== 'ok') return emptyRuledOut(characterId)
  const parsed = RuledOutSchema.safeParse(json.value)
  return parsed.success && parsed.data.character === characterId
    ? parsed.data
    : emptyRuledOut(characterId)
}
