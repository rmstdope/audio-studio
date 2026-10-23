import { dirname } from 'node:path'
import { dialogDiff, type DialogDiff } from '../core/dialogDiff'
import { partPathFor, type Problem } from '../core/project'
import { DialogSchema, type Line } from '../core/resources'
import { readResource } from './files'
import { createSerial } from './serial'
import { openProject, type ProjectFailure } from './workspace'

/** What refreshing a part's dialog did, or why it did not. Null for an unknown part. */
export type RefreshResult =
  | { ok: true; lines: number; diff: DialogDiff; output: string }
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
export function refreshDialog(projectFile: string, partId: string): Promise<RefreshResult> {
  return refreshes.run(`${projectFile}\n${partId}`, () => refresh(projectFile, partId))
}

async function refresh(projectFile: string, partId: string): Promise<RefreshResult> {
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
  const run = await shell(command, root)
  if (!run.ok) {
    return { ok: false, reason: 'failed', message: run.message, output: run.output }
  }

  const problems: Problem[] = []
  const read = await readResource(root, dialogPath, DialogSchema, problems)
  if (read === 'missing') {
    problems.push({ file: dialogPath, path: '', message: 'the command wrote no dialog file' })
  }
  if (read === 'missing' || read === 'invalid') return { ok: false, problems, output: run.output }
  return { ok: true, lines: read.length, diff: dialogDiff(before, read), output: run.output }
}

/** The dialog's lines as they are now; none if there is no usable file yet. */
async function readLines(root: string, path: string): Promise<Line[]> {
  const read = await readResource(root, path, DialogSchema, [])
  return read === 'missing' || read === 'invalid' ? [] : read
}

/** Runs a command with the shell in `cwd`: whether it worked, and the end of what it said. */
async function shell(
  command: string,
  cwd: string,
): Promise<{ ok: true; output: string } | { ok: false; message: string; output: string }> {
  const child = Bun.spawn(['sh', '-c', command], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const output = [out.trim(), err.trim()].filter(Boolean).join('\n').slice(-OUTPUT_LIMIT)
  if (code === 0) return { ok: true, output }
  const message =
    child.signalCode === 'SIGKILL'
      ? `The command took longer than ${TIMEOUT_MS / 60_000} minutes and was stopped.`
      : `The command failed (exit code ${code}).`
  return { ok: false, message, output }
}
