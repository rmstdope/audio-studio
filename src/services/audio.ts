import { mkdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pyFixed } from '../core/pyformat'
import { readWav } from '../core/wav'

/** How clips are encoded (the project's `output`). */
export interface EncodeOptions {
  bitrate: string
  channels: number
  /** Loudness to level the clip to (integrated LUFS), as RetroQuest's level.py; none: as encoded. */
  lufs?: number | null
}

/** Encodes a WAV into an MP3 file. Behind a type, so tests need no ffmpeg. */
export type Encoder = (wav: Uint8Array, file: string, options: EncodeOptions) => Promise<void>

/**
 * An ffmpeg encoder (as RetroQuest's narrate.py uses) writing into `file`, then levelling it to
 * `lufs` when that is set (see `levelClip`). On failure nothing is left at `file`, and the error is
 * ffmpeg's own, even when it stops reading its input early. The encode, and the levelling, each
 * get `timeoutMs`, and are killed after it (ffmpeg ignores a polite stop while it waits for
 * input).
 */
export function createFfmpegEncoder({ timeoutMs }: { timeoutMs: number }): Encoder {
  return async (wav, file, { bitrate, channels, lufs = null }) => {
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
    if (lufs !== null) {
      try {
        await levelClip(file, lufs, { timeoutMs })
      } catch (error) {
        await rm(file, { force: true })
        throw error
      }
    }
  }
}

/** The encoder the studio uses: ffmpeg, stopped after two minutes to encode and two to level. */
export const ffmpegEncoder: Encoder = createFfmpegEncoder({ timeoutMs: 120_000 })

/**
 * A clip decoded by ffmpeg to WAV at its own rate, and its length in seconds from its frames: what
 * narrate.py `--retime` transcribes and measures (Whisper hears a WAV and an MP3 of the same clip
 * slightly differently, so the studio gives it the WAV too).
 */
export async function decodeClip(
  file: string,
  { timeoutMs = 60_000 }: { timeoutMs?: number } = {},
): Promise<{ wav: Uint8Array; seconds: number }> {
  let child
  try {
    child = Bun.spawn(['ffmpeg', '-loglevel', 'error', '-i', file, '-f', 'wav', '-'], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    })
  } catch {
    throw new Error('ffmpeg is needed to measure clips: install it (e.g. brew install ffmpeg)')
  }
  const [bytes, message, code] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (child.signalCode === 'SIGKILL') {
    throw new Error(`ffmpeg took longer than ${timeoutMs / 1000} s to decode the clip`)
  }
  if (code !== 0) {
    throw new Error(`ffmpeg could not read the clip: ${message.trim() || `exit code ${code}`}`)
  }
  // Piped, ffmpeg cannot fill in the sizes in the header (0xFFFFFFFF); readWav reads to the end.
  const wav = new Uint8Array(bytes)
  const { format, data } = readWav(wav)
  const frame = (format.bitsPerSample / 8) * format.channels
  return { wav, seconds: data.length / frame / format.sampleRate }
}

/** level.py's constants: the true-peak ceiling, the loudness range, and the encodes allowed. */
const TRUE_PEAK = -1.5
const LRA = 11
const PASSES = 4

/**
 * Brings a clip to `lufs` integrated loudness in place, keeping its rate, channels and bit rate:
 * RetroQuest's level.py, command for command, so a clip comes out the same either way. The gain is
 * what loudnorm's measurement asks for; a limiter keeps the peaks it would push too high below
 * −1.5 dBFS, which takes a little loudness off, so the result is measured again and the gain
 * corrected, up to four encodes, until within 0.5 LU. The levelled clip is written next to the
 * clip (a hidden sibling) and renamed over it. Gives the loudness it came out at, which may still
 * be off target after four encodes (level.py prints a warning then; the studio leaves it to the
 * caller). A clip too short or silent to measure is refused and left as it was. Everything,
 * all its ffmpeg runs together, must be done within `timeoutMs`.
 */
export async function levelClip(
  file: string,
  lufs: number,
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<number> {
  const deadline = Date.now() + timeoutMs
  const left = () => Math.max(1, deadline - Date.now())
  const stream = await probe(file, left())
  const measured = await loudness(file, left())
  if (!Number.isFinite(measured)) {
    throw new Error('the clip is too short or silent to measure its loudness')
  }
  let gain = lufs - measured
  let reached = measured
  const out = join(dirname(file), `.${basename(file, '.mp3')}.level.mp3`)
  try {
    for (let pass = 0; pass < PASSES; pass++) {
      const args = ['-loglevel', 'error', '-y', '-i', file, '-af', gainFilter(gain)]
      args.push('-ar', stream.sample_rate, '-ac', String(stream.channels))
      if (stream.bit_rate) args.push('-b:a', stream.bit_rate)
      await ffmpeg([...args, out], left())
      reached = await loudness(out, left())
      const miss = lufs - reached
      if (Math.abs(miss) <= 0.5) break
      gain += miss
    }
    await rename(out, file)
    return reached
  } finally {
    await rm(out, { force: true })
  }
}

/** level.py's gain_filter: a constant gain, with a limiter catching the peaks it pushes too high. */
function gainFilter(gainDb: number): string {
  const ceiling = 10 ** (TRUE_PEAK / 20)
  return `volume=${pyFixed(gainDb, 2)}dB,alimiter=limit=${pyFixed(ceiling, 4)}:attack=5:release=50:level=false`
}

/** A file's integrated loudness in LUFS, from loudnorm's first-pass measurement (NaN if none). */
async function loudness(file: string, timeoutMs: number): Promise<number> {
  // The filter's settings as level.py writes them (Python prints -16.0), though only input_i is read.
  const filter = `loudnorm=I=-16.0:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`
  const { stderr } = await ffmpeg(
    ['-hide_banner', '-nostats', '-i', file, '-af', filter, '-f', 'null', '-'],
    timeoutMs,
  )
  const json = stderr.match(/\{[^{}]*\}/g)?.at(-1)
  if (!json) throw new Error('ffmpeg did not measure the clip’s loudness')
  return Number((JSON.parse(json) as { input_i: string }).input_i)
}

/** The first audio stream's rate, channels and bit rate, as ffprobe reports them. */
async function probe(
  file: string,
  timeoutMs: number,
): Promise<{ sample_rate: string; channels: number; bit_rate?: string }> {
  const args = ['-v', 'error', '-select_streams', 'a:0']
  args.push('-show_entries', 'stream=sample_rate,channels,bit_rate', '-of', 'json', file)
  const { stdout } = await run('ffprobe', args, timeoutMs)
  const parsed = JSON.parse(stdout) as {
    streams: { sample_rate: string; channels: number; bit_rate?: string }[]
  }
  const stream = parsed.streams[0]
  if (!stream) throw new Error('the clip has no audio stream')
  return stream
}

function ffmpeg(args: string[], timeoutMs: number) {
  return run('ffmpeg', args, timeoutMs)
}

/** Runs ffmpeg or ffprobe: its output, or an error saying what went wrong. */
async function run(
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  let child
  try {
    child = Bun.spawn([tool, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    })
  } catch {
    throw new Error(`${tool} is needed to level clips: install ffmpeg (e.g. brew install ffmpeg)`)
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (child.signalCode === 'SIGKILL') {
    throw new Error(`${tool} ran out of the time for levelling the clip, and was stopped`)
  }
  if (code !== 0) {
    const why = stderr.trim().split('\n').at(-1) || `exit code ${code}`
    throw new Error(`${tool} could not level the clip: ${why}`)
  }
  return { stdout, stderr }
}
