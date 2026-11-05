import { dirname } from 'node:path'
import {
  applyActStyleChange,
  applyActStylePick,
  applyStyleChange,
  applyWordsChange,
  formatImageEdits,
  resolveCompare,
  type ImageEdits,
  type StyleField,
} from '../core/images'
import { IMAGES_EDITS_FILE, type Problem } from '../core/project'
import { writeAtomic, writeFailure } from './files'
import { readImageEdits, readImages } from './imageLists'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What saving a change to the images edits answered; null for an image the game does not list, or a style that is not there. */
export type ImageEditResult =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** One change at a time per project: each reads the edits the one before wrote. */
const serial = createSerial()

/**
 * Runs `change` over the images edits and writes them back (the game's files are never written).
 * `gameWords` says the game's text for the change; null from `find` is an unknown image. `change`
 * may answer problems instead of edits, and nothing is written.
 */
function edit(
  projectFile: string,
  find: (images: NonNullable<Awaited<ReturnType<typeof readImages>>>) => string | null,
  change: (edits: ImageEdits, gameWords: string) => ImageEdits | Problem[],
): Promise<ImageEditResult> {
  return serial.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.images) return null
    const summary = await readImages(root, project, [])
    const gameWords = summary ? find(summary) : null
    if (gameWords === null) return null
    const file = IMAGES_EDITS_FILE
    const problems: Problem[] = []
    const edits = await readImageEdits(root, problems)
    if (edits === 'invalid') return { ok: false, problems }
    const changed = change(edits, gameWords)
    if (Array.isArray(changed)) return { ok: false, problems: changed }
    try {
      await writeAtomic(root, file, formatImageEdits(changed))
    } catch (error) {
      return { ok: false, problems: [{ file, path: '', message: writeFailure(error) }] }
    }
    return { ok: true }
  })
}

/** The game's description of an image, from the pages; null when it is not listed. */
function descriptionOf(id: string) {
  return (summary: NonNullable<Awaited<ReturnType<typeof readImages>>>) =>
    summary.acts.flatMap((act) => act.rows).find((row) => row.id === id)?.description ?? null
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
    (summary) => {
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
    (summary) => (summary.style.present ? '' : null),
    (edits) =>
      applyStyleChange(edits, field, text) ?? [
        { file: IMAGES_EDITS_FILE, path: `style.${field}`, message: 'the look cannot be empty' },
      ],
  )
}
