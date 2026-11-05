import { dirname } from 'node:path'
import {
  LoudnessFileSchema,
  movedEntry,
  type LoudnessFile,
  type SceneKept,
  type SceneMeasure,
} from '../core/sceneLoudness'
import { sameMix } from '../core/sceneEdit'
import type { Problem } from '../core/project'
import type { SceneMix } from '../core/scenes'
import { readResource, writeAtomic } from './files'
import { createSerial } from './serial'
import { CACHE_DIR } from '../core/project'

/** Where the measures of the scenes are kept, in the studio's own folder of the consumer. */
export const LOUDNESS_FILE = `${CACHE_DIR}/scene-loudness.json`

/**
 * The kept measures, act by act and scene by scene. A file that is not there is an empty one. One
 * that cannot be read is reported and read as empty, and never written over (`keepMeasure` refuses).
 */
export async function readMeasures(root: string, problems: Problem[]): Promise<LoudnessFile> {
  const read = await readResource(root, LOUDNESS_FILE, LoudnessFileSchema, problems)
  return read === 'missing' || read === 'invalid' ? {} : read
}

/** Whether the kept file is there but cannot be read: it is reported and never written over. */
export async function measuresBroken(root: string): Promise<boolean> {
  const problems: Problem[] = []
  await readResource(root, LOUDNESS_FILE, LoudnessFileSchema, problems)
  return problems.length > 0
}

/** One change at a time per project: each reads the file the one before wrote. */
const writes = createSerial()

/** Reads the file, lets `change` edit it, and writes it back. */
function edit(projectFile: string, change: (file: LoudnessFile) => void): Promise<void> {
  return writes.run(projectFile, async () => {
    const root = dirname(projectFile)
    if (await measuresBroken(root)) {
      throw new Error(`${LOUDNESS_FILE} cannot be read; fix or delete it to keep loudness figures`)
    }
    const file = await readMeasures(root, [])
    change(file)
    await writeAtomic(root, LOUDNESS_FILE, `${JSON.stringify(file, null, 2)}\n`)
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
  return edit(projectFile, (file) => {
    const act = (file[part] ??= {})
    const was: SceneKept = act[sceneId] ?? { saved: null, draft: null }
    act[sceneId] = draft ? { ...was, draft: measure } : { saved: measure, draft: null }
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
  const has = await readMeasures(dirname(projectFile), [])
  if (!has[part]?.[sceneId]?.draft && !moved) return
  await edit(projectFile, (file) => {
    const kept = file[part]?.[sceneId]
    if (!kept) return
    const base = moved
      ? [kept.draft, kept.saved].find(
          (m) =>
            m?.measuredAt === moved.measuredAt &&
            sameMix(movedEntry(m.entry, moved.db, entry), entry),
        )
      : undefined
    if (base) {
      file[part]![sceneId] = { saved: { ...base, moved: { db: moved!.db } }, draft: null }
      return
    }
    if (!kept.draft) return
    file[part]![sceneId] = {
      saved: sameMix(kept.draft.entry, entry) ? kept.draft : kept.saved,
      draft: null,
    }
  })
}
