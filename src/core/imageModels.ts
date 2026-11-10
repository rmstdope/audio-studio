import { perTakeText, timeKeyOfEdit, type Figures } from './takeTimes'

/** The ids of the image models the studio makes takes with. */
export const IMAGE_MODEL_IDS = ['klein', 'z-image-turbo', 'qwen-image'] as const

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
  /** The built-in model mflux should treat `mflux` as, when `mflux` is a repository name. */
  base?: string
  /** Quantization bits and steps, when the model needs them to fit a 48 GB Mac and to do the job. */
  quantize?: number
  steps?: number
  /** How closely the edit follows the words, when the model's advice differs from mflux's default. */
  guidance?: number
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
  },
  'z-image-turbo': {
    id: 'z-image-turbo',
    name: 'Z-Image-Turbo',
    short: 'Z-Image-Turbo',
    repo: 'Tongyi-MAI/Z-Image-Turbo',
    gigabytes: 31,
    mflux: 'z-image-turbo',
    command: 'mflux-generate-z-image-turbo',
  },
  'qwen-image': {
    id: 'qwen-image',
    name: 'Qwen-Image',
    short: 'Qwen-Image',
    repo: 'Qwen/Qwen-Image',
    gigabytes: 54,
    // mflux's own alias `qwen-image` is the 2512 weights, which are not the ones downloaded.
    mflux: 'Qwen/Qwen-Image',
    base: 'qwen-image',
    command: 'mflux-generate-qwen',
    quantize: 4,
    steps: 20,
  },
}

/** The mflux command that changes an existing picture from an instruction; FLUX.2 klein's own. */
export const IMAGE_EDIT_COMMAND = 'mflux-generate-flux2-edit'

/** The ids of the models a patch's takes are made with, the one they start on first. */
export const EDIT_MODEL_IDS = ['klein', 'qwen-edit'] as const

/** One of the models that change a picture from an instruction (patches, §8.7). */
export type EditModelId = (typeof EDIT_MODEL_IDS)[number]

/**
 * The model patch takes are made with unless another is picked: klein, which removed things
 * cleanly in a trial where Qwen Image Edit did not (as-jgto).
 */
export const DEFAULT_EDIT_MODEL: EditModelId = 'klein'

/** An edit model: its names, its weights and how mflux runs it to change a picture. */
export interface EditModel {
  id: EditModelId
  name: string
  /** A shorter name, for a menu when closed. */
  short: string
  /** The Hugging Face repository the weights are downloaded from. */
  repo: string
  /** About how many GB the weights take on disk. */
  gigabytes: number
  /** The `--model` value of the model's mflux command. */
  mflux: string
  /** The built-in model mflux should treat `mflux` as, when `mflux` is a repository name. */
  base?: string
  /** The mflux command that edits a picture with this model. */
  command: string
  /** Quantization bits and steps, when the model needs them to fit and to do the job. */
  quantize?: number
  steps?: number
}

/** The edit models, by id. */
export const EDIT_MODELS: Record<EditModelId, EditModel> = {
  'qwen-edit': {
    id: 'qwen-edit',
    name: 'Qwen Image Edit',
    short: 'Qwen Image Edit',
    // mflux runs Qwen edits the way the 2509 and 2511 weights were made (a 384 × 384 view of the
    // picture); the first weights, run that way, paint a new scene instead of editing (as-3l6k).
    repo: 'Qwen/Qwen-Image-Edit-2511',
    gigabytes: 58,
    // mflux's own alias `qwen-image-edit` downloads the 2509 weights, so the repository is named.
    mflux: 'Qwen/Qwen-Image-Edit-2511',
    base: 'qwen-image-edit',
    command: 'mflux-generate-qwen-edit',
    // Unquantized it does not fit a 48 GB Mac; 8 bits peaks near 38 GB.
    quantize: 8,
    // The weights' own advice: 40 steps, guidance 4 (mflux's default is 2.5).
    steps: 40,
    guidance: 4,
  },
  klein: {
    id: 'klein',
    name: IMAGE_MODELS.klein.name,
    short: IMAGE_MODELS.klein.short,
    repo: IMAGE_MODELS.klein.repo,
    gigabytes: IMAGE_MODELS.klein.gigabytes,
    mflux: IMAGE_MODELS.klein.mflux,
    command: IMAGE_EDIT_COMMAND,
  },
}

/** The edit model with this id. */
export function editModel(id: EditModelId): EditModel {
  return EDIT_MODELS[id]
}

/** Whether an id names an edit model. */
export function isEditModel(id: string): id is EditModelId {
  return (EDIT_MODEL_IDS as readonly string[]).includes(id)
}

/** How long an edit take takes, as a person reads it: "about 8 min a take", "a guess: …". */
export function editPerTake(id: EditModelId, figures: Figures): string {
  return perTakeText(figures[timeKeyOfEdit(id)])
}

/** An edit model's entry in an open menu: name and time, then what is wrong with it, if anything. */
export function editMenuEntry(id: EditModelId, state: ImageModelState, figures: Figures): string {
  const entry = `${EDIT_MODELS[id].name} — ${editPerTake(id, figures)}`
  const warning = imageWarning(state)
  return warning ? `${entry} — ${warning}` : entry
}

/** An edit model's entry in a closed menu: its short name and time. */
export function editShortEntry(id: EditModelId, figures: Figures): string {
  return `${EDIT_MODELS[id].short} — ${editPerTake(id, figures)}`
}

/**
 * The model a patch menu starts on: klein, unless klein is not whole and Qwen Image Edit is (a
 * project whose own image model is another one), so a menu never opens on a model that cannot work
 * while the other could.
 */
export function startEditModel(
  downloads: Partial<Record<EditModelId, ImageDownload>>,
): EditModelId {
  return downloads[DEFAULT_EDIT_MODEL] !== 'whole' && downloads['qwen-edit'] === 'whole'
    ? 'qwen-edit'
    : DEFAULT_EDIT_MODEL
}

/** The line under the Make row when a model that is not on this computer is picked. */
export const EDIT_SETUP_LINE = 'Setup says how to download it.'

/** Why a patch take failed, as one plain sentence naming the model and the cause. */
export function editFailureReason(id: EditModelId, code: number, stderr: string): string {
  const { name, repo } = EDIT_MODELS[id]
  const last = stderr.trim().split('\n').at(-1) ?? ''
  if (/safetensors|huggingface|snapshots/i.test(last)) {
    return `${name} could not load its weights: they are missing or incomplete on this computer; download them again with uvx --from huggingface_hub hf download ${repo}, then try again.`
  }
  if (/invalid choice|unrecognized arguments|error: argument/i.test(stderr)) {
    return `The installed mflux cannot make ${name} takes; update it with uv tool install --upgrade mflux, then try again.`
  }
  return `${name} could not make the take (mflux stopped with exit code ${code}); the details are in the studio's log.`
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

/** How long a take takes, as a person reads it: "about 25 s a take", "a guess: about 1 min a take". */
export function perTake(id: ImageModelId, figures: Figures): string {
  return perTakeText(figures[id])
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
export function imageMenuEntry(id: ImageModelId, state: ImageModelState, figures: Figures): string {
  const entry = `${IMAGE_MODELS[id].name} — ${perTake(id, figures)}`
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
export function imageShortEntry(id: ImageModelId, figures: Figures): string {
  return `${IMAGE_MODELS[id].short} — ${perTake(id, figures)}`
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
