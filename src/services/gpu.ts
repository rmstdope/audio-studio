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
