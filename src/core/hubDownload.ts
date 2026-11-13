import type { ImageDownload } from './imageModels'

/**
 * What a model fetches from its repository besides the weights, by what the repository's listing
 * names: the files with these endings in a folder that holds weights (`vae/*.json`, …), and every
 * file under these folders. What the listing names beyond that, the model never fetches.
 */
export interface HubNeeds {
  /** Endings of the listed files a folder holding weights must also have. */
  besideWeights: readonly string[]
  /** Folders whose every listed file is fetched. */
  folders: readonly string[]
}

/** What mflux fetches: the `.json` files beside weights (not the weights at the top) and `tokenizer/**`. */
export const MFLUX_NEEDS: HubNeeds = {
  besideWeights: ['.safetensors', '.json'],
  folders: ['tokenizer'],
}

/** A model that needs only its weights, and what they name (the sound-effect model). */
export const WEIGHTS_ONLY_NEEDS: HubNeeds = { besideWeights: [], folders: [] }

/** What was read of a repository's folder in the Hugging Face cache; paths use `/` and are relative to the snapshot. */
export interface HubCacheView {
  /** The files that are there, links to a blob that is there followed; a link to none is `broken`. */
  files: readonly string[]
  /** A link in the snapshot points at a blob that is not there (a download stopped). */
  broken: boolean
  /** Each `*.safetensors.index.json`, with the shards it names, or none when it cannot be read. */
  shardIndexes: readonly { path: string; shards: readonly string[] | null }[]
  /** Each `model_index.json`, with the parts it lists as used, or none when it cannot be read. */
  modelIndexes: readonly { folder: string; parts: readonly string[] | null }[]
  /** The paths the repository's listing for the snapshot names; none with no listing or one unreadable. */
  listing?: readonly string[]
  /** A blob is unfinished: a `.incomplete` file whose finished blob is not there. */
  unfinishedBlob: boolean
}

const SHARD_FILE = /-\d+-of-\d+\.safetensors$/

const dirOf = (path: string): string =>
  path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
const join = (folder: string, name: string): string => (folder === '' ? name : `${folder}/${name}`)

/** The listed paths `needs` says the model fetches. */
function neededOf(listing: readonly string[], needs: HubNeeds): string[] {
  const weighted = new Set(
    listing
      .filter((p) => p.endsWith('.safetensors'))
      .map(dirOf)
      .filter((d) => d !== ''),
  )
  return listing.filter(
    (path) =>
      needs.folders.some((folder) => path.startsWith(`${folder}/`)) ||
      (weighted.has(dirOf(path)) && needs.besideWeights.some((ending) => path.endsWith(ending))),
  )
}

/** Whether a folder holds a `config.json` or shards but no shard index or single weights file yet. */
function foldersWaiting(files: readonly string[]): boolean {
  const byFolder = new Map<string, string[]>()
  for (const file of files) {
    const folder = dirOf(file)
    byFolder.set(folder, [
      ...(byFolder.get(folder) ?? []),
      file.slice(folder === '' ? 0 : folder.length + 1),
    ])
  }
  return [...byFolder.values()].some((names) => {
    const indexed = names.some((n) => n.endsWith('.safetensors.index.json'))
    const single = names.some((n) => n.endsWith('.safetensors') && !SHARD_FILE.test(n))
    return (
      (names.includes('config.json') || names.some((n) => SHARD_FILE.test(n))) &&
      !indexed &&
      !single
    )
  })
}

/**
 * How much of a model's download the cache `view` holds, against what the model needs: `absent`
 * with no view, `whole` when there are weights and every file that is required is there, and
 * `partial` otherwise. Required is: no link to a missing blob; every shard an index names; a folder
 * with a config or shards has its index or weights; every part a `model_index.json` lists has files;
 * every file the repository's listing names that `needs` takes; and no unfinished blob unless a shard
 * index vouches for the snapshot, for then it is a leftover.
 */
export function judgeHubDownload(view: HubCacheView | undefined, needs: HubNeeds): ImageDownload {
  if (!view) return 'absent'
  const present = new Set(view.files)
  const has = (prefix: string) => view.files.some((file) => file.startsWith(`${prefix}/`))
  const missing = [
    ...view.shardIndexes.flatMap(({ path, shards }) =>
      shards === null ? [path] : shards.filter((shard) => !present.has(join(dirOf(path), shard))),
    ),
    ...view.modelIndexes.flatMap(({ folder, parts }) =>
      parts === null ? [folder] : parts.filter((part) => !has(join(folder, part))),
    ),
    ...(view.listing ? neededOf(view.listing, needs).filter((path) => !present.has(path)) : []),
  ]
  const vouched = view.shardIndexes.length > 0
  const finished =
    view.files.some((file) => file.endsWith('.safetensors')) &&
    !view.broken &&
    missing.length === 0 &&
    !foldersWaiting(view.files) &&
    (vouched || !view.unfinishedBlob)
  return finished ? 'whole' : 'partial'
}
