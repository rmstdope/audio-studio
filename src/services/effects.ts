import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageDownload } from '../core/imageModels'
import { effectModel } from '../core/effectModels'
import { readWav, trimTrailingSilence, writeWav } from '../core/wav'
import { createLineWorker } from './lineWorker'
import { HUB_DIR, hubDownload } from './images'

/** The worker script, run with uv (which installs Stability's `stable-audio-3` library the first time). */
export const EFFECTS_WORKER = join(import.meta.dir, '../../worker/effects.py')

/** What one effect is made from. */
export interface EffectRequest {
  /** What the sound is, in words. */
  prompt: string
  /** The length asked for; the take is often shorter, since the model stops early. */
  seconds: number
  seed: number
}

/** One finished effect: a 16-bit WAV with its trailing silence trimmed, and the seed it was made from. */
export interface EffectTake {
  wav: Uint8Array
  seed: number
}

/** Makes sound effects. Behind an interface, so tests use a fake. */
export interface EffectGenerator {
  /** How much of the model's weights are in the Hugging Face cache. */
  download(): ImageDownload
  /** Whether effects can be made on this computer, and what is missing if not. */
  ready(): { ok: true } | { ok: false; message: string }
  /**
   * One effect; the first one loads the model (about 4 s). Aborting `signal` ends it at once and
   * it rejects; the message differs by when it was aborted, so a caller tells a stopped effect
   * from a failed one by `signal.aborted`.
   */
  generate(request: EffectRequest, signal?: AbortSignal): Promise<EffectTake>
  /** Stops the worker, if one is running. */
  close(): Promise<void>
}

/**
 * The effects worker (worker/effects.py: Stable Audio 3 Small SFX on the CPU), started on the
 * first effect and stopped with the studio. It has its own libraries, apart from the Stable Audio
 * Open worker's. The worker runs offline and finds the weights in the Hugging Face cache through
 * the environment it inherits (`HF_HOME`); `hubDir` is the same folder, for `download()` only.
 * The studio gives it no token. `command` replaces the worker (tests).
 */
export function createEffectsWorker({
  command = ['uv', 'run', '--quiet', '--script', EFFECTS_WORKER],
  timeoutMs = 10 * 60_000,
  hubDir = HUB_DIR,
}: {
  command?: string[]
  timeoutMs?: number
  hubDir?: string
} = {}): EffectGenerator {
  const worker = createLineWorker({
    name: 'The effects generator',
    command,
    timeoutMs,
    env: { HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_OFFLINE: '1' },
    couldNotStart: (why) => `The effects generator could not start (${why}). It needs uv.`,
    killed:
      'The effects generator was stopped by the computer, most likely because it ran out of memory. Try again.',
  })
  return {
    download: () => hubDownload(hubDir, effectModel('small-sfx').repo),
    ready() {
      const { name } = effectModel('small-sfx')
      if (!Bun.which('uv')) {
        return { ok: false, message: `uv, which runs ${name}, is not on the PATH.` }
      }
      const download = hubDownload(hubDir, effectModel('small-sfx').repo)
      if (download === 'absent') return { ok: false, message: `${name} is not on this computer.` }
      if (download === 'partial') {
        return { ok: false, message: `${name}'s download is incomplete, so it can't run.` }
      }
      return { ok: true }
    },
    async generate(request, signal) {
      const out = join(tmpdir(), `content-studio-effect-${randomUUID()}.wav`)
      const stop = () => worker.close()
      signal?.addEventListener('abort', stop, { once: true })
      try {
        if (signal?.aborted) throw new Error('The effects generator was stopped.')
        const answer = await worker.request({ ...request, out })
        const wav = trimTrailingSilence(readWav(new Uint8Array(await readFile(out))))
        return { wav: writeWav(wav), seed: Number(answer.seed) }
      } finally {
        signal?.removeEventListener('abort', stop)
        await rm(out, { force: true })
      }
    },
    close: () => worker.close(),
  }
}
