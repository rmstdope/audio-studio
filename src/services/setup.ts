import { dirname } from 'node:path'
import { setupChecks, type SetupCheck, type SetupFacts } from '../core/setup'
import { fishApiKey } from './env'
import { aceStepCheckpoints, aceStepReady } from './music'
import type { CreditResult } from './fish'
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
 * music generator's models, the Fish key and whether Fish answers, the refresh command), each with a fix. `credit` is the
 * server's lookup of the account's credit (which asks Fish); it is called only when there is a key.
 */
export async function checkSetup(
  projectFile: string,
  credit: () => Promise<CreditResult>,
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
    fish: key ? await credit() : { ok: false, reason: 'no-key', message: 'no key' },
    refreshDialog: Boolean(narration.refreshDialog),
    parallel: narration.quality.parallel,
    fishTier: narration.quality.fishTier ?? null,
    music: project.music
      ? {
          ready: aceStepReady(machine, aceStepCheckpoints(environment)),
          checkpoints: aceStepCheckpoints(environment),
        }
      : null,
  }
  return { ok: true, checks: setupChecks(facts) }
}
