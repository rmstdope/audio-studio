import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImageDownload } from '../core/imageModels'
import { effectModel, type EffectModelId } from '../core/effectModels'
import { readWav, trimTrailingSilence, writeWav } from '../core/wav'
import { createLineWorker } from './lineWorker'
import { HUB_DIR, hubDownload } from './hubCache'
import type { MusicGenerator } from './music'
import { STABLE_AUDIO_DIR } from './stableAudio'

/** The worker script, run with uv (which installs Stability's `stable-audio-3` library the first time). */
export const EFFECTS_WORKER = join(import.meta.dir, '../../worker/effects.py')

/** What one effect is made from. */
export interface EffectRequest {
  /** What the sound is, in words. */
  prompt: string
  /** The length asked for; the take is often shorter, since the model stops early. */
  seconds: number
  seed: number
  /**
   * The effect loops, so its sound should fill the length. Only the stand-ins read it: the model
   * is told nothing but the words, and ambience fills its length by itself.
   */
  loops?: boolean
}

/** One finished effect: a 16-bit WAV with its trailing silence trimmed, and the seed it was made from. */
export interface EffectTake {
  wav: Uint8Array
  seed: number
}

/** Whether effects can be made with a model on this computer, and what is missing if not. */
export type EffectReady = { ok: true } | { ok: false; message: string }

/** Makes sound effects with one model. Behind an interface, so tests use a fake. */
export interface ModelEffects {
  /** How much of the model's weights are on this computer. */
  download(): ImageDownload | Promise<ImageDownload>
  /** Whether effects can be made with the model on this computer, and what is missing if not. */
  ready(): EffectReady | Promise<EffectReady>
  /**
   * One effect; the first one loads the model (about 4 s). Aborting `signal` ends it at once and
   * it rejects; the message differs by when it was aborted, so a caller tells a stopped effect
   * from a failed one by `signal.aborted`.
   */
  generate(request: EffectRequest, signal?: AbortSignal): Promise<EffectTake>
  /** Stops the worker, if one is running. */
  close(): void | Promise<void>
}

/** Makes sound effects with the model each request names. Behind an interface, so tests use a fake. */
export interface EffectGenerator {
  /** How much of a model's weights are on this computer. */
  download(model: EffectModelId): ImageDownload | Promise<ImageDownload>
  /** Whether effects can be made with a model on this computer, and what is missing if not. */
  ready(model: EffectModelId): EffectReady | Promise<EffectReady>
  /** One effect with `request.model`; see `ModelEffects.generate`. */
  generate(
    request: EffectRequest & { model: EffectModelId },
    signal?: AbortSignal,
  ): Promise<EffectTake>
  /** Stops the workers, if any is running. */
  close(): void | Promise<void>
}

/** The generator that sends each request to its model's own: `models` has one per model. */
export function createEffectGenerator(
  models: Record<EffectModelId, ModelEffects>,
): EffectGenerator {
  return {
    download: (model) => models[model].download(),
    ready: (model) => models[model].ready(),
    generate: ({ model, ...request }, signal) => models[model].generate(request, signal),
    close: async () => {
      await Promise.all(Object.values(models).map((m) => m.close()))
    },
  }
}

/**
 * Stable Audio Open 1.0 for effects, on the Stable Audio worker the music uses (`music`, model
 * Short): the description goes as it is, not as instrumental music, and the take ends where its
 * sound ends. The worker is the music's, so the GPU is shared in the music's way.
 */
export function createOpenEffects(music: MusicGenerator): ModelEffects {
  return {
    download: async () => ((await music.installed('short')) ? 'whole' : 'absent'),
    async ready() {
      const ready = await music.ready('short')
      if (ready.ok) return { ok: true }
      // Short's own words name the music model; an effect says Open 1.0.
      if (!(await music.installed('short'))) {
        return {
          ok: false,
          message: `${effectModel('open-1').name} is not on this computer. Setup says how to download it.`,
        }
      }
      return { ok: false, message: ready.message }
    },
    async generate(request, signal) {
      const take = await music.generate(
        {
          model: 'short',
          brief: request.prompt,
          kind: 'stinger',
          seconds: request.seconds,
          bpm: null,
          key: null,
          seed: request.seed,
          plain: true,
        },
        signal,
      )
      const wav = trimTrailingSilence(readWav(take.wav))
      return { wav: writeWav(wav), seed: take.seed ?? request.seed }
    },
    // The worker is the music's, closed with it (and by the image takes freeing the GPU).
    close() {},
  }
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
} = {}): ModelEffects {
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
    download: () =>
      hubDownload(hubDir, effectModel('small-sfx').repo, effectModel('small-sfx').needs),
    ready() {
      const { name } = effectModel('small-sfx')
      if (!Bun.which('uv')) {
        return { ok: false, message: `uv, which runs ${name}, is not on the PATH.` }
      }
      const download = hubDownload(
        hubDir,
        effectModel('small-sfx').repo,
        effectModel('small-sfx').needs,
      )
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
        const { loops: _loops, ...asked } = request
        const answer = await worker.request({ ...asked, out })
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

/**
 * How much of a model's weights are on this computer: Small SFX's in the Hugging Face cache
 * (`hubDir`), Open 1.0's as a folder of the Stable Audio folder (`stableAudioDir`), which is whole
 * or absent, since a folder can't be told whole from half.
 */
export function effectDownload(
  model: EffectModelId,
  hubDir: string = HUB_DIR,
  stableAudioDir: string = STABLE_AUDIO_DIR,
): ImageDownload {
  const { source, repo, needs } = effectModel(model)
  if (source.kind === 'hub') return hubDownload(hubDir, repo, needs)
  return existsSync(join(stableAudioDir, source.folder)) ? 'whole' : 'absent'
}
