import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { musicModel, type MusicModelId } from '../core/musicModels'
import { createLineWorker } from './lineWorker'
import { withHome, type MusicGenerator, type MusicReady } from './music'
import type { Machine } from './setup'

/**
 * Where Stable Audio Open's models are looked for: a folder of its own in the user's cache, one
 * named folder per model. Fixed, with no setting that could move it, and the studio never reads
 * a token or a licence answer from anywhere.
 */
export const STABLE_AUDIO_DIR = join(homedir(), '.cache', 'stable-audio')

/** The worker script, run with uv (which installs stable-audio-tools the first time). */
export const STABLE_AUDIO_WORKER = join(import.meta.dir, '../../worker/stable_audio.py')

/** The folders of a model that are not in `dir`. */
export function missingStableAudio(dir: string, model: MusicModelId): string[] {
  return musicModel(model).folders.filter((folder) => !existsSync(join(dir, folder)))
}

/** Whether a Stable Audio model can run here, and the first thing that stops it if not. */
export function stableAudioReady(machine: Machine, dir: string, model: MusicModelId): MusicReady {
  if (!(machine.platform === 'darwin' && machine.arch === 'arm64')) {
    return {
      ok: false,
      message: 'Stable Audio Open runs on macOS with Apple silicon only.',
      fix: 'Music is made on a Mac with Apple silicon; there is nothing to install on this computer.',
    }
  }
  if (!machine.which('uv')) {
    return {
      ok: false,
      message: 'uv is not on the PATH; it runs the music worker.',
      fix: 'brew install uv (then start the studio again if it is still not found)',
    }
  }
  const missing = missingStableAudio(dir, model)
  if (!missing.length) return { ok: true }
  return {
    ok: false,
    message: `${musicModel(model).name} is not on this computer: ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing from ${withHome(dir)}.`,
    fix: `See Setup for how to download ${missing.join(' and ')} into ${withHome(dir)}.`,
  }
}

/**
 * The Stable Audio worker (worker/stable_audio.py: the model each request names), started on
 * the first take and stopped with the studio. Like the ACE-Step worker it writes each take to a
 * temporary file the request names. `command` replaces the worker (tests), `dir` the folder of
 * the models, `ready` the check that it can run here.
 */
export function createStableAudioWorker({
  command = ['uv', 'run', '--quiet', '--script', STABLE_AUDIO_WORKER],
  timeoutMs = 30 * 60_000,
  dir = STABLE_AUDIO_DIR,
  machine = { which: (c) => Bun.which(c) !== null, platform: process.platform, arch: process.arch },
  ready = (model) => stableAudioReady(machine, dir, model),
}: {
  command?: string[]
  timeoutMs?: number
  dir?: string
  machine?: Machine
  ready?: (model: MusicModelId) => MusicReady
} = {}): MusicGenerator {
  const worker = createLineWorker({
    name: 'The music generator',
    command,
    timeoutMs,
    // The models are read from their folders: nothing is fetched, so no token is ever needed.
    env: { HF_HUB_OFFLINE: '1' },
    couldNotStart: (why) =>
      `The music generator could not start (${why}). It needs uv and Apple silicon.`,
    killed:
      'The music generator was stopped by the computer, most likely because it ran out of memory. Close other music jobs, then Try again.',
  })
  return {
    ready,
    installed: (model) => missingStableAudio(dir, model).length === 0,
    async generate({ model, ...request }, signal) {
      const out = join(tmpdir(), `audio-studio-music-${randomUUID()}.wav`)
      const stop = () => worker.close()
      signal?.addEventListener('abort', stop, { once: true })
      try {
        if (signal?.aborted) throw new Error('The music generator was stopped.')
        const answer = await worker.request({
          ...request,
          model_dir: join(dir, musicModel(model).folders[0]!),
          small: model === 'shortest',
          out,
        })
        return { wav: new Uint8Array(await readFile(out)), seed: Number(answer.seed) }
      } finally {
        signal?.removeEventListener('abort', stop)
        await rm(out, { force: true })
      }
    },
    close: () => worker.close(),
  }
}
