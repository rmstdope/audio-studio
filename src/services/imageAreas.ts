import { dirname } from 'node:path'
import { areaFractions, withAreas } from '../core/images'
import { ImageManifestSchema } from '../core/imageTakes'
import type { Problem, Project } from '../core/project'
import { readResource, writeAtomic, writeFailure } from './files'
import { readImages } from './imageLists'
import { choices, sorted } from './musicClips'

/** What passing the placed areas to the game answered: done, or why the manifest could not take them. */
export type AreaSyncResult =
  { ok: true } | { ok: false; reason: 'read' | 'write' | 'entry'; message: string }

/**
 * Brings the `areas` of the images manifest entries of `ids` up to date with the boxes placed in
 * the studio's edits: only the areas the game currently asks for, as fractions of the picture, the
 * key gone when none are placed. An image with no entry is left alone (`requireEntry` makes that a
 * failure) and one the lists disagree on is no row, so it keeps what the game has. The manifest is
 * written only when something changed. It takes its turn with the choosing of takes, which write
 * the same manifest.
 */
export function syncImageAreas(
  projectFile: string,
  project: Project,
  ids: readonly string[],
  options: { requireEntry?: boolean } = {},
): Promise<AreaSyncResult> {
  // The turn of choosing a take, which reads and writes the same manifest: never both at once.
  return choices().run(`image-choice\0${projectFile}`, () =>
    syncNow(dirname(projectFile), project, ids, options),
  )
}

async function syncNow(
  root: string,
  project: Project,
  ids: readonly string[],
  { requireEntry = false }: { requireEntry?: boolean },
): Promise<AreaSyncResult> {
  const config = project.images
  if (!config) return { ok: true }
  const problems: Problem[] = []
  const read = await readResource(root, config.manifest, ImageManifestSchema, problems)
  if (read === 'invalid') {
    return { ok: false, reason: 'read', message: 'the images manifest could not be read' }
  }
  const manifest = read === 'missing' ? {} : read
  const summary = await readImages(root, project, [])
  const rows = summary?.acts.flatMap((act) => act.rows) ?? []
  let changed = false
  for (const id of ids) {
    const row = rows.find((r) => r.id === id)
    if (!row) continue
    const entry = manifest[id]
    if (!entry) {
      if (requireEntry) {
        return {
          ok: false,
          reason: 'entry',
          message: 'the image has no entry in the images manifest',
        }
      }
      continue
    }
    const next = withAreas(entry, areaFractions(row.areas, row))
    if (JSON.stringify(next) !== JSON.stringify(entry)) {
      manifest[id] = next
      changed = true
    }
  }
  if (!changed) return { ok: true }
  try {
    await writeAtomic(root, config.manifest, `${JSON.stringify(sorted(manifest), null, 2)}\n`)
  } catch (error) {
    return { ok: false, reason: 'write', message: writeFailure(error) }
  }
  return { ok: true }
}
