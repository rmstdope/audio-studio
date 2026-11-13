import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkImageRequest,
  EDIT_MODELS,
  IMAGE_EDIT_COMMAND,
  editFailureReason,
  imageFailureReason,
  imageModel,
  isEditModel,
  type EditModelId,
  type ImageDownload,
  type ImageModelId,
} from '../core/imageModels'
import { freeGpu, gpuQueue, holdGpu, GPU } from './gpu'
import { quietLines } from './lineWorker'
import { HUB_DIR, hubDownload } from './hubCache'
import { killGroup, stopWithStudio } from './stopWithStudio'
import type { Serial } from './serial'
import type { Machine } from './setup'

/** What an image take is made from. */
export interface ImageRequest {
  prompt: string
  /** Pixels; a multiple of 16. */
  width: number
  height: number
  seed: number
  /** The model to make it with; an edit model changes the picture in `editing`. */
  model: ImageModelId | EditModelId
  /** The path of a picture to change, the prompt then being the instruction; none makes a new one. */
  editing?: string
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
  installed(model: ImageModelId | EditModelId): boolean | Promise<boolean>
  /** How much of this model's download is here; a generator without it is whole or absent by `installed`. */
  download?(model: ImageModelId | EditModelId): ImageDownload | Promise<ImageDownload>
  /** Whether a picture can be edited here with this edit model (klein by default); a generator without it can. */
  canEdit?(model?: EditModelId): boolean | Promise<boolean>
  /** One take; the model loads for it and leaves memory when it is made. Aborting ends it, and it rejects. */
  generate(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage>
}

/** How much of a model's download the generator says is here. */
export async function downloadOf(
  generator: Pick<ImageGenerator, 'installed' | 'download'>,
  model: ImageModelId | EditModelId,
): Promise<ImageDownload> {
  if (generator.download) return generator.download(model)
  return (await generator.installed(model)) ? 'whole' : 'absent'
}

/** A take that the image tool (mflux) ended with an error: the sentence for the page, and the tool's own last line. */
export class ImageToolError extends Error {
  constructor(
    message: string,
    /** The last line of the tool's error output, verbatim. */
    readonly lastLine: string,
  ) {
    super(message)
    this.name = 'ImageToolError'
  }
}

/** How much of an image model's download is in the Hugging Face cache `hubDir` (see `hubDownload`). */
export function imageModelDownload(
  hubDir: string,
  model: ImageModelId | EditModelId,
): ImageDownload {
  const { repo, needs } = isEditModel(model)
    ? EDIT_MODELS[model]
    : imageModel(model as ImageModelId)
  return hubDownload(hubDir, repo, needs)
}

/** Whether a model's whole download is in the Hugging Face cache `hubDir`. */
export function imageModelInstalled(hubDir: string, model: ImageModelId | EditModelId): boolean {
  return imageModelDownload(hubDir, model) === 'whole'
}

/** The models whose mflux commands must exist for mflux to count as installed. */
const REQUIRED_COMMAND_MODELS = ['klein', 'z-image-turbo'] as const

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
  // Qwen-Image's command is not needed to run the other two: an mflux too old for it fails its takes.
  const missing = REQUIRED_COMMAND_MODELS.map((id) => imageModel(id).command).filter(
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
  if (request.editing && isEditModel(request.model)) {
    const edit = EDIT_MODELS[request.model]
    return {
      program: edit.command,
      args: [
        '--model', edit.mflux,
        ...(edit.base ? ['--base-model', edit.base] : []),
        ...(edit.quantize ? ['--quantize', String(edit.quantize)] : []),
        ...(edit.steps ? ['--steps', String(edit.steps)] : []),
        ...(edit.guidance ? ['--guidance', String(edit.guidance)] : []),
        '--image-paths', request.editing,
        '--prompt', request.prompt,
        '--width', String(request.width),
        '--height', String(request.height),
        '--seed', String(request.seed),
        '--output', out,
      ], // prettier-ignore
      out,
    }
  }
  const model = imageModel(request.model as ImageModelId)
  return {
    program: request.editing ? IMAGE_EDIT_COMMAND : model.command,
    args: [
      '--model', model.mflux,
      ...(!request.editing && model.base ? ['--base-model', model.base] : []),
      ...(!request.editing && model.quantize ? ['--quantize', String(model.quantize)] : []),
      ...(!request.editing && model.steps ? ['--steps', String(model.steps)] : []),
      ...(request.editing ? ['--image-paths', request.editing] : []),
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
  log = (line: string) => console.error(line),
}: {
  build?: (c: MfluxCommand) => { command: string[]; out: string }
  machine?: Machine
  timeoutMs?: number
  /** The folder of the Hugging Face downloads (tests). */
  hubDir?: string
  /** Where mflux's own error output goes when a take fails: the server's log (tests). */
  log?: (line: string) => void
} = {}): ImageGenerator {
  return {
    ready: () => mfluxReady(machine),
    installed: (model) => imageModelInstalled(hubDir, model),
    canEdit: (model = 'klein') => machine.which(EDIT_MODELS[model].command),
    download: (model) => imageModelDownload(hubDir, model),
    async generate(request, signal) {
      const problem = checkImageRequest(request)
      if (problem) throw new Error(problem)
      if (signal?.aborted) throw new Error('The image generator was stopped.')
      const { command, out } = build(
        mfluxArguments(request, join(tmpdir(), `content-studio-image-${randomUUID()}.png`)),
      )
      try {
        const proc = (() => {
          try {
            return Bun.spawn(command, { stdout: 'ignore', stderr: 'pipe', detached: true })
          } catch {
            // The program is not there: an mflux too old to have this model's command.
            const what = request.editing
              ? 'patches'
              : `${imageModel(request.model as ImageModelId).name} images`
            throw new Error(
              `The installed mflux cannot make ${what}; update it with uv tool install --upgrade mflux, then Try again.`,
            )
          }
        })()
        const forget = stopWithStudio(proc.pid)
        void proc.exited.then(forget)
        let stopped = ''
        const stop = (why: string) => {
          stopped = why
          killGroup(proc.pid, 'SIGTERM')
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
            const output = quietLines(stderr).trim()
            log(`Content Studio: ${command[0]} failed (exit code ${code}):\n${output}`)
            throw new ImageToolError(
              request.editing && isEditModel(request.model)
                ? editFailureReason(request.model, code, output)
                : imageFailureReason(request.model as ImageModelId, code, output),
              output.split('\n').at(-1) ?? '',
            )
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
  /** Run first in its turn, before `onTurn`: what the request needs on disk (an edit's working file). */
  prepare?: () => void | Promise<void>,
): Promise<GeneratedImage> {
  const problem = checkImageRequest(request)
  if (problem) throw new Error(problem)
  return queue.run(GPU, async () => {
    // A take stopped while it waited must not cost the other workers their models.
    if (signal?.aborted) throw new Error('The image generator was stopped.')
    return holdGpu('image', async () => {
      await prepare?.()
      onTurn?.()
      await free()
      return generator.generate(request, signal)
    })
  })
}
