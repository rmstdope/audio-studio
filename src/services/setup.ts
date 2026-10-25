import { dirname } from 'node:path'
import { setupChecks, type SetupCheck, type SetupFacts } from '../core/setup'
import type { FishFactory } from './auditions'
import { fishApiKey } from './env'
import { NO_KEY } from './fish'
import { openProject, type ProjectFailure } from './workspace'

/** The setup as checked, or why the project file could not be read. */
export type SetupResult = { ok: true; checks: SetupCheck[] } | ProjectFailure

/** What the setup check asks the machine; replaced in tests. */
export interface Machine {
  /** Whether a command is on the PATH (`Bun.which`). */
  which: (command: string) => boolean
  platform: string
  arch: string
}

const thisMachine: Machine = {
  which: (command) => Bun.which(command) !== null,
  platform: process.platform,
  arch: process.arch,
}

/**
 * Checks what the studio needs on this machine and in the project (ffmpeg, uv for Whisper, the
 * Fish key and whether Fish answers, the refresh command), each with a fix. Fish is asked once,
 * for the credit, only when there is a key.
 */
export async function checkSetup(
  projectFile: string,
  fishFor: FishFactory,
  machine: Machine = thisMachine,
  environment: Record<string, string | undefined> = process.env,
): Promise<SetupResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const root = dirname(projectFile)
  const { narration } = project
  const key = (await fishApiKey(root, project.env, environment)) !== null
  const facts: SetupFacts = {
    ffmpeg: machine.which('ffmpeg'),
    uv: machine.which('uv'),
    appleSilicon: machine.platform === 'darwin' && machine.arch === 'arm64',
    transcriber: narration.quality.transcriber,
    whisperModel: narration.quality.whisperModel,
    envPath: project.env,
    key,
    fish: await askFish(),
    refreshDialog: Boolean(narration.refreshDialog),
  }
  return { ok: true, checks: setupChecks(facts) }

  async function askFish(): Promise<SetupFacts['fish']> {
    const fish = key ? await fishFor(root, project) : null
    if (!fish) return { ok: false, reason: 'no-key', message: NO_KEY }
    try {
      return { ok: true, credit: await fish.credit() }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: 'fish', message }
    }
  }
}
