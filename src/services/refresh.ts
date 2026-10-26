import { dirname } from 'node:path'
import { dialogDiff, type DialogDiff } from '../core/dialogDiff'
import {
  loopsDiff,
  LoopListSchema,
  StingerListSchema,
  type Track,
  type TrackRef,
} from '../core/music'
import { partPathFor, type Problem } from '../core/project'
import { DialogSchema, type Line } from '../core/resources'
import { readResource } from './files'
import { readList } from './musicLists'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What refreshing a part's dialog did, or why it did not. Null for an unknown part. */
export type RefreshResult =
  /**
   * `diff` is null when the dialog could not be read before, so what changed is not known. `loops`
   * is the act's loops added and removed when the project has a `music` section and the command
   * left a loops list that can be read; else null.
   */
  | {
      ok: true
      lines: number
      diff: DialogDiff | null
      loops: (LoopsChange & { total: number }) | null
      output: string
    }
  | { ok: false; reason: 'none' | 'busy'; message: string }
  | { ok: false; reason: 'failed'; message: string; output: string }
  | { ok: false; problems: Problem[]; output: string }
  | ProjectFailure
  | null

/** The tracks a refresh added to a list the game writes and removed from it. */
export interface LoopsChange {
  added: TrackRef[]
  removed: TrackRef[]
}

/** What refreshing the stingers did, or why it did not. */
export type RefreshSharedResult =
  | { ok: true; stingers: number; change: LoopsChange | null; output: string }
  | { ok: false; reason: 'none'; message: string }
  | { ok: false; reason: 'failed'; message: string; output: string }
  | { ok: false; problems: Problem[]; output: string }
  | ProjectFailure

/** How long a refresh may run before it is stopped. */
const TIMEOUT_MS = 10 * 60_000

/** How much of the command's output is kept: its end, where the errors are. */
const OUTPUT_LIMIT = 4000

/** One refresh per part at a time: a second click waits for the first instead of racing it. */
const refreshes = createSerial()

/**
 * Runs the project's `refreshDialog` command for a part (with `{part}` replaced by its id) in the
 * project root, the way the game extracts its dialog, then reads the dialog again and says what
 * changed. The command is the project's own (its project file), run only from the studio's page.
 */
export function refreshDialog(
  projectFile: string,
  partId: string,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<RefreshResult> {
  const key = partKey(projectFile, partId)
  // Counted from the click, so a generation is refused while one waits in line too.
  active.set(key, (active.get(key) ?? 0) + 1)
  return refreshes
    .run(key, () => refresh(projectFile, partId, timeoutMs))
    .finally(() => {
      const left = (active.get(key) ?? 1) - 1
      if (left) active.set(key, left)
      else active.delete(key)
    })
}

/** The key of the stingers' refresh: no part id holds a NUL, so it cannot be a part's. */
function sharedKey(projectFile: string): string {
  return `${projectFile}\0shared`
}

/**
 * Runs the project's `music.refreshShared` command in the project root, the way the game lists
 * what belongs to no act (the stingers), then reads the list again and says what changed. Only
 * from the studio's page, one at a time.
 */
export function refreshShared(
  projectFile: string,
  { timeoutMs = TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<RefreshSharedResult> {
  const key = sharedKey(projectFile)
  active.set(key, (active.get(key) ?? 0) + 1)
  return refreshes
    .run(key, () => refreshStingers(projectFile, timeoutMs))
    .finally(() => {
      const left = (active.get(key) ?? 1) - 1
      if (left) active.set(key, left)
      else active.delete(key)
    })
}

/** Refreshes asked for and not finished, per part: a generation waits for none of them. */
const active = new Map<string, number>()

function partKey(projectFile: string, partId: string): string {
  return `${projectFile}\n${partId}`
}

/** Whether a refresh of the part is running or waiting to run. */
export function isRefreshing(projectFile: string, partId: string): boolean {
  return active.has(partKey(projectFile, partId))
}

/**
 * The process groups of the commands running now, so they can be stopped with the studio, and
 * whether the studio's exit is watched. Kept on `globalThis`, as `--dev` reruns this module: one
 * set and one set of handlers for the process.
 */
const studio = globalThis as { audioStudioRefreshes?: { running: Set<number>; watched: boolean } }
studio.audioStudioRefreshes ??= { running: new Set(), watched: false }
const { running } = studio.audioStudioRefreshes

/**
 * Stops every refresh command running now, with everything it started. The commands run in their
 * own process group, so they would not get the terminal's Ctrl-C: the studio stops them itself
 * when it exits.
 */
export function stopRefreshes(): void {
  for (const pid of studio.audioStudioRefreshes!.running) killGroup(pid)
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

/** Makes sure the running commands are stopped when the studio exits or is interrupted. */
function stopWithStudio(): void {
  const state = studio.audioStudioRefreshes!
  if (state.watched) return
  state.watched = true
  process.once('exit', stopRefreshes)
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      stopRefreshes()
      process.exit(code)
    })
  }
}

async function refresh(
  projectFile: string,
  partId: string,
  timeoutMs: number,
): Promise<RefreshResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { narration } = opened.project
  const part = narration.parts.find((p) => p.id === partId)
  if (!part) return null
  if (!narration.refreshDialog) {
    return {
      ok: false,
      reason: 'none',
      message: 'The project file names no refreshDialog command.',
    }
  }
  const root = dirname(projectFile)
  const dialogPath = partPathFor(narration.paths.dialog, part.id, narration.languages[0])
  const before = await readLines(root, dialogPath)
  const loopsFile = opened.project.music
    ? partPathFor(opened.project.music.paths.loops, part.id)
    : null
  const loopsBefore = loopsFile ? await readTracks(root, loopsFile, LoopListSchema) : 'invalid'

  const command = partPathFor(narration.refreshDialog, part.id)
  const run = await shell(command, root, timeoutMs)
  if (!run.ok) {
    return { ok: false, reason: 'failed', message: run.message, output: run.output }
  }

  const problems: Problem[] = []
  const read = await readResource(root, dialogPath, DialogSchema, problems)
  if (read === 'missing') {
    problems.push({ file: dialogPath, path: '', message: 'the command wrote no dialog file' })
  }
  if (read === 'missing' || read === 'invalid') return { ok: false, problems, output: run.output }
  const diff = before === 'invalid' ? null : dialogDiff(before, read)
  const loopsAfter = loopsFile ? await readTracks(root, loopsFile, LoopListSchema) : 'invalid'
  // What the loops were is unknown when the old list was broken, and there is none to compare when
  // the command wrote none: say nothing then.
  const loops =
    loopsBefore === 'invalid' || loopsAfter === 'invalid' || !loopsAfter.found
      ? null
      : {
          ...loopsDiff(loopsBefore.tracks, loopsAfter.tracks),
          total: loopsAfter.tracks.length,
        }
  return { ok: true, lines: read.length, diff, loops, output: run.output }
}

