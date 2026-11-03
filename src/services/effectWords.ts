import { dirname } from 'node:path'
import { applyDescription, keepMine, type EffectOverrides } from '../core/effects'
import type { Problem } from '../core/project'
import { formatEntriesPerLine, writeAtomic, writeFailure } from './files'
import { EFFECTS_OVERRIDES_FILE, readEffectOverrides, readEffects } from './effectsLists'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What changing the studio's own descriptions answered; null for an effect it does not apply to. */
export type EffectEditResult =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** One change at a time per project: each reads the file the one before wrote. */
const serial = createSerial()

/**
 * Runs `change` over the studio's descriptions and writes them back (the game's list is never
 * written). `find` says whether the change applies and the game's words it is over; null is an
 * effect it does not apply to. A descriptions file that cannot be read is reported and left as it is.
 */
function edit(
  projectFile: string,
  find: (summary: NonNullable<Awaited<ReturnType<typeof readEffects>>>) => string | null,
  change: (overrides: EffectOverrides, gameWords: string) => EffectOverrides,
): Promise<EffectEditResult> {
  return serial.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const root = dirname(projectFile)
    const summary = await readEffects(root, opened.project, [])
    if (!summary) return null
    const gameWords = find(summary)
    if (gameWords === null) return null
    const problems: Problem[] = []
    const overrides = await readEffectOverrides(root, problems)
    if (overrides === 'invalid') return { ok: false, problems }
    try {
      await writeAtomic(
        root,
        EFFECTS_OVERRIDES_FILE,
        formatEntriesPerLine(change(overrides, gameWords)),
      )
    } catch (error) {
      return {
        ok: false,
        problems: [{ file: EFFECTS_OVERRIDES_FILE, path: '', message: writeFailure(error) }],
      }
    }
    return { ok: true }
  })
}

/**
 * Saves the studio's description of an effect; null, an empty text or the game's own words take
 * it back to the game's. Changing your own words also settles a game rewording.
 */
export function setEffectDescription(
  projectFile: string,
  id: string,
  text: string | null,
): Promise<EffectEditResult> {
  return edit(
    projectFile,
    (summary) => summary.rows.find((row) => row.id === id)?.gameDescription ?? null,
    (overrides, gameWords) => applyDescription(overrides, id, text, gameWords),
  )
}

/** Keep mine: the studio's words stay, and the game's present words are the ones they are over. */
export function keepMineEffect(projectFile: string, id: string): Promise<EffectEditResult> {
  return edit(
    projectFile,
    (summary) => {
      const row = summary.rows.find((r) => r.id === id)
      return row?.changedHere ? row.gameDescription : null
    },
    (overrides, gameWords) => keepMine(overrides, id, gameWords),
  )
}

/** Forget: deletes the studio's words for an effect the game no longer lists. */
export function forgetEffect(projectFile: string, id: string): Promise<EffectEditResult> {
  return edit(
    projectFile,
    (summary) => (summary.dropped.some((effect) => effect.id === id) ? '' : null),
    (overrides) => {
      const { [id]: _forgotten, ...rest } = overrides
      return rest
    },
  )
}
