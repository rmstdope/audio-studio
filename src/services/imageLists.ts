import {
  ChosenSchema,
  ImageListSchema,
  PromptsSchema,
  StyleSchema,
  summarizeImages,
  type GameStyle,
  type ImageListState,
  type ImagesSummary,
  type ChosenEntry,
  type Prompts,
} from '../core/images'
import { partPathFor, type Problem, type Project } from '../core/project'
import { readResource, writeAtomic } from './files'
import { gameFilePath } from './musicLists'

/** Where the game's style as the user last saw it is kept, in the studio's own folder. */
export const STYLE_SEEN_FILE = '.audio-studio/images-style-seen.json'

/** The studio's own words, or none when there is no file or it cannot be read (problems are added). */
export async function readPrompts(
  root: string,
  file: string,
  problems: Problem[],
): Promise<Prompts | 'invalid'> {
  const read = await readResource(root, file, PromptsSchema, problems)
  return read === 'missing' ? { images: {}, style: {} } : read
}

/** The game's style as the user last saw it; null before the first sight. */
export async function readStyleSeen(root: string): Promise<GameStyle | null> {
  const read = await readResource(root, STYLE_SEEN_FILE, StyleSchema, [])
  return read === 'missing' || read === 'invalid' ? null : read
}

/** Records the game's style as seen. */
export function writeStyleSeen(root: string, style: GameStyle): Promise<void> {
  return writeAtomic(root, STYLE_SEEN_FILE, `${JSON.stringify(style, null, 2)}\n`)
}

/**
 * The Images pages of a project, read fresh from disk. Null without an `images` section. Broken
 * files are added to `problems` and left out; a missing list or style file is not a problem, the
 * game has not written it yet. The first time a style is read it is recorded as seen, so a later
 * change to it can be told from it.
 */
export async function readImages(
  root: string,
  project: Project,
  problems: Problem[],
): Promise<ImagesSummary | null> {
  const { images, narration } = project
  if (!images) return null
  const lists = []
  for (const part of narration.parts) {
    const file = partPathFor(images.paths.list, part.id)
    const read = await readResource(root, file, ImageListSchema, problems)
    const state: ImageListState =
      read === 'missing' || read === 'invalid' ? { status: read } : { status: 'ok', images: read }
    lists.push({
      id: part.id,
      title: part.title,
      file,
      state,
      canRefresh: Boolean(narration.refreshDialog),
    })
  }
  const styleRead = await readResource(root, images.paths.style, StyleSchema, problems)
  const style = styleRead === 'missing' || styleRead === 'invalid' ? null : styleRead
  const prompts = await readPrompts(root, images.paths.prompts, problems)
  const lock = await readResource(root, images.paths.lock, ChosenSchema, problems)
  const chosen: Record<string, ChosenEntry> = {}
  if (lock !== 'missing' && lock !== 'invalid') {
    for (const [id, entry] of Object.entries(lock.images)) {
      if (entry.chosen) chosen[id] = entry.chosen
    }
  }
  let seen = await readStyleSeen(root)
  if (style && !seen) {
    seen = style
    await writeStyleSeen(root, style).catch(() => {})
  }
  const gameFiles: Record<string, boolean> = {}
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    for (const image of list.state.images) {
      if (image.file) gameFiles[image.id] = (await gameFilePath(root, image.file)) !== null
    }
  }
  const summary = summarizeImages({
    gameFiles,
    styleInvalid: styleRead === 'invalid',
    parts: narration.parts,
    lists,
    styleFile: images.paths.style,
    style,
    prompts: prompts === 'invalid' ? { images: {}, style: {} } : prompts,
    chosen,
    seen,
  })
  problems.push(...summary.problems)
  // A change that leaves nothing out of date has no notice to put away, so it is seen at once.
  if (
    style &&
    seen &&
    !summary.images.styleNotice &&
    JSON.stringify(seen) !== JSON.stringify(style)
  ) {
    await writeStyleSeen(root, style).catch(() => {})
  }
  return summary.images
}
