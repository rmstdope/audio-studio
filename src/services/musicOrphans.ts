import { rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { orphanOf } from '../core/music'
import { resolveInRoot } from '../core/paths'
import { pythonJson } from '../core/pyjson'
import type { Problem } from '../core/project'
import { formatEntriesPerLine, writeAtomic } from './files'
import { forgetBriefs } from './briefs'
import { choices, lockNow, manifestNow, sorted, type CommitResult } from './musicClips'
import { readMusic } from './musicLists'
import { boardQueue, deleteBoard, isSafeId } from './musicTakes'
import { openProject } from './workspace'

/** What removing an orphan answered; null for a track that is not one. */
export type RemoveResult = CommitResult | null

/**
 * Removes the music of a track the game no longer asks for: its manifest entry, its music file,
 * its board and takes and its brief changes, and its lock entry last. Every step can be done
 * again, and the lock entry is what keeps the track shown on its page, so a removal that fails
 * part-way can be pressed again. Null when the track is not an orphan (it is listed, was never
 * chosen, or the list its take came from is missing). A manifest or lock that cannot be read adds
 * its problems and deletes nothing. The caller has asked the user.
 */
export async function removeOrphan(projectFile: string, id: string): Promise<RemoveResult> {
  if (!isSafeId(id)) return null
  // The track's board turn first, then the project's choice turn: the order Choose takes.
  return boardQueue().run(`${projectFile}\0${id}`, async (): Promise<RemoveResult> => {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    const music = project.music
    if (!music) return null
    return choices().run(`music-choice\0${projectFile}`, async (): Promise<RemoveResult> => {
      const summary = await readMusic(root, project, [])
      if (!summary || !orphanOf(summary.lists, id)) return null
      const found: Problem[] = []
      const manifest = await manifestNow(root, music, found)
      const lock = await lockNow(root, music, found)
      if (!manifest || !lock) return { ok: false, file: found[0]!.file, problems: found }
      try {
        if (id in manifest) {
          delete manifest[id]
          await writeAtomic(root, music.paths.manifest, `${pythonJson(sorted(manifest))}\n`)
        }
        await rm(resolveInRoot(root, `${music.paths.clips}/${id}.mp3`), { force: true })
        await deleteBoard(root, id)
        const briefs = await forgetBriefs(projectFile, root, music.paths.briefs, [id])
        if (!briefs.ok) return { ok: false, file: music.paths.briefs, problems: briefs.problems }
        delete lock[id]
        await writeAtomic(root, music.paths.lock, formatEntriesPerLine(lock))
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    })
  })
}
