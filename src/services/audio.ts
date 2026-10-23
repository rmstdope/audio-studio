import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/** How clips are encoded (the project's `output`). */
export interface EncodeOptions {
  bitrate: string
  channels: number
}

/** Encodes a WAV into an MP3 file. Behind a type, so tests need no ffmpeg. */
export type Encoder = (wav: Uint8Array, file: string, options: EncodeOptions) => Promise<void>

/**
 * An ffmpeg encoder (as RetroQuest's narrate.py uses) writing into `file`. On failure nothing is
 * left at `file`, and the error is ffmpeg's own, even when it stops reading its input early. An
 * encode taking longer than `timeoutMs` is killed (ffmpeg ignores a polite stop while it waits for
 * input).
 */
export function createFfmpegEncoder({ timeoutMs }: { timeoutMs: number }): Encoder {
  return async (wav, file, { bitrate, channels }) => {
    await mkdir(dirname(file), { recursive: true })
    let child
    try {
      child = Bun.spawn(
        [
          'ffmpeg',
          '-loglevel',
          'error',
          '-y',
          '-f',
          'wav',
          '-i',
          '-',
          '-ac',
          String(channels),
          '-b:a',
          bitrate,
          file,
        ],
        {
          stdin: 'pipe',
          stdout: 'ignore',
          stderr: 'pipe',
          timeout: timeoutMs,
          killSignal: 'SIGKILL',
        },
      )
    } catch {
      throw new Error('ffmpeg is needed to encode clips: install it (e.g. brew install ffmpeg)')
    }
    const stderr = new Response(child.stderr).text()
    try {
      child.stdin.write(wav)
      await child.stdin.end()
    } catch {
      // ffmpeg stopped reading (it failed early, or was stopped): its exit says why.
    }
    const [code, message] = await Promise.all([child.exited, stderr])
    if (code !== 0) {
      await rm(file, { force: true })
      if (child.signalCode === 'SIGKILL') {
        throw new Error(
          `ffmpeg took longer than ${timeoutMs / 1000} s to encode the clip, and was stopped`,
        )
      }
      throw new Error(`ffmpeg could not encode the clip: ${message.trim() || `exit code ${code}`}`)
    }
  }
}

/** The encoder the studio uses: ffmpeg, stopped after two minutes. */
export const ffmpegEncoder: Encoder = createFfmpegEncoder({ timeoutMs: 120_000 })
