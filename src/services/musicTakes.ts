import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  MUSIC_MODEL,
  generatedSeconds,
  peaks,
  shapeTake,
  wavSeconds,
  type FailedView,
  type MakingView,
  type MusicTakesView,
  type TakeView,
} from '../core/musicTake'
import { trackFor, type TrackRow } from '../core/music'
import { readWav } from '../core/wav'
import { writeAtomic } from './files'
import { gpuQueue, GPU } from './gpu'
import type { MusicGenerator } from './music'
import { readMusic } from './musicLists'
import type { Serial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** Where a project's music takes are cached, one folder per track. */
export const MUSIC_TAKES_DIR = '.audio-studio/music-takes'

/** About how long a take takes, in seconds (§13 decision 5: 2 to 4 minutes), for the progress shown. */
export const EXPECTED_TAKE_SECONDS = 180

/** How many bars a take's waveform has. */
const WAVEFORM_BARS = 120

/** A take's file name: the hash of its inputs, its number, `.wav`. */
const TAKE_FILE = /^([0-9a-f]{16})\.(\d+)\.wav$/

/** What to make: this many new takes, or the failed take with this number again. */
export type MakeRequest = { count: number } | { retry: number }

/** What asking for takes answered; null for a track the project does not list. */
export type MakeResult = { ok: true } | { ok: false; message: string } | ProjectFailure | null

/** A track's takes as the page shows them, a project failure, or null for an unknown track. */
export type TakesResult = MusicTakesView | ProjectFailure | null

/** What a track's inputs are for the takes: the brief in force, with the kind. */
interface Inputs {
  brief: string
  kind: 'loop' | 'stinger'
  seconds: number
  bpm: number | null
  key: string | null
}

/** A take being made or waiting, or one that failed, until it is made. */
interface Entry {
  n: number
  state: 'waiting' | 'making' | 'failed'
  startedAt: number
  message: string
  /** The hash of the inputs it is made for; the page shows only the current inputs'. */
  hash: string
}

/** A hash of what went into a take: the model and the track's inputs. */
export function musicTakeHash(inputs: Inputs): string {
  const { brief, kind, seconds, bpm, key } = inputs
  return createHash('sha256')
    .update(JSON.stringify([MUSIC_MODEL, brief, kind, seconds, bpm, key]))
    .digest('hex')
    .slice(0, 16)
}

/** A failure as a sentence for the page. */
function describeFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const prefix = 'The music generator: '
  const sentence = text.startsWith(prefix)
    ? `The music generator stopped: ${text.slice(prefix.length)}`
    : text
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`
}

/** What the takes of a track are made of. */
export interface MusicTakes {
  /** The track's takes of its current inputs, and those being made. */
  view(projectFile: string, id: string): Promise<TakesResult>
  /** Queues takes on the GPU queue and returns at once; they are made one at a time. */
  make(projectFile: string, id: string, request: MakeRequest): Promise<MakeResult>
  /** The path of a take's WAV, or null for a track not listed or a name that is not a take's. */
  takeFile(projectFile: string, id: string, name: string): Promise<string | null>
}

/**
 * The takes of the game's music: made by `generator` on the GPU `queue` (shared with Whisper),
 * shaped to what the game would play, and cached in `.audio-studio/music-takes/<track>/` as
 * `<hash>.<n>.wav` with its seed and waveform in `<hash>.<n>.json`. Takes waiting, being made and
 * failed are kept in memory, per track, for the page to poll (they survive a `--dev` reload, not a
 * restart); a take made is a file.
 */
export function createMusicTakes({
  generator,
  queue = gpuQueue(),
  now = Date.now,
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
}: {
  generator: MusicGenerator
  queue?: Serial
  now?: () => number
  newSeed?: () => number
}): MusicTakes {
  // On `globalThis` like the GPU queue the jobs run on, so a `--dev` reload keeps what is being made.
  const shared = globalThis as { audioStudioMakingTakes?: Map<string, Map<number, Entry>> }
  const active = (shared.audioStudioMakingTakes ??= new Map())

  async function resolve(projectFile: string, id: string) {
    const opened = await openProject(projectFile)
    if (!opened.ok) return opened
    const { project } = opened
    const root = dirname(projectFile)
    if (!project.music) return null
    const found = trackFor((await readMusic(root, project, []))?.lists ?? [], id)
    if (!found) return null
    const row: TrackRow = found.track
    const kind: Inputs['kind'] = found.list.kind === 'stingers' ? 'stinger' : 'loop'
    const inputs: Inputs = {
      brief: row.brief,
      kind,
      seconds: row.seconds,
      bpm: row.bpm,
      key: row.key,
    }
    return { root, inputs, hash: musicTakeHash(inputs), folder: `${MUSIC_TAKES_DIR}/${id}` }
  }

  /** The numbers of the takes cached for these inputs. */
  async function made(root: string, folder: string, hash: string): Promise<number[]> {
    const names = await readdir(join(root, folder)).catch(() => [] as string[])
    return names.flatMap((name) => {
      const match = TAKE_FILE.exec(name)
      return match && match[1] === hash ? [Number(match[2])] : []
    })
  }

  async function run(
    root: string,
    folder: string,
    entry: Entry,
    inputs: Inputs,
    waiting: Map<number, Entry>,
  ): Promise<void> {
    entry.state = 'making'
    entry.startedAt = now()
    try {
      const seed = newSeed()
      const take = await generator.generate({
        brief: inputs.brief,
        kind: inputs.kind,
        seconds: generatedSeconds(inputs.kind, inputs.seconds),
        bpm: inputs.bpm,
        key: inputs.key,
        seed,
      })
      const shaped = shapeTake(take.wav, inputs.kind, inputs.seconds)
      const wav = readWav(shaped)
      const base = `${folder}/${entry.hash}.${entry.n}`
      // The details first: a take exists once its WAV does.
      await writeAtomic(
        root,
        `${base}.json`,
        `${JSON.stringify({ seed: take.seed, seconds: wavSeconds(wav), peaks: peaks(wav, WAVEFORM_BARS) })}\n`,
      )
      await writeAtomic(root, `${base}.wav`, shaped)
      waiting.delete(entry.n)
    } catch (error) {
      entry.state = 'failed'
      entry.message = describeFailure(error)
    }
  }

  return {
    async view(projectFile, id) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const { root, inputs, hash, folder } = found
      // The entries first: one is dropped only after its files are written, so a take is then
      // in the list read after, never in neither.
      const entries = [...(active.get(`${projectFile}\0${id}`)?.values() ?? [])]
        .filter((entry) => entry.hash === hash)
        .sort((a, b) => a.n - b.n)
      const takes: TakeView[] = []
      for (const n of (await made(root, folder, hash)).sort((a, b) => a - b)) {
        const base = `${hash}.${n}`
        try {
          const details = JSON.parse(await readFile(join(root, folder, `${base}.json`), 'utf8'))
          takes.push({
            n,
            file: `${base}.wav`,
            seconds: details.seconds,
            seed: details.seed,
            peaks: details.peaks,
          })
        } catch {
          // A take without readable details is not shown; the files stay for a person to see.
        }
      }
      const making: MakingView[] = entries
        .filter((entry) => entry.state !== 'failed' && !takes.some((take) => take.n === entry.n))
        .map((entry) => ({
          n: entry.n,
          state: entry.state as 'waiting' | 'making',
          elapsed: entry.state === 'making' ? Math.max(0, (now() - entry.startedAt) / 1000) : 0,
        }))
      const failed: FailedView[] = entries
        .filter((entry) => entry.state === 'failed')
        .map((entry) => ({ n: entry.n, message: entry.message }))
      return {
        ok: true,
        kind: inputs.kind,
        generator: generator.ready(),
        expected: EXPECTED_TAKE_SECONDS,
        takes,
        making,
        failed,
      }
    },

    async make(projectFile, id, request) {
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return found
      const ready = generator.ready()
      if (!ready.ok) return { ok: false, message: ready.message }
      const { root, inputs, hash, folder } = found
      const key = `${projectFile}\0${id}`
      const entries = active.get(key) ?? new Map<number, Entry>()
      active.set(key, entries)
      const queued: Entry[] = []
      if ('retry' in request) {
        const failed = entries.get(request.retry)
        if (!failed || failed.state !== 'failed' || failed.hash !== hash) {
          return {
            ok: false,
            message: `Take ${request.retry} did not fail, so it is not made again.`,
          }
        }
        failed.state = 'waiting'
        queued.push(failed)
      } else {
        let next = Math.max(
          0,
          ...(await made(root, folder, hash)),
          ...[...entries.values()].filter((e) => e.hash === hash).map((e) => e.n),
        )
        for (let i = 0; i < request.count; i++) {
          const entry: Entry = { n: ++next, state: 'waiting', startedAt: 0, message: '', hash }
          entries.set(entry.n, entry)
          queued.push(entry)
        }
      }
      for (const entry of queued) {
        void queue.run(GPU, () => run(root, folder, entry, inputs, entries))
      }
      return { ok: true }
    },

    async takeFile(projectFile, id, name) {
      if (!TAKE_FILE.test(name)) return null
      const found = await resolve(projectFile, id)
      if (!found || !('inputs' in found)) return null
      const file = join(found.root, found.folder, name)
      return (await Bun.file(file).exists()) ? file : null
    },
  }
}
