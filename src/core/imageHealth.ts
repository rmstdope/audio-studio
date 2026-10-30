import { z } from 'zod'
import { IMAGE_MODEL_IDS } from './imageModels'

/** Where the studio remembers which image models failed their last take, relative to the project root. */
export const IMAGE_HEALTH_FILE = '.content-studio/image-model-health.json'

/** The last take of a model that failed: where, and what the image tool said. */
export const ImageFailureSchema = z.object({
  /** The image the take was made on. */
  image: z.string(),
  take: z.number().int(),
  /** The last line of the image tool's error, verbatim. */
  error: z.string(),
  at: z.string(),
})

/** The last failed take of a model. */
export type ImageFailure = z.infer<typeof ImageFailureSchema>

/** The studio's memory of image models whose last take failed; a model that is not there has no failure. */
export const ImageHealthSchema = z.object({
  models: z.partialRecord(z.enum(IMAGE_MODEL_IDS), ImageFailureSchema).default({}),
})

/** The contents of `IMAGE_HEALTH_FILE`. */
export type ImageHealth = z.infer<typeof ImageHealthSchema>
