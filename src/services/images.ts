import { randomUUID } from 'node:crypto'
import { readdirSync, statSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkImageRequest,
  IMAGE_MODEL_IDS,
  imageModel,
  type ImageModelId,
} from '../core/imageModels'
import { freeGpu, gpuQueue, GPU } from './gpu'
import { quietLines } from './lineWorker'
import type { Serial } from './serial'
import type { Machine } from './setup'

/** What an image take is made from. */
export interface ImageRequest {
  prompt: string
  /** Pixels; a multiple of 16. */
  width: number
  height: number
  seed: number
  /** The model to make it with. */
  model: ImageModelId
}

/** One take as generated: a PNG, and the seed it was made from. */
export interface GeneratedImage {
  png: Uint8Array
  seed: number
}

/** Whether image takes can be made on this computer, and what is missing if not. */
export type ImageReady =
  | { ok: true }
  | {
      ok: false
      /** What stops it: this computer is not an Apple-silicon Mac, or mflux is not installed. */
      reason: 'platform' | 'mflux'
      message: string
      fix: string
    }

/** Makes images from a prompt. Behind an interface, so tests use a fake. */
export interface ImageGenerator {
  /** Whether a take can be made now: Apple silicon and mflux are there. */
  ready(): ImageReady | Promise<ImageReady>
  /** Whether this model's weights are on this computer. */
  installed(model: ImageModelId): boolean | Promise<boolean>
  /** One take; the model loads for it and leaves memory when it is made. Aborting ends it, and it rejects. */
  generate(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage>
}

/** Where Hugging Face keeps its downloads, where mflux finds and puts the models' weights. */
export function hubDirOf(env: Record<string, string | undefined>, home: string): string {
  if (env.HF_HUB_CACHE) return env.HF_HUB_CACHE
  if (env.HF_HOME) return join(env.HF_HOME, 'hub')
  return join(home, '.cache', 'huggingface', 'hub')
}

/** Where the Hugging Face downloads are on this computer. */
export const HUB_DIR = hubDirOf(process.env, homedir())

/** Whether a folder holds a weights file (`.safetensors`) at any depth; anything unreadable counts as none. */
function hasWeights(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? hasWeights(path) : name.endsWith('.safetensors')
    })
  } catch {
    return false
  }
}

/**
 * Whether a model's weights are in the Hugging Face cache `hubDir`: a snapshot of its folder holds
 * a weights file, so a download stopped after its configs does not count.
 */
export function imageModelInstalled(hubDir: string, model: ImageModelId): boolean {
  return hasWeights(
    join(hubDir, `models--${imageModel(model).repo.replace('/', '--')}`, 'snapshots'),
  )
}

/** Whether mflux can run here, and the first thing that stops it if not. */
export function mfluxReady(machine: Machine): ImageReady {
  if (!(machine.platform === 'darwin' && machine.arch === 'arm64')) {
    return {
      ok: false,
      reason: 'platform',
      message: 'Image takes are made on macOS with Apple silicon only.',
      fix: 'Images are made on a Mac with Apple silicon; there is nothing to install on this computer.',
    }
  }
  const missing = IMAGE_MODEL_IDS.map((id) => imageModel(id).command).filter(
    (command) => !machine.which(command),
  )
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'mflux',
      message: `mflux is not on the PATH, or is too old to have ${missing.join(' and ')}; mflux makes the image takes.`,
      fix: 'uv tool install --upgrade mflux (then start the studio again if it is still not found)',
    }
  }
  return { ok: true }
}

/** The command line of a take, and the file it writes. */
export interface MfluxCommand {
  /** The mflux command that makes this model's images. */
  program: string
  /** The arguments after it. */
  args: string[]
  out: string
}

/** The command and arguments of mflux for a take written to `out`; steps are the model's own. */
export function mfluxArguments(request: ImageRequest, out: string): MfluxCommand {
  const model = imageModel(request.model)
  return {
    program: model.command,
    args: [
      '--model', model.mflux,
      '--prompt', request.prompt,
      '--width', String(request.width),
      '--height', String(request.height),
      '--seed', String(request.seed),
      '--output', out,
    ], // prettier-ignore
    out,
  }
}

/** The process to start for a take: the model's command, then its arguments. */
export function mfluxCommandLine(c: MfluxCommand): { command: string[]; out: string } {
  return { command: [c.program, ...c.args], out: c.out }
}

/**
 * Image takes through mflux's command for the model, one process per take: the model loads for the take and
 * leaves memory with the process, so it never sits beside ACE-Step, Whisper or the other image
 * model, and every take starts with a clean MLX cache. `build` replaces the command (tests).
 */
export function createMfluxGenerator({
  build = mfluxCommandLine,
  machine = { which: (c) => Bun.which(c) !== null, platform: process.platform, arch: process.arch },
  timeoutMs = 30 * 60_000,
  hubDir = HUB_DIR,
}: {
  build?: (c: MfluxCommand) => { command: string[]; out: string }
  machine?: Machine
  timeoutMs?: number
  /** The folder of the Hugging Face downloads (tests). */
  hubDir?: string
} = {}): ImageGenerator {
  return {
    ready: () => mfluxReady(machine),
    installed: (model) => imageModelInstalled(hubDir, model),
    async generate(request, signal) {
      const problem = checkImageRequest(request)
      if (problem) throw new Error(problem)
      if (signal?.aborted) throw new Error('The image generator was stopped.')
      const { command, out } = build(
        mfluxArguments(request, join(tmpdir(), `content-studio-image-${randomUUID()}.png`)),
      )
      try {
        const proc = Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe' })
        let stopped = ''
        const stop = (why: string) => {
          stopped = why
          proc.kill()
        }
        const onAbort = () => stop('The image generator was stopped.')
        signal?.addEventListener('abort', onAbort, { once: true })
        const timer = setTimeout(
          () =>
            stop(
              `The image generator took longer than ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`,
            ),
          timeoutMs,
        )
        try {
          const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
          if (stopped) throw new Error(stopped)
          if (code === 137 || proc.signalCode === 'SIGKILL') {
            throw new Error(
              'The image generator was stopped by the computer, most likely because it ran out of memory. Close other programs, then Try again.',
            )
          }
          if (code !== 0) {
            const why = quietLines(stderr).trim().split('\n').slice(-3).join(' ')
            throw new Error(`The image generator failed (exit code ${code}): ${why}`)
          }
        } finally {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        }
        const png = await readFile(out).catch(() => null)
        if (!png) throw new Error('The image generator made no image.')
        return { png: new Uint8Array(png), seed: request.seed }
      } finally {
        await rm(out, { force: true })
      }
    },
  }
}

/**
 * One image take, in its turn on the GPU queue with music and Whisper: when it is its turn the idle
 * workers are closed and gone (`free`, by default `freeGpu`), so the model has the memory, and they start
 * again on their next request. A request that cannot be made is refused before it takes a turn.
 */
export async function makeImageTake(
  {
    generator,
    queue = gpuQueue(),
    free = freeGpu,
  }: { generator: ImageGenerator; queue?: Serial; free?: () => void | Promise<void> },
  request: ImageRequest,
  signal?: AbortSignal,
  /** Called when the take's turn comes, before the other workers are freed (the page shows "making" from then). */
  onTurn?: () => void,
): Promise<GeneratedImage> {
  const problem = checkImageRequest(request)
  if (problem) throw new Error(problem)
  return queue.run(GPU, async () => {
    // A take stopped while it waited must not cost the other workers their models.
    if (signal?.aborted) throw new Error('The image generator was stopped.')
    onTurn?.()
    await free()
    return generator.generate(request, signal)
  })
}