async function refreshStingers(
  projectFile: string,
  timeoutMs: number,
): Promise<RefreshSharedResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { music } = opened.project
  if (!music?.refreshShared) {
    return {
      ok: false,
      reason: 'none',
      message: 'The project file names no music.refreshShared command.',
    }
  }
  const root = dirname(projectFile)
  const before = await readTracks(root, music.paths.stingers, StingerListSchema)
  const run = await shell(music.refreshShared, root, timeoutMs)
  if (!run.ok) return { ok: false, reason: 'failed', message: run.message, output: run.output }

  const problems: Problem[] = []
  const read = await readResource(root, music.paths.stingers, StingerListSchema, problems)
  if (read === 'missing') {
    problems.push({
      file: music.paths.stingers,
      path: '',
      message: 'the command wrote no stingers file',
    })
  }
  if (read === 'missing' || read === 'invalid') return { ok: false, problems, output: run.output }
  const change = before === 'invalid' ? null : loopsDiff(before.tracks, read)
  return { ok: true, stingers: read.length, change, output: run.output }
}

/** A track list as it is now: none if there is no file yet (`found` false), 'invalid' if broken. */
async function readTracks(
  root: string,
  path: string,
  schema: typeof LoopListSchema | typeof StingerListSchema,
): Promise<{ tracks: Track[]; found: boolean } | 'invalid'> {
  const state = await readList(root, path, schema, [])
  return state.status === 'invalid'
    ? 'invalid'
    : { tracks: state.status === 'ok' ? state.tracks : [], found: state.status === 'ok' }
}

/** The dialog's lines as they are now: none if there is no file yet, 'invalid' if it is broken. */
async function readLines(root: string, path: string): Promise<Line[] | 'invalid'> {
  const read = await readResource(root, path, DialogSchema, [])
  return read === 'missing' ? [] : read
}

/** How long the output may stay open after the command itself has ended (a background helper). */
const GRACE_MS = 1500

/**
 * Runs a command with the shell in `cwd`, in its own process group so that a timeout stops
 * everything it started (the game's `npx` and `node` too, which would otherwise keep the output
 * open): whether it worked, and the end of what it said. It is judged by the shell's exit: what it
 * leaves running in the background is stopped, after a moment to finish its output if it holds
 * it.
 */
async function shell(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: true; output: string } | { ok: false; message: string; output: string }> {
  stopWithStudio()
  const child = Bun.spawn(['sh', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  })
  running.add(child.pid)
  let timedOut = false
  let ended = false
  let grace: ReturnType<typeof setTimeout> | undefined
  const timer = setTimeout(() => {
    if (ended) return
    timedOut = true
    killGroup(child.pid)
  }, timeoutMs)
  const exit = child.exited.then((code) => {
    ended = true
    clearTimeout(timer)
    grace = setTimeout(() => killGroup(child.pid), GRACE_MS)
    grace.unref()
    return code
  })
  try {
    const [out, err, code] = await Promise.all([tail(child.stdout), tail(child.stderr), exit])
    const output = [out.trim(), err.trim()].filter(Boolean).join('\n').slice(-OUTPUT_LIMIT)
    if (code === 0 && !timedOut) return { ok: true, output }
    const message = timedOut
      ? `The command took longer than ${minutes(timeoutMs)} and was stopped.`
      : child.signalCode
        ? `The command was stopped by ${child.signalCode}.`
        : `The command failed (exit code ${code}).`
    return { ok: false, message, output }
  } finally {
    clearTimeout(timer)
    clearTimeout(grace)
    // Whatever happened (a stream error too), nothing of it is left running.
    killGroup(child.pid)
    running.delete(child.pid)
  }
}

/** The end of a stream's text, at most OUTPUT_LIMIT characters, however much it says. */
async function tail(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let kept = ''
  for await (const chunk of stream) {
    kept = (kept + decoder.decode(chunk, { stream: true })).slice(-OUTPUT_LIMIT)
  }
  return (kept + decoder.decode()).slice(-OUTPUT_LIMIT)
}

/** A duration as the message says it: minutes, or seconds when short. */
function minutes(ms: number): string {
  return ms >= 60_000 ? `${ms / 60_000} minutes` : `${ms / 1000} s`
}
