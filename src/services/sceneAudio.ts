import { relative, sep } from 'node:path'
import type { RenderPart, SceneAudio } from './sceneLoudness'

/** How long ffmpeg may take over one measure. */
const TIMEOUT_MS = 120_000

/** `file` as the game's folder shows it: its path from the project `root`, with forward slashes. */
function projectPath(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

/** `text` with the computer's path to each of `files` taken out: a leading copy goes, others shorten. */
function withoutAbsolutePaths(root: string, files: string[], text: string): string {
  let out = text
  for (const file of files) {
    out = out.split(`${file}: `).join('').split(file).join(projectPath(root, file))
  }
  return out
}

/**
 * Runs ffmpeg or ffprobe and gives its output; on failure an error saying what was being read and
 * ffmpeg's last line.
 */
async function run(
  root: string,
  tool: 'ffmpeg' | 'ffprobe',
  args: string[],
  files: string[],
): Promise<{ stdout: string; stderr: string }> {
  let child
  try {
    child = Bun.spawn([tool, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: TIMEOUT_MS,
      killSignal: 'SIGKILL',
    })
  } catch {
    throw new Error(
      `${tool} is needed to measure loudness: install ffmpeg (e.g. brew install ffmpeg)`,
    )
  }
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  if (child.signalCode === 'SIGKILL') throw new Error(`${tool} took too long and was stopped`)
  if (code !== 0) {
    const names = files.map((f) => projectPath(root, f)).join(', ')
    const why = withoutAbsolutePaths(
      root,
      files,
      stderr.trim().split('\n').at(-1) || `exit code ${code}`,
    )
    throw new Error(`${tool} could not read ${names}: ${why}`)
  }
  return { stdout, stderr }
}

/** The filters of a mix of `parts` over `window` seconds, ending in the labelled output `[mix]`. */
function mixFilter(parts: RenderPart[], window: number): string {
  const chains: string[] = []
  const labels: string[] = []
  parts.forEach((part, i) => {
    const prepare = `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${part.level}`
    if (part.loop) {
      chains.push(`${prepare},atrim=0:${window}[p${i}]`)
      labels.push(`[p${i}]`)
      return
    }
    const outs = part.starts.map((_, j) => `[s${i}_${j}]`)
    chains.push(
      outs.length === 1
        ? `${prepare}${outs[0]}`
        : `${prepare},asplit=${outs.length}${outs.join('')}`,
    )
    part.starts.forEach((start, j) => {
      const ms = Math.round(start * 1000)
      chains.push(`${outs[j]}adelay=${ms}|${ms}[d${i}_${j}]`)
      labels.push(`[d${i}_${j}]`)
    })
  })
  chains.push(
    `${labels.join('')}amix=inputs=${labels.length}:normalize=0:duration=longest,atrim=0:${window},` +
      `loudnorm=I=-16.0:TP=-1.5:LRA=11:print_format=json[mix]`,
  )
  return chains.join(';')
}

/**
 * The scenes' audio on ffmpeg: a clip's length from ffprobe, and the loudness of a mix from
 * loudnorm's first-pass measure (integrated LUFS, BS.1770 — the figure the studio already levels
 * narration and music by). Errors name clips by their path from the project `root`. Looped sounds fill the window; a one-shot is delayed to each start.
 */
export function ffmpegSceneAudio(root: string): SceneAudio {
  return {
    async seconds(file) {
      const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]
      const { stdout } = await run(root, 'ffprobe', args, [file])
      const seconds = Number(stdout.trim())
      if (!Number.isFinite(seconds)) throw new Error(`${projectPath(root, file)} has no length`)
      return seconds
    },

    async loudness(parts, window) {
      if (parts.length === 0) return null
      const args = ['-hide_banner', '-nostats']
      for (const part of parts) {
        if (part.loop) args.push('-stream_loop', '-1')
        args.push('-i', part.file)
      }
      args.push('-filter_complex', mixFilter(parts, window), '-map', '[mix]')
      args.push('-t', String(window), '-f', 'null', '-')
      const { stderr } = await run(root, 'ffmpeg', args, [...new Set(parts.map((p) => p.file))])
      const json = stderr.match(/\{[^{}]*\}/g)?.at(-1)
      if (!json) throw new Error('ffmpeg did not measure the loudness')
      const lufs = Number((JSON.parse(json) as { input_i: string }).input_i)
      // Silence reads "-inf": nothing plays.
      return Number.isFinite(lufs) ? lufs : null
    },
  }
}
