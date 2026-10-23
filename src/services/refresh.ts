import { dirname } from 'node:path'
import { dialogDiff, type DialogDiff } from '../core/dialogDiff'
import { partPathFor, type Problem } from '../core/project'
import { DialogSchema, type Line } from '../core/resources'
import { readResource } from './files'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What refreshing a part's dialog did, or why it did not. Null for an unknown part. */
export type RefreshResult =
  /** `diff` is null when the dialog could not be read before, so what changed is not known. */
  | { ok: true; lines: number; diff: DialogDiff | null; output: string }
  | { ok: false; reason: 'none' | 'busy'; message: string }
  | { ok: false; reason: 'failed'; message: string; output: string }
  | { ok: false; problems: Problem[]; output: string }
  | ProjectFailure
  | null

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

/** Refreshes asked for and not finished, per part: a generation waits for none of them. */
const active = new Map<string, number>()

function partKey(projectFile: string, partId: string): string {
  return `${projectFile}\n${partId}`
}

/** Whether a refresh of the part is running or waiting to run. */
export function isRefreshing(projectFile: string, partId: string): boolean {
  return active.has(partKey(projectFile, partId))
}

/** The process groups of the commands running now, so they can be stopped with the studio. */
const running = new Set<number>()

/**
 * Stops every refresh command running now, with everything it started. The commands run in their
 * own process group, so they would not get the terminal's Ctrl-C: the studio stops them itself
 * when it exits.
 */
export function stopRefreshes(): void {
  for (const pid of running) killGroup(pid)
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

let stopsWithStudio = false

/** Makes sure the running commands are stopped when the studio exits or is interrupted. */
function stopWithStudio(): void {
  if (stopsWithStudio) return
  stopsWithStudio = true
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
  const dialogPath = partPathFor(narration.paths.dialog, part.id)
  const before = await readLines(root, dialogPath)

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
  return { ok: true, lines: read.length, diff, output: run.output }
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
 * leaves running in the background gets a moment to finish its output, then is stopped.
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
  const timer = setTimeout(() => {
    if (ended) return
    timedOut = true
    killGroup(child.pid)
  }, timeoutMs)
  const exit = child.exited.then((code) => {
    ended = true
    clearTimeout(timer)
    setTimeout(() => killGroup(child.pid), GRACE_MS).unref()
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
