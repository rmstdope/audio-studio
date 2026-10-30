/** The ids of the image models the studio makes takes with. */
export const IMAGE_MODEL_IDS = ['klein', 'z-image-turbo'] as const

/** One of the local image models (§13, decision 8). */
export type ImageModelId = (typeof IMAGE_MODEL_IDS)[number]

/** The model takes are made with until the user can choose (as-yag.7). */
export const DEFAULT_IMAGE_MODEL: ImageModelId = 'klein'

/** An image model: its plain name and the name mflux knows it by. */
export interface ImageModel {
  id: ImageModelId
  name: string
  /** The `--model` value of `mflux-generate`. */
  mflux: string
  /** About how long one take takes, in seconds (a guess from the spike's timings and the model's load). */
  seconds: number
}

/** The image models, by id. */
export const IMAGE_MODELS: Record<ImageModelId, ImageModel> = {
  klein: { id: 'klein', name: 'FLUX.2 klein 4B', mflux: 'flux2-klein-4b', seconds: 30 },
  'z-image-turbo': { id: 'z-image-turbo', name: 'Z-Image-Turbo', mflux: 'z-image-turbo', seconds: 60 },
}

/** The image model with this id. */
export function imageModel(id: ImageModelId): ImageModel {
  return IMAGE_MODELS[id]
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
