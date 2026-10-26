import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLineWorker } from './lineWorker'
import type { Machine } from './setup'

/** What ACE-Step is asked to make: one take of a brief. `seconds` is the length to generate. */
export interface MusicRequest {
  brief: string
  kind: 'loop' | 'stinger'
  seconds: number
  bpm: number | null
  key: string | null
  seed: number
}

/** One take as generated: a WAV, and the seed it was made from. */
export interface GeneratedTake {
  wav: Uint8Array
  seed: number
}

/** Whether takes can be made on this computer, and what is missing if not. */
export type MusicReady = { ok: true } | { ok: false; message: string; fix: string }

/** Makes music from a brief. Behind an interface, so tests use a fake. */
export interface MusicGenerator {
  /** Whether a take can be made now: the machine, uv and the models are there. */
  ready(): MusicReady
  /**
   * One take of the brief; slow (minutes), and the first one loads the models. Aborting `signal`
   * ends it at once (Stop), and it rejects.
   */
  generate(request: MusicRequest, signal?: AbortSignal): Promise<GeneratedTake>
  /** Stops the worker, if one is running. */
  close(): void
}

/** The worker script, run with uv (which installs ACE-Step the first time). */
export const MUSIC_WORKER = join(import.meta.dir, '../../worker/music.py')

/** The two model folders ACE-Step needs in its checkpoints folder. */
export const ACE_STEP_MODELS = ['acestep-v15-xl-turbo', 'acestep-5Hz-lm-4B'] as const

/** Where ACE-Step's models are looked for: `ACESTEP_CHECKPOINTS`, else a folder in the user's cache. */
export function aceStepCheckpoints(
  environment: Record<string, string | undefined> = process.env,
): string {
  return environment.ACESTEP_CHECKPOINTS ?? join(homedir(), '.cache', 'ace-step', 'checkpoints')
}

/**
 * Whether ACE-Step can run here, and the first thing that stops it if not: Apple silicon, uv,
 * the models in `checkpoints`.
 */
export function aceStepReady(machine: Machine, checkpoints: string): MusicReady {
  if (!(machine.platform === 'darwin' && machine.arch === 'arm64')) {
    return {
      ok: false,
      message: 'ACE-Step runs on macOS with Apple silicon only.',
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
  const missing = ACE_STEP_MODELS.filter((model) => !existsSync(join(checkpoints, model)))
  return missing.length
    ? {
        ok: false,
        message: `The models are not in ${checkpoints}: ${missing.join(', ')}.`,
        fix: `Put the models ${ACE_STEP_MODELS.join(' and ')} (about 28 GB) in ${checkpoints}, or set ACESTEP_CHECKPOINTS to the folder that holds them.`,
      }
    : { ok: true }
}

/**
 * The ACE-Step worker (worker/music.py: XL turbo with the 4B language model), started on the
 * first take so the models load once and stopped with the studio. It writes each take to a
 * temporary file the request names. `command` replaces the worker (tests), and `ready` the check
 * that it can run here.
 */
export function createAceStepWorker({
  command = ['uv', 'run', '--quiet', '--script', MUSIC_WORKER],
  timeoutMs = 30 * 60_000,
  environment = process.env,
  machine = { which: (c) => Bun.which(c) !== null, platform: process.platform, arch: process.arch },
  ready = () => aceStepReady(machine, aceStepCheckpoints(environment)),
}: {
  command?: string[]
  timeoutMs?: number
  environment?: Record<string, string | undefined>
  machine?: Machine
  ready?: () => MusicReady
} = {}): MusicGenerator {
  const checkpoints = aceStepCheckpoints(environment)
  const worker = createLineWorker({
    name: 'The music generator',
    command,
    timeoutMs,
    env: { ACESTEP_CHECKPOINTS: checkpoints },
    couldNotStart: (why) =>
      `The music generator could not start (${why}). It needs uv and Apple silicon.`,
    killed:
      'The music generator was stopped by the computer, most likely because it ran out of memory. Close other music jobs, then Try again.',
  })
  return {
    ready,
    async generate(request, signal) {
      const out = join(tmpdir(), `audio-studio-music-${randomUUID()}.wav`)
      // The worker makes one take at a time, so ending this one means stopping the worker; the
      // next take starts it again.
      const stop = () => worker.close()
      signal?.addEventListener('abort', stop, { once: true })
      try {
        if (signal?.aborted) throw new Error('The music generator was stopped.')
        const answer = await worker.request({ ...request, out })
        return { wav: new Uint8Array(await readFile(out)), seed: Number(answer.seed) }
      } finally {
        signal?.removeEventListener('abort', stop)
        await rm(out, { force: true })
      }
    },
    close: () => worker.close(),
  }
}
