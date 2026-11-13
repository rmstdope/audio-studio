import { join } from 'node:path'
import type { Look } from '../core/imageLook'
import { gamePatch, PatchBoardSchema, type PatchBoard } from '../core/imagePatches'
import type { ImageRow } from '../core/images'
import { resolveInRoot } from '../core/paths'
import { CACHE_DIR, type Problem } from '../core/project'
import { readResource, writeOrRefuse } from './files'
import { IMAGE_TAKES_DIR } from './imageLists'
import { boardQueue } from './musicTakes'
import { decodePng, encodeTransparentPng } from './png'
import type { ProjectFailure } from './workspace'

/** The folder of a patch's takes: the studio's cache, never committed and never read by the game. */
export const patchFolder = (image: string, patch: string) =>
  `${CACHE_DIR}/image-patches/${image}/${patch}`

/** A patch take's picture as the model made it, kept inside the marked area, relative to the project root. */
export const patchPictureOf = (image: string, patch: string, n: number) =>
  `${patchFolder(image, patch)}/${n}.png`

/** A patch take's game version: the transparent picture at the game's size, beside the take. */
export const patchGameOf = (image: string, patch: string, n: number) =>
  `${patchFolder(image, patch)}/${n}.game.png`

/** The patch picture the game reads, in the clips folder beside the image's own: `<image>.<patch>.png`. */
export const patchClipName = (image: string, patch: string) => `${image}.${patch}.png`

/**
 * The queue key of a patch's board, so that every change to it goes one after another: the take
 * engine's own key for the id `<image>\0<patch>`, so the engine's turns and these share one queue.
 */
export const patchBoardKey = (projectFile: string, image: string, patch: string) =>
  `${projectFile}\0${image}\0${patch}`

/** A patch's board as it is: empty when there is none; the failure when it cannot be read. */
export async function readPatchBoard(
  root: string,
  image: string,
  patch: string,
): Promise<PatchBoard | ProjectFailure> {
  const file = `${patchFolder(image, patch)}/board.json`
  const problems: Problem[] = []
  const board = await readResource(root, file, PatchBoardSchema, problems)
  if (board === 'missing') return PatchBoardSchema.parse({})
  if (board === 'invalid') return { ok: false, file, problems }
  return board
}

/** A patch board as it is written to its `board.json`. */
export const boardText = (board: PatchBoard) => `${JSON.stringify(board, null, 2)}\n`

/** Reads a patch's board in its turn, lets `change` alter it and writes it back if it differs. */
export function changePatchBoard<T>(
  where: { projectFile: string; root: string; image: string; patch: string },
  change: (board: PatchBoard) => T | Promise<T>,
): Promise<T | ProjectFailure> {
  const { projectFile, root, image, patch } = where
  return boardQueue().run(patchBoardKey(projectFile, image, patch), async () => {
    const board = await readPatchBoard(root, image, patch)
    if ('ok' in board) return board
    const before = JSON.stringify(board, null, 2)
    const answer = await change(board)
    const after = JSON.stringify(board, null, 2)
    if (after !== before) {
      await writeOrRefuse(root, `${patchFolder(image, patch)}/board.json`, boardText(board))
    }
    return answer
  })
}

/**
 * Makes a patch take's game version: the image take it was painted on and the take's picture,
 * both brought to the look, keeping the dots that differ (`gamePatch`). Writes it beside the take
 * and returns the PNG, or the sentence saying why not ('missing' when a picture is gone).
 */
export async function renderPatchGame(
  where: { root: string; image: string; patch: string; base: number; n: number },
  look: Look,
  size: { width: number; height: number },
): Promise<Uint8Array | { error: string }> {
  const { root, image, patch, base, n } = where
  let take: Uint8Array
  let picture: Uint8Array
  try {
    take = await Bun.file(resolveInRoot(root, `${IMAGE_TAKES_DIR}/${image}/${base}.png`)).bytes()
    picture = await Bun.file(resolveInRoot(root, patchPictureOf(image, patch, n))).bytes()
  } catch {
    return { error: 'missing' }
  }
  try {
    const png = encodeTransparentPng(gamePatch(decodePng(take), decodePng(picture), look, size))
    await writeOrRefuse(root, patchGameOf(image, patch, n), png)
    return png
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** One patch of an image as the game's manifest lists it. */
export interface ManifestPatch {
  file: string
  width: number
  height: number
}

/**
 * The patches the game gets with take `base` of the image: those with a take in the game on it
 * (`inGame`) whose game version is stored. Their pictures are written to the clips folder from the
 * stored versions (one name per patch is shared by every take of the image), and the manifest's
 * entries are returned in patch id order; empty when there are none.
 */
export async function patchesInGame(
  image: {
    root: string
    clips: string
    row: Pick<ImageRow, 'id' | 'width' | 'height' | 'patches'>
  },
  base: number,
): Promise<Record<string, ManifestPatch>> {
  const { root, clips, row } = image
  const entries: Record<string, ManifestPatch> = {}
  for (const patch of [...row.patches].sort((a, b) => a.id.localeCompare(b.id))) {
    const board = await readPatchBoard(root, row.id, patch.id)
    if ('ok' in board) continue
    const n = board.inGame[String(base)]
    if (n === undefined) continue
    const png = await Bun.file(resolveInRoot(root, patchGameOf(row.id, patch.id, n)))
      .bytes()
      .catch(() => null)
    if (!png) continue
    const file = patchClipName(row.id, patch.id)
    await writeOrRefuse(root, join(clips, file), png)
    entries[patch.id] = { file, width: row.width, height: row.height }
  }
  return entries
}
