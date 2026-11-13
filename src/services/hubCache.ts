import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { judgeHubDownload, type HubCacheView, type HubNeeds } from '../core/hubDownload'
import type { ImageDownload } from '../core/imageModels'

/** Where Hugging Face keeps its downloads, where mflux finds and puts the models' weights. */
export function hubDirOf(env: Record<string, string | undefined>, home: string): string {
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE
  if (env.HF_HOME) return join(env.HF_HOME, 'hub')
  return join(home, '.cache', 'huggingface', 'hub')
}

/** Where the Hugging Face downloads are on this computer. */
export const HUB_DIR = hubDirOf(process.env, homedir())

/** The JSON of a file, or `undefined` when it cannot be read or parsed. */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * The revision to judge a download by: the one `refs/main` names, or none when there is no ref, and
 * then every snapshot is judged. A part waiting in an older snapshot a finished retry left behind says
 * nothing, and a retry that stopped is unfinished even beside a whole older revision.
 */
function currentRevision(folder: string): string | undefined {
  try {
    return readFileSync(join(folder, 'refs', 'main'), 'utf8').trim()
  } catch {
    return undefined
  }
}

/** Whether `blobs` holds a `.incomplete` file (`<blob>.incomplete` or `<blob>.<random>.incomplete`) whose `<blob>` is not there. */
function hasUnfinishedBlob(blobs: string): boolean {
  try {
    return readdirSync(blobs).some(
      (name) => name.endsWith('.incomplete') && !existsSync(join(blobs, name.split('.')[0]!)),
    )
  } catch {
    return false
  }
}

/** The parts a `model_index.json` lists as used: `[library, class]` entries, not `[null, null]` or settings. */
function partsOf(index: unknown): string[] | null {
  if (typeof index !== 'object' || index === null) return null
  return Object.entries(index).flatMap(([key, value]) =>
    !key.startsWith('_') && Array.isArray(value) && value[0] !== null ? [key] : [],
  )
}

/** The shards a shard index names. */
function shardsOf(index: unknown): string[] | null {
  if (typeof index !== 'object' || index === null) return null
  const map = (index as { weight_map?: Record<string, string> }).weight_map
  return [...new Set(Object.values(map ?? {}))]
}

/**
 * Reads what the cache `hubDir` holds of `repo`: `undefined` with no folder for it, else the files of
 * its current snapshot (every snapshot with no `refs/main`), with the indexes, the repository's listing
 * and whether a blob is unfinished. Everything unreadable counts as nothing there.
 */
export function readHubCache(hubDir: string, repo: string): HubCacheView | undefined {
  const folder = join(hubDir, `models--${repo.replace('/', '--')}`)
  if (!existsSync(folder)) return undefined
  const revision = currentRevision(folder)
  const view: {
    files: string[]
    broken: boolean
    shardIndexes: { path: string; shards: string[] | null }[]
    modelIndexes: { folder: string; parts: string[] | null }[]
  } = { files: [], broken: false, shardIndexes: [], modelIndexes: [] }
  const root = join(folder, 'snapshots', revision ?? '')
  const visit = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const relative = prefix === '' ? name : `${prefix}/${name}`
      // A link to a blob that is not there (a download stopped) cannot be followed.
      if (!existsSync(path)) {
        if (lstatSync(path).isSymbolicLink()) view.broken = true
        continue
      }
      if (statSync(path).isDirectory()) visit(path, relative)
      else {
        view.files.push(relative)
        if (name.endsWith('.safetensors.index.json'))
          view.shardIndexes.push({ path: relative, shards: shardsOf(readJson(path)) })
        else if (name === 'model_index.json')
          view.modelIndexes.push({ folder: prefix, parts: partsOf(readJson(path)) })
      }
    }
  }
  try {
    visit(root, '')
  } catch {
    // Unreadable counts as having nothing.
  }
  const listed =
    revision === undefined
      ? undefined
      : (readJson(join(folder, 'trees', `${revision}.json`)) as { files?: Record<string, unknown> })
  return {
    ...view,
    listing: listed ? Object.keys(listed.files ?? {}) : undefined,
    unfinishedBlob: hasUnfinishedBlob(join(folder, 'blobs')),
  } satisfies HubCacheView
}

/** How much of a repository's download is in the Hugging Face cache `hubDir`, judged against what the model `needs`. */
export function hubDownload(hubDir: string, repo: string, needs: HubNeeds): ImageDownload {
  return judgeHubDownload(readHubCache(hubDir, repo), needs)
}
