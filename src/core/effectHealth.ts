import { z } from 'zod'
import { EFFECT_MODEL_IDS } from './effectModels'

/** Where the studio remembers which effect models failed their last effect, relative to the project root. */
export const EFFECT_HEALTH_FILE = '.content-studio/effect-model-health.json'

/** The last effect of a model that failed: what the tool said, and when. */
export const EffectFailureSchema = z.object({
  /** The last line of the effects tool's error, verbatim. */
  error: z.string(),
  at: z.string(),
})

/** The last failed effect of a model. */
export type EffectFailure = z.infer<typeof EffectFailureSchema>

/** The studio's memory of effect models whose last effect failed; a model that is not there has no failure. */
export const EffectHealthSchema = z.object({
  models: z.partialRecord(z.enum(EFFECT_MODEL_IDS), EffectFailureSchema).default({}),
})

/** The contents of `EFFECT_HEALTH_FILE`. */
export type EffectHealth = z.infer<typeof EffectHealthSchema>
