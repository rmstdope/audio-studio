/**
 * The process groups the studio started on this computer (the game's refresh commands, the local
 * music, image, sound-effect and Whisper workers), stopped with everything they started when the
 * studio exits or is interrupted. Each runs in its own process group, so that stopping it stops its
 * children too (`uv run` leaves python running otherwise), and so it does not get the terminal's
 * Ctrl-C: the studio stops it itself.
 *
 * Kept on `globalThis`, as `--dev` reruns the modules: one set and one set of handlers for the
 * process.
 */
const studio = globalThis as { contentStudioGroups?: { running: Set<number>; watched: boolean } }
studio.contentStudioGroups ??= { running: new Set(), watched: false }
const state = studio.contentStudioGroups

/**
 * Notes a process started with `detached: true` (the leader of its own group) as the studio's, to
 * be stopped with the studio; gives what to call once it has ended.
 */
export function stopWithStudio(pid: number): () => void {
  watch()
  state.running.add(pid)
  return () => state.running.delete(pid)
}

/** Sends `signal` to the process group `pid` leads: the process and everything it started. */
export function killGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}

/** Stops every process group the studio started that is still running. */
export function stopAll(): void {
  for (const pid of state.running) killGroup(pid)
}

/** Makes sure the groups are stopped when the studio exits or is interrupted. */
function watch(): void {
  if (state.watched) return
  state.watched = true
  process.once('exit', stopAll)
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      stopAll()
      process.exit(code)
    })
  }
}
