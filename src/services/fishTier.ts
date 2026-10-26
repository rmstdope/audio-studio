import { basename } from 'node:path'
import { ProjectSchema, problemsFrom, type Problem } from '../core/project'
import type { FishTier } from '../core/setup'
import { openProject, projectJson, projectWrites, saveProject } from './projectFile'
import type { ProjectFailure } from './workspace'

/** A saved Fish tier, or why it was not saved. */
export type FishTierChange = { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure

const PATH = 'narration.quality.fishTier'

/**
 * Saves what the user has paid Fish in total (`narration.quality.fishTier` in the project file),
 * or clears it with `null`. The file is read once and the rest of it kept as it was, in its own
 * indentation and line endings. A `quality` left empty by clearing goes too.
 */
export function setFishTier(projectFile: string, tier: FishTier | null): Promise<FishTierChange> {
  return projectWrites.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { raw } = opened
    const narration = (raw as { narration: Record<string, unknown> }).narration
    const had = isObject(narration.quality) ? narration.quality : {}
    const quality = { ...had }
    if (tier) quality.fishTier = tier
    else delete quality.fishTier
    if (!Object.keys(quality).length && 'fishTier' in had) delete narration.quality
    else if (Object.keys(quality).length) narration.quality = quality
    const file = basename(projectFile)
    const parsed = ProjectSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, problems: problemsFrom(file, parsed.error) }
    return saveProject(projectFile, opened, PATH, (indent) => projectJson(raw, indent))
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
