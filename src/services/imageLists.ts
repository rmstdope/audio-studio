import { explainStyleProblem, lookOf, type Look } from '../core/imageLook'
import { ImageBoardSchema } from '../core/imageTakes'
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
import { resolveInRoot } from '../core/paths'
import { readJson, readResource, writeAtomic } from './files'
import { gameFilePath } from './musicLists'

/** Where the game's style as the user last saw it is kept, in the studio's own folder. */
export const STYLE_SEEN_FILE = '.audio-studio/images-style-seen.json'

/** Where an image's takes are cached, one folder per image, `<n>.png` the model's picture and `<n>.game.png` the game's version. */
export const IMAGE_TAKES_DIR = '.audio-studio/image-takes'

/** Where an image's board is saved: one file per image (an id is a slug, so a safe file name). */
export const IMAGE_BOARD_DIR = '.audio-studio/images'

/** The look the game's style file asks for; none when it cannot be used, with the sentence saying why. */
export async function readStyleLook(
  root: string,
  styleFile: string,
): Promise<{ look: Look; error?: undefined } | { look: null; error: string }> {
  const problems: Problem[] = []
  const read = await readResource(root, styleFile, StyleSchema, problems)
  if (read === 'invalid') {
    const raw = await readJson(resolveInRoot(root, styleFile))
    return {
      look: null,
      error: explainStyleProblem(raw.status === 'ok' ? raw.value : null, styleFile),
    }
  }
  // A game with no style file has no look to bring pictures to: full colour, only the size.
  return { look: lookOf(read === 'missing' ? { palette: [] } : read) }
}

/** What each listed image's takes were brought to (null for never), counting only takes whose model picture is there. */
async function readTakeLooks(
  root: string,
  ids: string[],
): Promise<Record<string, (string | null)[]>> {
  const looks: Record<string, (string | null)[]> = {}
  for (const id of ids) {
    const board = await readResource(root, `${IMAGE_BOARD_DIR}/${id}.json`, ImageBoardSchema, [])
    if (board === 'missing' || board === 'invalid') continue
    for (const take of board.takes) {
      const picture = resolveInRoot(root, `${IMAGE_TAKES_DIR}/${id}/${take.n}.png`)
      if (!(await Bun.file(picture).exists())) continue
      // A version that is gone counts as never brought, so Bring all makes it again.
      const game = resolveInRoot(root, `${IMAGE_TAKES_DIR}/${id}/${take.n}.game.png`)
      ;(looks[id] ??= []).push((await Bun.file(game).exists()) ? (take.look ?? null) : null)
    }
  }
  return looks
}

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
  const styleLook = await readStyleLook(root, images.paths.style)
  const ids = lists.flatMap((list) =>
    list.state.status === 'ok' ? list.state.images.map((image) => image.id) : [],
  )
  const summary = summarizeImages({
    gameFiles,
    look: styleLook.look,
    lookError: styleLook.error,
    takeLooks: await readTakeLooks(root, ids),
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
