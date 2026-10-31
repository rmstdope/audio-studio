import { dirname } from 'node:path'
import {
  StyleSchema,
  applyActStyleChange,
  applyStyleChange,
  applyWordsChange,
  resolveCompare,
  type Prompts,
  type StyleField,
} from '../core/images'
import type { Problem } from '../core/project'
import { readResource, writeAtomic } from './files'
import { readImages, readPrompts, writeStyleSeen } from './imageLists'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What saving a change to the studio's own image words answered; null for an image the game does not list. */
export type ImageEditResult =
  { ok: true } | { ok: false; problems: Problem[] } | ProjectFailure | null

/** One change at a time per project: each reads the prompts file the one before wrote. */
const serial = createSerial()

/** The prompts file as text: image ids in order, so changes make small diffs. */
function formatPrompts(prompts: Prompts): string {
  const images = Object.fromEntries(
    Object.entries(prompts.images).sort(([a], [b]) => (a < b ? -1 : 1)),
  )
  const { look, keepOut } = prompts.style
  const style = { ...(look && { look }), ...(keepOut && { keepOut }) }
  const actStyleOff = [...new Set(prompts.actStyleOff)].sort()
  return `${JSON.stringify({ images, style, ...(actStyleOff?.length && { actStyleOff }) }, null, 2)}\n`
}

/**
 * Runs `change` over the studio's own words and writes them back (the game's files are never
 * written). `gameWords` says the game's text for the change; null from `find` is an unknown image.
 */
function edit(
  projectFile: string,
  find: (images: NonNullable<Awaited<ReturnType<typeof readImages>>>) => string | null,
  change: (prompts: Prompts, gameWords: string) => Prompts,
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
    const file = project.images.paths.prompts
    const problems: Problem[] = []
    const prompts = await readPrompts(root, file, problems)
    if (prompts === 'invalid') return { ok: false, problems }
    await writeAtomic(root, file, formatPrompts(change(prompts, gameWords)))
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
  return edit(projectFile, descriptionOf(id), (prompts, game) =>
    applyWordsChange(prompts, id, text, game),
  )
}

/** Saves whether an image uses its act's style addition; the choice is the studio's own, kept even when the act adds none. */
export function setImageActStyle(
  projectFile: string,
  id: string,
  on: boolean,
): Promise<ImageEditResult> {
  return edit(projectFile, descriptionOf(id), (prompts) => applyActStyleChange(prompts, id, on))
}

/** Settles an image whose game description changed under the user's words. */
export function resolveImageCompare(
  projectFile: string,
  id: string,
  choice: 'keep' | 'game',
): Promise<ImageEditResult> {
  return edit(projectFile, descriptionOf(id), (prompts, game) =>
    resolveCompare(prompts, id, choice, game),
  )
}

/** Saves the user's own words for the look or what is kept out; null or empty takes them back. Null without a style file. */
export function setStyleField(
  projectFile: string,
  field: StyleField,
  text: string | null,
): Promise<ImageEditResult> {
  return edit(
    projectFile,
    (summary) => (summary.style.present ? summary.style[field].game : null),
    (prompts, game) => applyStyleChange(prompts, field, text, game),
  )
}

/** Puts the style notice away: the game's style as it is now becomes the one the user has seen. */
export function markStyleSeen(projectFile: string): Promise<ImageEditResult> {
  return serial.run(projectFile, async () => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.images) return null
    const problems: Problem[] = []
    const style = await readResource(root, project.images.paths.style, StyleSchema, problems)
    if (style === 'missing') return null
    if (style === 'invalid') return { ok: false, problems }
    await writeStyleSeen(root, style)
    return { ok: true }
  })
}
