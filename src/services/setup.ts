import { dirname } from 'node:path'
import { setupChecks, type ElevenAnswer, type SetupCheck, type SetupFacts } from '../core/setup'
import { elevenLabsApiKey, fishApiKey } from './env'
import { DEFAULT_MUSIC_MODEL, MUSIC_MODELS } from '../core/musicModels'
import { missingStableAudio, STABLE_AUDIO_DIR } from './stableAudio'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODEL_IDS } from '../core/imageModels'
import { HUB_DIR, imageModelInstalled, mfluxReady, type ImageGenerator } from './images'
import { aceStepCheckpoints, aceStepReady } from './music'
import { accountOf, createElevenLabsClient } from './elevenlabs'
import type { CreditResult } from './fish'
import { openProject, type ProjectFailure } from './workspace'

/** The setup as checked, or why the project file could not be read. */
export type SetupResult = { ok: true; checks: SetupCheck[] } | ProjectFailure

/** What a lookup without its key gives: not asked. */
const NO_KEY = { ok: false, reason: 'no-key', message: 'no key' } as const

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
 * music generator's models, the Fish key and whether Fish answers, the refresh command, and the
 * optional ElevenLabs key and account), each with a fix. `credit` is the server's lookup of the
 * Fish account's credit and `account` the lookup of the ElevenLabs account with the key found;
 * each is called only when there is its key, and the two are asked at the same time.
 */
export async function checkSetup(
  projectFile: string,
  credit: () => Promise<CreditResult>,
  machine: Machine = thisMachine,
  environment: Record<string, string | undefined> = process.env,
  stableAudioDir: string = STABLE_AUDIO_DIR,
  account: (apiKey: string) => Promise<ElevenAnswer> = (apiKey) =>
    accountOf(createElevenLabsClient(apiKey)),
  /** What says whether mflux can run and an image model's weights are on this computer. */
  images: Pick<ImageGenerator, 'installed' | 'ready'> = {
    installed: (model) => imageModelInstalled(HUB_DIR, model),
    ready: () => mfluxReady(machine),
  },
): Promise<SetupResult> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const root = dirname(projectFile)
  const { narration } = project
  const checkpoints = aceStepCheckpoints(environment)
  const key = (await fishApiKey(root, project.env, environment)) !== null
  const elevenKey = await elevenLabsApiKey(root, project.env, environment)
  const [fishAnswer, elevenAnswer] = await Promise.all([
    key ? credit() : NO_KEY,
    elevenKey ? account(elevenKey) : NO_KEY,
  ])
  const facts: SetupFacts = {
    ffmpeg: machine.which('ffmpeg'),
    uv: machine.which('uv'),
    appleSilicon: machine.platform === 'darwin' && machine.arch === 'arm64',
    transcriber: narration.quality.transcriber,
    whisperModel: narration.quality.whisperModel,
    envPath: project.env,
    key,
    fish: fishAnswer,
    refreshDialog: Boolean(narration.refreshDialog),
    parallel: narration.quality.parallel,
    fishTier: narration.quality.fishTier ?? null,
    music: project.music
      ? {
          ready: aceStepReady(machine, checkpoints, project.music.model),
          checkpoints,
          model: project.music.model ?? DEFAULT_MUSIC_MODEL,
          stableAudioMissing: MUSIC_MODELS.filter(
            ({ id, family }) =>
              family === 'stable-audio' && missingStableAudio(stableAudioDir, id).length > 0,
          ).map(({ id }) => id),
        }
      : null,
    images: project.images
      ? {
          mflux: await images.ready(),
          model: project.images.model ?? DEFAULT_IMAGE_MODEL,
          missing: (
            await Promise.all(
              IMAGE_MODEL_IDS.map(async (id) => ((await images.installed(id)) ? null : id)),
            )
          ).filter((id) => id !== null),
        }
      : null,
    elevenlabs: elevenAnswer,
  }
  return { ok: true, checks: setupChecks(facts) }
}
