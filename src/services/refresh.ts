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
  | { ok: false; reason: 'none'; message: string }
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
  return refreshes.run(`${projectFile}\n${partId}`, () => refresh(projectFile, partId, timeoutMs))
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

/**
 * Runs a command with the shell in `cwd`, in its own process group so that a timeout stops
 * everything it started (the game's `npx` and `node` too, which would otherwise keep the output
 * open): whether it worked, and the end of what it said.
 */
async function shell(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ ok: true; output: string } | { ok: false; message: string; output: string }> {
  const child = Bun.spawn(['sh', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    detached: true,
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }, timeoutMs)
  const [out, err, code] = await Promise.all([
    tail(child.stdout),
    tail(child.stderr),
    child.exited,
  ]).finally(() => clearTimeout(timer))
  const output = [out.trim(), err.trim()].filter(Boolean).join('\n').slice(-OUTPUT_LIMIT)
  if (code === 0 && !timedOut) return { ok: true, output }
  const message = timedOut
    ? `The command took longer than ${minutes(timeoutMs)} and was stopped.`
    : child.signalCode
      ? `The command was stopped by ${child.signalCode}.`
      : `The command failed (exit code ${code}).`
  return { ok: false, message, output }
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
