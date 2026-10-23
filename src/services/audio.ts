import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

/** How clips are encoded (the project's `output`). */
export interface EncodeOptions {
  bitrate: string
  channels: number
}

/** Encodes a WAV into an MP3 file. Behind a type, so tests need no ffmpeg. */
export type Encoder = (wav: Uint8Array, file: string, options: EncodeOptions) => Promise<void>

/**
 * Encodes with ffmpeg (as RetroQuest's narrate.py does), into a temporary file renamed into place,
 * so a failed or cancelled encode never leaves a broken clip.
 */
export const ffmpegEncoder: Encoder = async (wav, file, { bitrate, channels }) => {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp.mp3`
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
        temporary,
      ],
      { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' },
    )
  } catch {
    throw new Error('ffmpeg is needed to encode clips: install it (e.g. brew install ffmpeg)')
  }
  try {
    child.stdin.write(wav)
    await child.stdin.end()
    const code = await child.exited
    if (code !== 0) {
      const message = (await new Response(child.stderr).text()).trim()
      throw new Error(`ffmpeg could not encode the clip: ${message || `exit code ${code}`}`)
    }
    await rename(temporary, file)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}
