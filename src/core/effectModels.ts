/** The ids of the sound-effect models the studio makes takes with. */
export const EFFECT_MODEL_IDS = ['small-sfx'] as const

/** One of the local sound-effect models (§13, decision 9). */
export type EffectModelId = (typeof EFFECT_MODEL_IDS)[number]

/** A sound-effect model: its plain name and where its weights are downloaded from. */
export interface EffectModel {
  id: EffectModelId
  name: string
  /** A shorter name. */
  short: string
  /** The gated Hugging Face repository the weights are downloaded from. */
  repo: string
  /** About how many GB the weights take on disk. */
  gigabytes: number
}

/** The sound-effect models, by id. */
export const EFFECT_MODELS: Record<EffectModelId, EffectModel> = {
  'small-sfx': {
    id: 'small-sfx',
    name: 'Stable Audio 3 Small SFX',
    short: 'Small SFX',
    repo: 'stabilityai/stable-audio-3-small-sfx',
    gigabytes: 6.5,
  },
}

/** The sound-effect model with this id. */
export function effectModel(id: EffectModelId): EffectModel {
  return EFFECT_MODELS[id]
}
