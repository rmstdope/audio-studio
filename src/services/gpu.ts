import { createSerial, type Serial } from './serial'
import type { Transcriber } from './transcriber'

/** The queue key of the one GPU, which ACE-Step and Whisper share. */
export const GPU = 'gpu'

/**
 * The process's one GPU queue, kept across `--dev` reloads like the Whisper worker: a music take
 * and a Whisper check run one at a time, in the order asked (running together, Whisper ran 2.5
 * times slower and the machine's memory filled).
 */
export function gpuQueue(): Serial {
  const state = globalThis as { audioStudioGpu?: Serial }
  state.audioStudioGpu ??= createSerial()
  return state.audioStudioGpu
}

/** A transcriber whose checks wait their turn on the GPU queue. */
export function onGpu(transcriber: Transcriber, queue: Serial = gpuQueue()): Transcriber {
  return {
    transcribe: (model, path, language) =>
      queue.run(GPU, () => transcriber.transcribe(model, path, language)),
    close: () => transcriber.close(),
  }
}

/** The workers that hold the GPU's memory while idle, so an image take can ask them to let go. */
export interface GpuWorkers {
  /** Registers a worker's `close` (the same function twice is kept once). */
  add(close: () => void | Promise<void>): void
  /** Closes every registered worker and waits until their processes are gone; each starts again on its next request. */
  free(): Promise<void>
}

/** A set of GPU workers to free together. */
export function createGpuWorkers(): GpuWorkers {
  const closers = new Set<() => void | Promise<void>>()
  return {
    add: (close) => void closers.add(close),
    free: async () => {
      await Promise.all([...closers].map((close) => close()))
    },
  }
}

/** The process's GPU workers, kept across `--dev` reloads like the queue. */
function sharedGpuWorkers(): GpuWorkers {
  const state = globalThis as { audioStudioGpuWorkers?: GpuWorkers }
  state.audioStudioGpuWorkers ??= createGpuWorkers()
  return state.audioStudioGpuWorkers
}

/** Registers a worker that holds GPU memory while idle (Whisper, the music generators). */
export function onGpuFree(close: () => void | Promise<void>): void {
  sharedGpuWorkers().add(close)
}

/**
 * Closes the workers registered with `onGpuFree`, so a model that needs most of the memory (image
 * takes: 20 to 37 of 48 GB, beside the 42 that ACE-Step and Whisper hold) can load. Call it only
 * from a job on the GPU queue, when nothing else is running there.
 */
export function freeGpu(): Promise<void> {
  return sharedGpuWorkers().free()
}
