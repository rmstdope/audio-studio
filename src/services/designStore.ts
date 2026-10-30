import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { DesignsSchema, emptyDesigns, type Designs } from '../core/designs'
import { resolveInRoot } from '../core/paths'
import { characterFile, readJson, writeAtomic } from './files'
import { createSerial } from './serial'
import { TAKES_DIR } from './takes'
import { cacheNameFor } from './workspace'

/** Where the voices designed per character are kept, in the project's tool cache. */
export const DESIGNS_DIR = '.content-studio/designs'

/** Changes to one character's designs, one at a time. */
const writes = createSerial()

/** The id of a designed voice: the studio's own, from the character, language, request and its place in it. */
export function designId(characterId: string, language: string, at: string, index: number): string {
  const hash = createHash('sha256').update(JSON.stringify([characterId, language, at, index]))
  return `design-${hash.digest('hex').slice(0, 12)}`
}

/** The key of a designed voice's preview among the takes (it is served as a take). */
export function designTakeKey(id: string): string {
  return createHash('sha256').update(`design-take\n${id}`).digest('hex').slice(0, 16)
}

/** Where a designed voice's preview is, relative to the project root. */
export function designPreviewPath(id: string): string {
  return `${TAKES_DIR}/${designTakeKey(id)}.mp3`
}

/**
 * The designs kept for a character in a language (the source language's when none is named);
 * none if there is no file, or it does not fit.
 */
export async function readDesigns(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<Designs> {
  const name = await cacheNameFor(projectFile, characterId, language)
  const file = resolveInRoot(dirname(projectFile), characterFile(DESIGNS_DIR, name))
  const json = await readJson(file)
  if (json.status !== 'ok') return emptyDesigns(characterId)
  const parsed = DesignsSchema.safeParse(json.value)
  return parsed.success && parsed.data.character === characterId
    ? parsed.data
    : emptyDesigns(characterId)
}

/**
 * Applies `edit` to a character's designs in a language and saves the result (if it changed), one
 * at a time.
 */
export async function changeDesigns(
  projectFile: string,
  characterId: string,
  edit: (designs: Designs) => Designs,
  language?: string,
): Promise<Designs> {
  const name = await cacheNameFor(projectFile, characterId, language)
  return writes.run(`${projectFile}\n${name}`, async () => {
    const before = await readDesigns(projectFile, characterId, language)
    const next = edit(before)
    if (JSON.stringify(next) === JSON.stringify(before)) return before
    await writeAtomic(
      dirname(projectFile),
      characterFile(DESIGNS_DIR, name),
      `${JSON.stringify(next, null, 1)}\n`,
    )
    return next
  })
}

/** The takes of the designed voices among `voiceIds` whose preview is kept, by voice id. */
export function designTakes(projectFile: string, voiceIds: string[]): Record<string, string> {
  const root = dirname(projectFile)
  return Object.fromEntries(
    voiceIds.flatMap((id) =>
      existsSync(resolveInRoot(root, designPreviewPath(id))) ? [[id, designTakeKey(id)]] : [],
    ),
  )
}
