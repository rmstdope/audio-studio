import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveInRoot } from '../core/paths'
import {
  adoptAreas,
  applyActStyleChange,
  applyActStylePick,
  applyAreaBox,
  checkAreaBox,
  type AreaBox,
  applyPatchWordsChange,
  applyStyleChange,
  applyWordsChange,
  formatImageEdits,
  resolveCompare,
  resolvePatchCompare,
  type ImageEdits,
  type StyleField,
} from '../core/images'
import { IMAGES_EDITS_FILE, type Problem, type Project } from '../core/project'
import { writeAtomic, writeFailure } from './files'
import { syncImageAreas } from './imageAreas'
import { readImageEdits, readImages } from './imageLists'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What saving a change to the images edits answered; null for an image the game does not list, or a style that is not there. */
export type ImageEditResult =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** One change at a time per project: each reads the edits the one before wrote. */
const serial = createSerial()

/** The Images pages as `readImages` gives them. */
type Summary = NonNullable<Awaited<ReturnType<typeof readImages>>>

/**
 * Runs `change` over the images edits and writes them back (the game's files are never written).
 * `find` gives what the change is about from the pages (an image's game words, the style); null
 * from it, or from `change` (it is gone since), answers null. `change` may answer problems
 * instead of edits, and nothing is written. `after` runs once the edits are written and may
 * answer problems: the edits are then written back as they were.
 */
function edit<T>(
  projectFile: string,
  find: (summary: Summary) => T | null,
  change: (edits: ImageEdits, found: T) => ImageEdits | Problem[] | null,
  after?: (project: Project) => Promise<Problem[]>,
): Promise<ImageEditResult> {
  return serial.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.images) return null
    const summary = await readImages(root, project, [])
    const found = summary ? find(summary) : null
    if (found === null) return null
    const file = IMAGES_EDITS_FILE
    const read = await readImageEdits(root)
    // Saving over a part that cannot be read would lose it: nothing is written until it is fixed.
    if (read.problems.length) return { ok: false, problems: read.problems }
    // The file as it is, to put back exactly if `after` fails; null when there is none.
    const was = after ? await readText(root, file) : null
    const changed = change(read.edits, found)
    if (changed === null) return null
    if (Array.isArray(changed)) return { ok: false, problems: changed }
    try {
      await writeAtomic(root, file, formatImageEdits(changed))
    } catch (error) {
      return { ok: false, problems: [{ file, path: '', message: writeFailure(error) }] }
    }
    const failed = after ? await after(project) : []
    if (failed.length) {
      try {
        if (was === null) await rm(resolveInRoot(root, file), { force: true })
        else await writeAtomic(root, file, was)
      } catch {
        // The edits could not be put back either: the problems already say what went wrong.
      }
      return { ok: false, problems: failed }
    }
    return { ok: true }
  })
}

/** A file's text, null when there is none. */
async function readText(root: string, path: string): Promise<string | null> {
  const file = Bun.file(resolveInRoot(root, path))
  return (await file.exists()) ? file.text() : null
}

/** The game's description of an image, from the pages; null when it is not listed. */
function descriptionOf(id: string) {
  return (summary: Summary) =>
    summary.acts.flatMap((act) => act.rows).find((row) => row.id === id)?.description ?? null
}

/** The game's words of one patch of an image, from the pages; null when the image or the patch is not listed. */
function patchWordsOf(id: string, patch: string) {
  return (summary: Summary) =>
    summary.acts
      .flatMap((act) => act.rows)
      .find((row) => row.id === id)
      ?.patches.find((p) => p.id === patch)?.description ?? null
}

/** Saves the user's own words for a patch the game asks for on an image; null or empty takes them back. */
export function setImagePatchWords(
  projectFile: string,
  id: string,
  patch: string,
  text: string | null,
): Promise<ImageEditResult> {
  return edit(projectFile, patchWordsOf(id, patch), (edits, game) =>
    applyPatchWordsChange(edits, id, patch, text, game),
  )
}

/**
 * Saves the box of a named area of an image (null takes it away). Null for an image or an area the
 * game does not list; a box outside the picture, or too small, is answered as a problem.
 */
