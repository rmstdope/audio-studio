import { explainStyleProblem, lookOf, type Look } from '../core/imageLook'
import { ImageBoardSchema } from '../core/imageTakes'
import {
  ImageEditsSchema,
  ImageLockSchema,
  ImageListSchema,
  summarizeImages,
  type ImageEdits,
  type ImageListState,
  type ImagesSummary,
} from '../core/images'
import {
  CACHE_DIR,
  IMAGES_EDITS_FILE,
  IMAGES_LOCK_FILE,
  partPathFor,
  type Problem,
  type Project,
} from '../core/project'
import { resolveInRoot } from '../core/paths'
import { readJson, readResource } from './files'
import { gameFilePath } from './musicLists'

/** Where an image's takes are cached, one folder per image, `<n>.png` the model's picture and `<n>.game.png` the game's version. */
export const IMAGE_TAKES_DIR = `${CACHE_DIR}/image-takes`

/** Where an image's board is saved: one file per image (an id is a slug, so a safe file name). */
export const IMAGE_BOARD_DIR = `${CACHE_DIR}/images`

/** The look the style asks for; none when it cannot be used, with the sentence saying why. */
export async function readStyleLook(
  root: string,
): Promise<{ look: Look; error?: undefined } | { look: null; error: string }> {
  const read = await readImageEdits(root, [])
  if (read === 'invalid') {
    const raw = await readJson(resolveInRoot(root, IMAGES_EDITS_FILE))
    const style = raw.status === 'ok' ? (raw.value as { style?: unknown } | null)?.style : null
    return { look: null, error: explainStyleProblem(style ?? null, IMAGES_EDITS_FILE) }
  }
  // A project with no style has no look to bring pictures to: full colour, only the size.
  return { look: lookOf(read.style ?? { palette: [] }) }
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

/** The images edits (the style and the studio's changes), empty when there are none; 'invalid' (with the problems added) when they cannot be read. */
export async function readImageEdits(
  root: string,
  problems: Problem[],
): Promise<ImageEdits | 'invalid'> {
  const read = await readResource(root, IMAGES_EDITS_FILE, ImageEditsSchema, problems)
  return read === 'missing' ? { images: {} } : read
}

/**
 * The Images pages of a project, read fresh from disk. Null without an `images` section. Broken
 * files are added to `problems` and left out; a missing list is not a problem, the game has not
 * written it yet, nor are missing edits or a missing style.
 */
export async function readImages(
  root: string,
  project: Project,
  problems: Problem[],
): Promise<ImagesSummary | null> {
  const { images } = project
  if (!images) return null
  const lists = []
  for (const part of project.parts) {
    const file = partPathFor(images.from.part, part.id)
    const read = await readResource(root, file, ImageListSchema, problems)
    const state: ImageListState =
      read === 'missing' || read === 'invalid' ? { status: read } : { status: 'ok', images: read }
    lists.push({
      id: part.id,
      title: part.title,
      file,
      state,
      canRefresh: Boolean(project.refresh?.part),
    })
  }
  const edits = await readImageEdits(root, problems)
  const lock = await readResource(root, IMAGES_LOCK_FILE, ImageLockSchema, problems)
  const chosen = lock === 'missing' || lock === 'invalid' ? {} : lock
  const gameFiles: Record<string, boolean> = {}
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    for (const image of list.state.images) {
      if (image.file) gameFiles[image.id] = (await gameFilePath(root, image.file)) !== null
    }
  }
  const styleLook = await readStyleLook(root)
  const ids = lists.flatMap((list) =>
    list.state.status === 'ok' ? list.state.images.map((image) => image.id) : [],
  )
  const summary = summarizeImages({
    gameFiles,
    look: styleLook.look,
    lookError: styleLook.error,
    takeLooks: await readTakeLooks(root, ids),
    editsInvalid: edits === 'invalid',
    parts: project.parts,
    lists,
    editsFile: IMAGES_EDITS_FILE,
    style: edits === 'invalid' ? null : (edits.style ?? null),
    edits: edits === 'invalid' ? {} : edits.images,
    chosen,
  })
  problems.push(...summary.problems)
  return summary.images
}
