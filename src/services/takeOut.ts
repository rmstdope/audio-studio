import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveInRoot } from '../core/paths'
import { refuseWrite, refusalSentence, writeOrRefuse } from './files'
import type { ProjectFailure } from './workspace'

/** What choosing a take answered: written, refused with a reason, or a lock or manifest that cannot be used. */
export type CommitResult =
  | { ok: true }
  /**
   * `reason` is the failure without the framing around it, when the framing is the module's;
   * `gameChanged` when part of the change reached the game's files and could not be put back.
   */
  | { ok: false; message: string; reason?: string; gameChanged?: true }
  | ProjectFailure

/**
 * What a choice, un-choice or accept that threw answers: a refused write names its file, anything
 * else gives its own message.
 */
export function commitFailure(error: unknown): CommitResult {
  const sentence = refusalSentence(error)
  if (sentence !== null) {
    // Kept in the server log: the person is told which file, the log says why.
    console.error('writing the game’s files failed', error)
    return { ok: false, message: `${sentence}.`, reason: sentence }
  }
  return { ok: false, message: error instanceof Error ? error.message : String(error) }
}

/**
 * Takes one chosen clip out of the game, in a choice turn that has read the manifest and lock: the
 * manifest entry (when `manifest` names the file holding it), then the clip, set aside under a
 * hidden name, then the file `last` (a lock, or a patch's board). A write that fails puts back what was already changed, so the
 * game's files and the lock still agree and "nothing was changed" is true; the clip is deleted only
 * once `last` is written. A clip already gone is no failure.
 */
export async function takeOut({
  root,
  clips,
  file,
  manifest,
  manifestNow,
  last,
  lastNow,
}: {
  root: string
  clips: string
  /** The clip's file name in `clips`: the game's own (`hall.mp3`, `inn.png`, `inn.door.png`). */
  file: string
  /** The manifest's path when it holds the entry; null to leave it alone. */
  manifest: string | null
  /** The manifest's text without the entry. */
  manifestNow: string
  /** The file written last, once the clip is out: the lock, or a patch's board. */
  last: string
  /** Its text without the entry. */
  lastNow: string
}): Promise<CommitResult> {
  const clip = join(clips, file)
  const aside = resolveInRoot(root, join(clips, `.${randomUUID()}.${file}`))
  const putBack: (() => Promise<unknown>)[] = []
  try {
    if (manifest) {
      const was = await Bun.file(resolveInRoot(root, manifest)).bytes()
      await writeOrRefuse(root, manifest, manifestNow)
      putBack.push(() => writeOrRefuse(root, manifest, was))
    }
    const moved = await rename(resolveInRoot(root, clip), aside).then(
      () => true,
      (error: unknown) => {
        if ((error as { code?: unknown }).code === 'ENOENT') return false
        return refuseWrite(clip)(error)
      },
    )
    if (moved) putBack.push(() => rename(aside, resolveInRoot(root, clip)))
    await writeOrRefuse(root, last, lastNow)
  } catch (error) {
    try {
      for (const step of putBack.reverse()) await step()
    } catch (stuck) {
      console.error('putting the game’s files back failed', stuck)
      const sentence =
        refusalSentence(error) ?? (error instanceof Error ? error.message : String(error))
      return {
        ok: false,
        message: `${sentence.replace(/\.$/, '')}, and the game’s files could not be put back.`,
        gameChanged: true,
      }
    }
    return commitFailure(error)
  }
  await rm(aside, { force: true }).catch(() => {})
  return { ok: true }
}
