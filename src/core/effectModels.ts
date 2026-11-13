import { WEIGHTS_ONLY_NEEDS, type HubNeeds } from './hubDownload'
import type { ImageDownload } from './imageModels'

/** The ids of the sound-effect models the studio makes takes with. */
export const EFFECT_MODEL_IDS = ['small-sfx', 'open-1'] as const

/** One of the local sound-effect models (§12, decision 9). */
export type EffectModelId = (typeof EFFECT_MODEL_IDS)[number]

/** The project's main effects model unless its file names another. */
export const DEFAULT_EFFECT_MODEL: EffectModelId = 'small-sfx'

/** Where a model's weights are looked for: the Hugging Face cache, or a folder in the Stable Audio folder. */
export type EffectModelSource = { kind: 'hub' } | { kind: 'folder'; folder: string }

/** A sound-effect model: its plain name and where its weights are downloaded from. */
export interface EffectModel {
  id: EffectModelId
  name: string
  /** A shorter name. */
  short: string
  /** The gated Hugging Face repository the weights are downloaded from. */
  repo: string
  /** What the model fetches from the repository besides its weights. */
  needs: HubNeeds
  /** About how many GB the weights take on disk. */
  gigabytes: number
  /** About how long one take takes, in seconds (§12, decision 9). */
  seconds: number
  /** Where the studio looks for the weights. */
  source: EffectModelSource
}

/** The sound-effect models, by id. */
export const EFFECT_MODELS: Record<EffectModelId, EffectModel> = {
  'small-sfx': {
    id: 'small-sfx',
    name: 'Stable Audio 3 Small SFX',
    short: 'Small SFX',
    repo: 'stabilityai/stable-audio-3-small-sfx',
    needs: WEIGHTS_ONLY_NEEDS,
    gigabytes: 6.5,
    seconds: 2,
    source: { kind: 'hub' },
  },
  'open-1': {
    id: 'open-1',
    name: 'Stable Audio Open 1.0',
    short: 'Open 1.0',
    repo: 'stabilityai/stable-audio-open-1.0',
    needs: WEIGHTS_ONLY_NEEDS,
    gigabytes: 5,
    seconds: 100,
    source: { kind: 'folder', folder: 'stable-audio-open-1.0' },
  },
}

/** The sound-effect model with this id. */
export function effectModel(id: EffectModelId): EffectModel {
  return EFFECT_MODELS[id]
}

/** How long a take takes, as a person reads it: "about 2 s a take", "about 100 s a take". */
export function effectPerTake(id: EffectModelId): string {
  return `about ${EFFECT_MODELS[id].seconds} s a take`
}

/** What a model's menu entry needs to know: its download, and whether its last effect failed. */
export interface EffectModelState {
  download: ImageDownload
  failed: boolean
}

/** The warning beside a model: "not on this computer", "download incomplete", "last effect failed"; null when well. */
export function effectWarning(state: EffectModelState): string | null {
  if (state.download === 'absent') return 'not on this computer'
  if (state.download === 'partial') return 'download incomplete'
  return state.failed ? 'last effect failed' : null
}

/** A model's entry in a menu, closed or open: its full name and time, then what is wrong with it, if anything. */
export function effectMenuEntry(id: EffectModelId, state: EffectModelState): string {
  const entry = `${EFFECT_MODELS[id].name} — ${effectPerTake(id)}`
  const warning = effectWarning(state)
  return warning ? `${entry} — ${warning}` : entry
}

/**
 * The model an effect's new takes start on: the project's when it can run and its last effect did
 * not fail; else the other when that is in place and well; else a whole model even if its last
 * effect failed (the project's first); else the project's. Without uv nothing can run: the project's.
 */
export function defaultEffectModel(
  main: EffectModelId,
  states: Record<EffectModelId, EffectModelState>,
  uv: boolean,
): EffectModelId {
  if (!uv) return main
  const order = [main, ...EFFECT_MODEL_IDS.filter((id) => id !== main)]
  const whole = order.filter((id) => states[id].download === 'whole')
  return whole.find((id) => !states[id].failed) ?? whole[0] ?? main
}

/** The faint line on an effect's page when new takes start on the other model, and why. */
export function effectSwitchedLine(
  main: EffectModelId,
  to: EffectModelId,
  reason: 'absent' | 'partial' | 'failed',
): string {
  const what = {
    absent: "isn't on this computer",
    partial: 'is only partly downloaded',
    failed: 'failed on its last effect',
  }[reason]
  const then = {
    absent: 'how to download it',
    partial: 'how to finish it',
    failed: 'what went wrong',
  }[reason]
  return `${EFFECT_MODELS[main].name}, the project's sound-effects model, ${what}, so these takes use ${EFFECT_MODELS[to].name}. Setup says ${then}.`
}

/** The heading of the box shown when saving the project's effects model failed. */
export function effectSaveFailureHeading(id: EffectModelId): string {
  return `${EFFECT_MODELS[id].name} could not be saved as the sound-effects model.`
}
