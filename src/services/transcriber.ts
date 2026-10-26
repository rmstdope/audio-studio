import { join } from 'node:path'
import type { HeardSegment } from '../core/align'
import { createLineWorker } from './lineWorker'

/** Hears what a clip says. Behind an interface, so tests use a fake. */
export interface Transcriber {
  /**
   * What Whisper (`model`) heard in the audio file at `path` (WAV or MP3): segments, word timings.
   * `language` is the code of the language spoken; without it Whisper recognises it itself.
   */
  transcribe(model: string, path: string, language?: string): Promise<HeardSegment[]>
  /** Stops the worker, if one is running. */
  close(): void
}

/** The worker script, run with uv (which installs mlx-whisper the first time). */
export const WORKER = join(import.meta.dir, '../../worker/transcribe.py')

/**
 * A long-lived Whisper worker (worker/transcribe.py, mlx-whisper on Apple silicon), started on
 * first use so the model loads once; the model is named with each request (mlx-whisper reloads
 * only when it changes). A worker that dies fails only its own waiting requests and is started
 * again next time; one that takes longer than `timeoutMs` on a request is stopped (see
 * `createLineWorker`). `command` replaces the worker (tests).
 */
export function createWhisperWorker({
  command = ['uv', 'run', '--quiet', '--script', WORKER],
  timeoutMs = 10 * 60_000,
}: { command?: string[]; timeoutMs?: number } = {}): Transcriber {
  const worker = createLineWorker({
    name: 'Whisper',
    command,
    timeoutMs,
    couldNotStart: (why) =>
      `Whisper could not start (${why}). It needs uv and Apple silicon; set ` +
      'quality.transcriber to "none" in the project file to record without checking.',
  })
  return {
    async transcribe(model, path, language) {
      const answer = await worker.request({ path, model, ...(language ? { language } : {}) })
      return (answer.segments as HeardSegment[] | undefined) ?? []
    },
    close: () => worker.close(),
  }
}
