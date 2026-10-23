import { mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/** How clips are encoded (the project's `output`). */
export interface EncodeOptions {
  bitrate: string
  channels: number
}

/** Encodes a WAV into an MP3 file. Behind a type, so tests need no ffmpeg. */
export type Encoder = (wav: Uint8Array, file: string, options: EncodeOptions) => Promise<void>

/** An encode taking longer than this is stopped. */
const ENCODE_TIMEOUT_MS = 120_000

/**
 * Encodes with ffmpeg (as RetroQuest's narrate.py does) into `file`. On failure nothing is left
 * at `file`, and the error is ffmpeg's own, even when it stops reading its input early.
 */
export const ffmpegEncoder: Encoder = async (wav, file, { bitrate, channels }) => {
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
      { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe', timeout: ENCODE_TIMEOUT_MS },
    )
  } catch {
    throw new Error('ffmpeg is needed to encode clips: install it (e.g. brew install ffmpeg)')
  }
  const stderr = new Response(child.stderr).text()
  try {
    child.stdin.write(wav)
    await child.stdin.end()
  } catch {
    // ffmpeg stopped reading (it failed early): its exit code and message say why.
  }
  const [code, message] = await Promise.all([child.exited, stderr])
  if (code !== 0) {
    await rm(file, { force: true })
    const why =
      message.trim() || (child.signalCode ? `stopped (${child.signalCode})` : `exit code ${code}`)
    throw new Error(`ffmpeg could not encode the clip: ${why}`)
  }
}
