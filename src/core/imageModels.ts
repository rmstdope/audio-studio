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
  /** The `--model` value of `mflux-generate`. */
  mflux: string
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
    seconds: 8,
  },
  'z-image-turbo': {
    id: 'z-image-turbo',
    name: 'Z-Image-Turbo',
    short: 'Z-Image-Turbo',
    repo: 'Tongyi-MAI/Z-Image-Turbo',
    gigabytes: 31,
    mflux: 'z-image-turbo',
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

/** How long a take takes, as a person reads it: "about 8 s a take", "about 1 min a take". */
export function perTake(id: ImageModelId): string {
  const { seconds } = IMAGE_MODELS[id]
  return `about ${seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${seconds} s`} a take`
}

/** A model's entry in an open menu: its name and time, and "not on this computer" when it is missing. */
export function imageMenuEntry(id: ImageModelId, installed: boolean): string {
  const entry = `${IMAGE_MODELS[id].name} — ${perTake(id)}`
  return installed ? entry : `${entry} — not on this computer`
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
 * The model an image's new takes start on: the project's main model, or, when it is not on this
 * computer and the other is, the other one.
 */
export function defaultTakeModel(
  main: ImageModelId,
  installed: Record<ImageModelId, boolean>,
): ImageModelId {
  if (installed[main]) return main
  return IMAGE_MODEL_IDS.find((id) => installed[id]) ?? main
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
