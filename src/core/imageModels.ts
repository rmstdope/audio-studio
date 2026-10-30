/** The ids of the image models the studio makes takes with. */
export const IMAGE_MODEL_IDS = ['klein', 'z-image-turbo'] as const

/** One of the local image models (§13, decision 8). */
export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number]

/** The project's main model unless its file names another. */
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'klein'

/** An image model: its plain name and the name mflux knows it by. */
export interface ImageModel {
  id: ImageModelId
  name: string
  /** A shorter name, for an image's menu when closed. */
  short: string
  /** The Hugging Face repository the weights are downloaded from. */
  repo: string
  /** About how many GB the weights take on disk. */
  gigabytes: number
  /** The `--model` value of the model's mflux command. */
  mflux: string
  /** The mflux command that makes this model's images (mflux has one per model family). */
  command: string
  /** About how long one take takes, in seconds (a guess from the spike's timings and the model's load). */
  seconds: number
}

/** The image models, by id. */
export const IMAGE_MODELS: Record<ImageModelId, ImageModel> = {
  klein: {
    id: 'klein',
    name: 'FLUX.2 klein 4B',
    short: 'FLUX.2 klein',
    repo: 'black-forest-labs/FLUX.2-klein-4B',
    gigabytes: 15,
    mflux: 'flux2-klein-4b',
    command: 'mflux-generate-flux2',
    seconds: 8,
  },
  'z-image-turbo': {
    id: 'z-image-turbo',
    name: 'Z-Image-Turbo',
    short: 'Z-Image-Turbo',
    repo: 'Tongyi-MAI/Z-Image-Turbo',
    gigabytes: 31,
    mflux: 'z-image-turbo',
    command: 'mflux-generate-z-image-turbo',
    seconds: 60,
  },
}

/** The image model with this id. */
export function imageModel(id: ImageModelId): ImageModel {
  return IMAGE_MODELS[id]
}

/** The image model whose mflux name this is, or null for a name the studio does not know. */
export function imageByMflux(name: string): ImageModelId | null {
  return IMAGE_MODEL_IDS.find((id) => IMAGE_MODELS[id].mflux === name) ?? null
}

/**
 * Why a take failed, as one plain sentence naming the model and the cause, from mflux's exit code
 * and its error output (which itself belongs in the studio's log, not in front of the user).
 */
export function imageFailureReason(id: ImageModelId, code: number, stderr: string): string {
  const { name, repo } = IMAGE_MODELS[id]
  // The exception is the last line; only a missing file of the downloaded weights is about them.
  const last = stderr.trim().split('\n').at(-1) ?? ''
  if (/safetensors|huggingface|snapshots/i.test(last)) {
    return `${name} could not load its weights: they are missing or incomplete on this computer; download them again with uvx --from huggingface_hub hf download ${repo}, then Try again.`
  }
  if (/invalid choice|unrecognized arguments|error: argument/i.test(stderr)) {
    return `The installed mflux cannot make ${name} images; update it with uv tool install --upgrade mflux, then Try again.`
  }
  return `${name} could not make the image (mflux stopped with exit code ${code}); the details are in the studio's log.`
}

/** How long a take takes, as a person reads it: "about 8 s a take", "about 1 min a take". */
export function perTake(id: ImageModelId): string {
  const { seconds } = IMAGE_MODELS[id]
  return `about ${seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`} a take`
}

/** How much of a model's download is on this computer. */
export type ImageDownload = 'whole' | 'partial' | 'absent'

/** What a model's menu entry needs to know: its download, and whether its last take failed. */
export interface ImageModelState {
  download: ImageDownload
  failed: boolean
}

/**
 * A model's entry in an open menu: its name and time, then what is wrong with it, if anything:
 * "not on this computer", "download incomplete" or "last take failed" (a model that is not whole
 * is marked by its download, not by a failure).
 */
export function imageMenuEntry(id: ImageModelId, state: ImageModelState): string {
  const entry = `${IMAGE_MODELS[id].name} — ${perTake(id)}`
  const warning = imageWarning(state)
  return warning ? `${entry} — ${warning}` : entry
}

/** The warning beside a menu that has this model shown, or null when it is whole and well. */
export function imageWarning(state: ImageModelState): string | null {
  if (state.download === 'absent') return 'not on this computer'
  if (state.download === 'partial') return 'download incomplete'
  return state.failed ? 'last take failed' : null
}

/** A model's entry in an image's closed menu: its short name and time. */
export function imageShortEntry(id: ImageModelId): string {
  return `${IMAGE_MODELS[id].short} — ${perTake(id)}`
}

/** The heading of the box shown when saving the project's image model failed. */
export function imageSaveFailureHeading(id: ImageModelId): string {
  return `${IMAGE_MODELS[id].name} could not be saved as the image model.`
}

/** The body of the box shown when saving the project's image model failed: the file, and why. */
export function imageSaveFailureBody(file: string, reason: string): string {
  return `${file} could not be written: ${reason}. Nothing was changed.`
}

/**
 * The model an image's new takes start on: the project's main model when it is whole and its last
 * take did not fail; else the other when that is in place; else a whole model even if its last take
 * failed (the main one first); else the main model.
 */
export function defaultTakeModel(
  main: ImageModelId,
  states: Record<ImageModelId, ImageModelState>,
): ImageModelId {
  const order = [main, ...IMAGE_MODEL_IDS.filter((id) => id !== main)]
  const whole = order.filter((id) => states[id].download === 'whole')
  return whole.find((id) => !states[id].failed) ?? whole[0] ?? main
}

/** The faint line on an image's page when new takes start on the other model because the main one failed its last take. */
export function imageSwitchedLine(main: ImageModelId, to: ImageModelId): string {
  return `${IMAGE_MODELS[main].short}, the project's image model, failed on its last take, so these takes use ${IMAGE_MODELS[to].name}. Setup says what went wrong.`
}

/** The largest side of an image take, in pixels. */
export const MAX_IMAGE_SIDE = 2048

/**
 * What stops these inputs making a take, in a sentence, or null when they are fine: a prompt,
 * sides that are multiples of 16 up to `MAX_IMAGE_SIDE`, a whole non-negative seed.
 */
export function checkImageRequest(r: {
  prompt: string
  width: number
  height: number
  seed: number
}): string | null {
  if (!r.prompt.trim()) return 'The prompt is empty.'
  for (const [name, side] of [
    ['width', r.width],
    ['height', r.height],
  ] as const) {
    if (!Number.isInteger(side) || side <= 0 || side > MAX_IMAGE_SIDE || side % 16 !== 0)
      return `The ${name} must be a multiple of 16 from 16 to ${MAX_IMAGE_SIDE}.`
  }
  if (!Number.isInteger(r.seed) || r.seed < 0) return 'The seed must be a whole number, 0 or more.'
  return null
}
