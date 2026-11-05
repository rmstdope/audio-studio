import { dirname } from 'node:path'
import {
  movedEntry,
  SceneLockSchema,
  type SceneKept,
  type SceneLock,
  type SceneMeasure,
} from '../core/sceneLoudness'
import { sameMix } from '../core/sceneEdit'
import { scenesLockFile, type Problem } from '../core/project'
import type { SceneMix } from '../core/scenes'
import { formatEntriesPerLine, readResource, writeAtomic } from './files'
import { createSerial } from './serial'

/**
 * The kept measures of a part's scenes, scene by scene, from its lock. A lock that is not there is
 * an empty one. One that cannot be read is reported and read as empty, and never written over
 * (`keepMeasure` refuses).
 */
export async function readMeasures(
  root: string,
  part: string,
  problems: Problem[],
): Promise<SceneLock> {
  const read = await readResource(root, scenesLockFile(part), SceneLockSchema, problems)
  return read === 'missing' || read === 'invalid' ? {} : read
}

/** Whether a part's lock is there but cannot be read: it is reported and never written over. */
export async function measuresBroken(root: string, part: string): Promise<boolean> {
  const problems: Problem[] = []
  await readResource(root, scenesLockFile(part), SceneLockSchema, problems)
  return problems.length > 0
}

/** One change at a time per project: each reads the file the one before wrote. */
const writes = createSerial()

/** Reads a part's lock, lets `change` edit it, and writes it back, one scene per line. */
function edit(projectFile: string, part: string, change: (lock: SceneLock) => void): Promise<void> {
  return writes.run(projectFile, async () => {
    const root = dirname(projectFile)
    const file = scenesLockFile(part)
    if (await measuresBroken(root, part)) {
      throw new Error(`${file} cannot be read; fix or delete it to keep loudness figures`)
    }
    const lock = await readMeasures(root, part, [])
    change(lock)
    await writeAtomic(root, file, formatEntriesPerLine(lock))
  })
}

/**
 * Keeps what measuring a scene found. The measure of the saved scene replaces the saved one and
 * drops a draft; the measure of the open scene with unsaved changes (`draft`) is kept beside the
 * saved one, so Discard can put the saved figures back.
 */
export function keepMeasure(
  projectFile: string,
  part: string,
  sceneId: string,
  measure: SceneMeasure,
  draft: boolean,
): Promise<void> {
  return edit(projectFile, part, (lock) => {
    const was: SceneKept = lock[sceneId] ?? { saved: null, draft: null }
    lock[sceneId] = draft ? { ...was, draft: measure } : { saved: measure, draft: null }
  })
}

/**
 * A scene was saved as `entry`: a draft measured from exactly that becomes the saved figures,
 * any other draft is dropped (it was measured from something that is no longer on the page).
 * `moved` says the page had pressed "Make … louder / quieter" on the measure made at `measuredAt`:
 * if that measure moved by `db` is exactly `entry`, it is kept as the saved figures with the move,
 * so they stay the expected ones until the act is measured again.
 * Writes nothing when the scene has no draft and no move.
 */
export async function sceneSaved(
  projectFile: string,
  part: string,
  sceneId: string,
  entry: SceneMix,
  moved?: { db: number; measuredAt: string },
): Promise<void> {
  const has = await readMeasures(dirname(projectFile), part, [])
  if (!has[sceneId]?.draft && !moved) return
  await edit(projectFile, part, (lock) => {
    const kept = lock[sceneId]
    if (!kept) return
    const base = moved
      ? [kept.draft, kept.saved].find(
          (m) =>
            m?.measuredAt === moved.measuredAt &&
            sameMix(movedEntry(m.entry, moved.db, entry), entry),
        )
      : undefined
    if (base) {
      lock[sceneId] = { saved: { ...base, moved: { db: moved!.db } }, draft: null }
      return
    }
    if (!kept.draft) return
    lock[sceneId] = {
      saved: sameMix(kept.draft.entry, entry) ? kept.draft : kept.saved,
      draft: null,
    }
  })
}
