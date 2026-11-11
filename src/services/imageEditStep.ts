import { rm } from 'node:fs/promises'
import type { EditModelId } from '../core/imageModels'
import { cropPixels, editWindow, pastePixels, type Pixels } from '../core/imagePixels'
import {
  keepChanged,
  matchOutside,
  matchToTake,
  openSides,
  type PatchArea,
} from '../core/imagePatches'
import { resolveInRoot } from '../core/paths'
import { writeAtomic } from './files'
import { makeImageTake, type ImageGenerator } from './images'
import { decodePng, encodePng, encodeTransparentPng } from './png'
import type { Serial } from './serial'

/** What one edit of a picture needs: the picture, the words, the model and where to keep its working file. */
export interface EditStep {
  root: string
  /** The working file the model's window is written to (relative to the root); removed after. */
  cropFile: string
  /** The picture to edit. */
  source: Pixels
  /** The marked area, or null when the whole picture may change. */
  area: PatchArea | null
  words: string
  model: EditModelId
  seed: number
}

/**
 * Edits a picture with an edit model and returns what the edit changed: with a marked area a
 * window round it is edited and only what changed there is kept (transparent elsewhere, as a
 * patch's); with none the whole edited picture. Null when `signal` stopped it. `onStart` is called
 * when the model starts (its wait for the GPU is over).
 */
export async function editStep(
  deps: { generator: ImageGenerator; queue: Serial; free: () => void | Promise<void> },
  step: EditStep,
  signal: AbortSignal,
  onStart: () => void,
): Promise<{ png: Uint8Array; seed: number } | null> {
  const { source, area } = step
  const window = area
    ? editWindow(area, source)
    : { x: 0, y: 0, width: source.width, height: source.height }
  try {
    const made = await makeImageTake(
      deps,
      {
        prompt: step.words,
        width: window.width,
        height: window.height,
        seed: step.seed,
        model: step.model,
        editing: resolveInRoot(step.root, step.cropFile),
      },
      signal,
      onStart,
      // The model gets the marked area with some context, not the whole picture: faster, and the
      // thing to change is larger in its view. Written in its turn, so the edit takes its place
      // in line with no await of its own: a caller that asks in order (the fine-tunes) is made in order.
      () => writeAtomic(step.root, step.cropFile, encodePng(cropPixels(source, window))),
    )
    if (signal.aborted) return null
    const part = decodePng(made.png)
    if (part.width !== window.width || part.height !== window.height) {
      throw new Error(
        `The edited picture came back at ${part.width} × ${part.height} instead of ${window.width} × ${window.height}.`,
      )
    }
    if (!area) return { png: encodePng(part), seed: made.seed }
    // The colours are matched in the window, where the model's drift is all there is to see:
    // laid into the whole take, everything outside the window would read as no drift at all.
    // Then the drift round the mark is taken away too, and what the edit changed is kept, an
    // object it grew past the mark whole.
    const inside = { ...area, x: area.x - window.x, y: area.y - window.y }
    const original = cropPixels(source, window)
    const kept = keepChanged(
      matchOutside(matchToTake(part, original, inside), original, inside),
      original,
      inside,
      openSides(window, source),
    )
    const blank = {
      width: source.width,
      height: source.height,
      data: new Uint8Array(source.width * source.height * 4),
    }
    return { png: encodeTransparentPng(pastePixels(blank, kept, window)), seed: made.seed }
  } finally {
    await rm(resolveInRoot(step.root, step.cropFile), { force: true })
  }
}