export function setImageAreaBox(
  projectFile: string,
  id: string,
  area: string,
  box: AreaBox | null,
): Promise<ImageEditResult> {
  const file = IMAGES_EDITS_FILE
  return edit(
    projectFile,
    (summary) => {
      const row = summary.acts.flatMap((act) => act.rows).find((r) => r.id === id)
      return row?.areas.some((a) => a.id === area)
        ? { width: row.width, height: row.height, take: row.chosenTake }
        : null
    },
    (edits, size) => {
      const why = box && checkAreaBox(box, size)
      return why
        ? [{ file, path: `images.${id}.areas.${area}`, message: why }]
        : applyAreaBox(edits, id, area, box, size.take)
    },
    // The game gets the box in the same save; a clear never fails for want of an entry.
    async (project) => {
      const sync = await syncImageAreas(projectFile, project, [id], { requireEntry: box !== null })
      return sync.ok
        ? []
        : [{ file: project.images!.manifest, path: `images.${id}`, message: sync.message }]
    },
  )
}

/**
 * Moves the boxes of an image that belong to no take yet onto `take`, before the take in the game
 * changes. Nothing is written when there are none (null when the project has no images).
 */
export function adoptImageAreas(
  projectFile: string,
  id: string,
  take: number,
): Promise<ImageEditResult> {
  return serial.run(projectFile, async () => {
    const root = dirname(projectFile)
    const read = await readImageEdits(root)
    if (read.problems.length) return { ok: false, problems: read.problems }
    const next = adoptAreas(read.edits, id, take)
    if (next === read.edits) return { ok: true }
    try {
      await writeAtomic(root, IMAGES_EDITS_FILE, formatImageEdits(next))
    } catch (error) {
      return {
        ok: false,
        problems: [{ file: IMAGES_EDITS_FILE, path: '', message: writeFailure(error) }],
      }
    }
    return { ok: true }
  })
}

/** Settles a patch whose game words changed under the user's words. */
export function resolveImagePatchCompare(
  projectFile: string,
  id: string,
  patch: string,
  choice: 'keep' | 'game',
): Promise<ImageEditResult> {
  return edit(projectFile, patchWordsOf(id, patch), (edits, game) =>
    resolvePatchCompare(edits, id, patch, choice, game),
  )
}

/** Saves the user's own words for an image; null or empty takes them back. */
export function setImageWords(
  projectFile: string,
  id: string,
  text: string | null,
): Promise<ImageEditResult> {
  return edit(projectFile, descriptionOf(id), (edits, game) =>
    applyWordsChange(edits, id, text, game),
  )
}

/** Saves whether an image uses its act's style addition; the choice is the studio's own, kept even when the act adds none. */
export function setImageActStyle(
  projectFile: string,
  id: string,
  on: boolean,
): Promise<ImageEditResult> {
  return edit(projectFile, descriptionOf(id), (edits) => applyActStyleChange(edits, id, on))
}

/**
 * Saves which act's style a shared image uses (null: none). Null for an image the game does not
 * list, and for an act that does not list it or adds no style.
 */
export function setImageActStylePick(
  projectFile: string,
  id: string,
  from: string | null,
): Promise<ImageEditResult> {
  return edit(
    projectFile,
    (summary: Summary) => {
      const row = summary.acts.flatMap((act) => act.rows).find((r) => r.id === id)
      if (!row) return null
      return from === null || row.actStyle?.choices?.some((c) => c.id === from)
        ? row.description
        : null
    },
    (edits) => applyActStylePick(edits, id, from),
  )
}

/** Settles an image whose game description changed under the user's words. */
export function resolveImageCompare(
  projectFile: string,
  id: string,
  choice: 'keep' | 'game',
): Promise<ImageEditResult> {
  return edit(projectFile, descriptionOf(id), (edits, game) =>
    resolveCompare(edits, id, choice, game),
  )
}

/**
 * Sets the style's look or what is kept out; null or empty is none, which the look refuses. Null
 * when there is no style.
 */
export function setStyleField(
  projectFile: string,
  field: StyleField,
  text: string | null,
): Promise<ImageEditResult> {
  return edit(
    projectFile,
    (summary) => (summary.style.present ? summary.style : null),
    (edits) => {
      const changed = applyStyleChange(edits, field, text)
      // The style was taken out of the file since the pages were read.
      if (changed === 'no style') return null
      if (changed === 'empty look') {
        return [
          { file: IMAGES_EDITS_FILE, path: 'style.look', message: 'the look cannot be empty' },
        ]
      }
      return changed
    },
  )
}
