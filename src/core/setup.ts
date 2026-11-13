import type { z } from 'zod'
import {
  EFFECT_MODEL_IDS,
  effectModel,
  type EffectModelId,
  type EffectModelSource,
} from './effectModels'
import {
  EDIT_MODELS,
  IMAGE_MODEL_IDS,
  imageModel,
  type ImageDownload,
  type ImageModelId,
} from './imageModels'
import { MUSIC_MODELS, musicModel, type MusicModelId } from './musicModels'
import type { FishTierSchema } from './project'

/** The name of the variable that holds the Fish Audio API key (`services/env.ts` reads it). */
const FISH_KEY = 'FISH_AUDIO_API_KEY'

/** The name of the variable that holds the ElevenLabs API key (`services/env.ts` reads it). */
const ELEVENLABS_KEY = 'ELEVENLABS_API_KEY'

/** An ElevenLabs account, as `GET /v1/user/subscription` describes it (`services/elevenlabs.ts`). */
export interface ElevenAccount {
  /** The plan, as ElevenLabs names it (`free`, `starter`, `creator`, …). */
  tier: string
  /** Credits used this period (`character_count`: a character costs a credit or less). */
  charactersUsed: number
  /** Credits the plan includes this period (`character_limit`). */
  characterLimit: number
  /** When the characters renew (Unix seconds), if ElevenLabs says. */
  renewsAt: number | null
  /** Credits that may be used beyond the plan, billed in dollars: 0 is none. */
  overage: number | 'unlimited'
  /** The plan's voice slots: how many are in use, and how many it has. */
  voiceSlots: { used: number; limit: number }
}

/** What asking ElevenLabs for the account gave. */
export type ElevenAnswer =
  | { ok: true; account: ElevenAccount }
  | { ok: false; reason: 'no-key' | 'elevenlabs'; message: string }

/** What asking Fish for the account's credit gave: the shape of `services/fish.ts`'s `CreditResult`. */
export type FishAnswer =
  | { ok: true; credit: number }
  | { ok: false; reason: 'no-key' | 'fish' | 'project'; message: string }

/** What the user has paid Fish in total, which sets its requests-at-once limit. */
export type FishTier = z.infer<typeof FishTierSchema>

/** Fish's published tiers: the menu's words and how many requests each allows at once. */
export const FISH_TIERS: readonly { value: FishTier; label: string; limit: number }[] = [
  { value: 'under-100', label: 'Under $100 — 5 at once', limit: 5 },
  { value: '100', label: '$100 or more — 15 at once', limit: 15 },
  { value: '1000', label: '$1,000 or more — 50 at once', limit: 50 },
]

/** What every Fish account allows at once. */
const EVERY_ACCOUNT = 5

/** What the setup checks are made from: the machine, the project file and Fish, as found. */
export interface SetupFacts {
  /** `ffmpeg` is on the PATH. */
  ffmpeg: boolean
  /** `uv` is on the PATH (runs the Whisper worker). */
  uv: boolean
  /** macOS on Apple silicon, which mlx-whisper needs. */
  appleSilicon: boolean
  transcriber: 'mlx-whisper' | 'none'
  whisperModel: string
  /** The project's env file, where the API key is looked for. */
  envPath: string
  /** A Fish Audio API key was found (environment or env file). */
  key: boolean
  /** What asking Fish for the account's credit gave (not asked without a key). */
  fish: FishAnswer
  /** The project file names a `refresh.part` command. */
  refreshPart: boolean
  /** The project's `generate.parallel`: requests recording sends to Fish at a time. */
  parallel: number
  /** The tier the user told the studio (the setting `fishTier`), or none. */
  fishTier: FishTier | null
  /** The music generator, or null when the project has no `music` section. */
  music: {
    ready: { ok: true } | { ok: false; message: string; fix: string }
    checkpoints: string
    /** The project's music model. */
    model: MusicModelId
    /** The Stable Audio models that are not in `~/.cache/stable-audio`. */
    stableAudioMissing: MusicModelId[]
  } | null
  /** The image models, or null when the project has no `images` section. */
  images: {
    /** Whether mflux, which runs them, can run here. */
    mflux: { ok: true } | { ok: false; reason: 'platform' | 'mflux'; message: string; fix: string }
    /** The project's main image model. */
    model: ImageModelId
    /** How much of the optional patch model, Qwen Image Edit, is here: it only makes patches. */
    patchModel: ImageDownload
    /** Each image model: how much of its download is here, and its last take if that failed. */
    models: Record<
      ImageModelId,
      {
        download: ImageDownload
        failure: {
          /** The last line of the image tool's error. */
          error: string
          /** The image the take was made on, or null once it is not in the game's lists. */
          image: { id: string; title: string } | null
        } | null
      }
    >
  } | null
  /** The sound-effect models and uv, which runs them; always checked, since no project section is needed. */
  effects: {
    uv: boolean
    /** Whether the game lists any sound effects; before that the check is optional. */
    listed: boolean
    /** The project's main effects model. */
    model: EffectModelId
    /** Each effect model: how much of its download is here, and its last effect if that failed. */
    models: Record<
      EffectModelId,
      {
        download: ImageDownload
        failure: {
          /** The last line of the effects tool's error. */
          error: string
          /** The effect the take was made on, or null once it is not in the game's list. */
          effect: { id: string; title: string } | null
        } | null
      }
    >
  }
  /** What asking ElevenLabs for the account gave (not asked without its key). */
  elevenlabs: ElevenAnswer
}

/** One numbered step: text with links in it, and commands to copy after it. */
export interface SetupStep {
  parts: (string | { link: string; href: string })[]
  commands?: string[]
  /** Text after the commands, on the same step. */
  after?: string
}

/**
 * One check: ok, a problem with how to fix it, or off (not needed as the project is set up, or
 * optional and not set).
 */
export interface SetupCheck {
  id:
    | 'ffmpeg'
    | 'whisper'
    | 'key'
    | 'fish'
    | 'requests'
    | 'refresh'
    | 'music'
    | 'stableAudio'
    | 'imageModels'
    | 'effectModels'
    | 'elevenlabsKey'
    | 'elevenlabs'
  title: string
  state: 'ok' | 'problem' | 'off'
  /** What was found, in a sentence. */
  detail: string
  /** What to do about a problem: a command or a setting. */
  fix?: string
  /** Replaces the state's own word ("Not used") on the row, when another says it better. */
  label?: string
  /** Image models whose last take failed: a sentence, the tool's error line, a link to the image, and what clears it. */
  failures?: {
    sentence: string
    error: string
    link?: { text: string; href: string }
    clears: string
  }[]
  /** Further lines under the detail, each a sentence. */
  notes?: string[]
  /** Numbered steps to put it right, with the note under them. */
  steps?: { list: SetupStep[]; note: string }
  /** The account's credit in dollars, when Fish answered. */
  credit?: number
  /** Set when the row offers the tier menu: the tier chosen so far. */
  tier?: { chosen: FishTier | null }
}

/**
 * Everything the studio needs on this machine and in the project, each checked and explained: so
 * the first run says what to install or set instead of failing on the first recording.
 */
export function setupChecks(facts: SetupFacts): SetupCheck[] {
  return [
    ffmpeg(facts),
    whisper(facts),
    key(facts),
    fish(facts),
    requests(facts),
    refresh(facts),
    music(facts),
    stableAudio(facts),
    imageModels(facts),
    effectModels(facts),
    elevenlabsKey(facts),
    elevenlabs(facts),
  ]
}

function ffmpeg(facts: SetupFacts): SetupCheck {
  return facts.ffmpeg
    ? { id: 'ffmpeg', title: 'ffmpeg', state: 'ok', detail: 'Found: clips can be encoded.' }
    : {
        id: 'ffmpeg',
        title: 'ffmpeg',
        state: 'problem',
        detail: 'Not found on the PATH. Recording a line needs it to encode and level the clip.',
        fix: 'brew install ffmpeg (then start the studio again if it is still not found)',
      }
}

function whisper(facts: SetupFacts): SetupCheck {
  const title = 'Whisper (checks what each take says)'
  if (facts.transcriber === 'none') {
    return {
      id: 'whisper',
      title,
      state: 'off',
      detail:
        'The project sets generate.transcriber to "none": one take a line, not checked, with word timings spread evenly.',
    }
  }
  if (!facts.appleSilicon) {
    return {
      id: 'whisper',
      title,
      state: 'problem',
      detail: 'mlx-whisper runs on macOS with Apple silicon only; this is not such a machine.',
      fix: 'Set generate.transcriber to "none" in the project file to record without checking.',
    }
  }
  if (!facts.uv) {
    return {
      id: 'whisper',
      title,
      state: 'problem',
      detail: 'uv is not on the PATH. It runs the Whisper worker and installs mlx-whisper for it.',
      fix: 'brew install uv (then start the studio again if it is still not found)',
    }
  }
  return {
    id: 'whisper',
    title,
    state: 'ok',
    detail: `uv found; ${facts.whisperModel} is downloaded on the first take, which takes a while.`,
  }
}

function key(facts: SetupFacts): SetupCheck {
  return facts.key
    ? { id: 'key', title: 'Fish Audio API key', state: 'ok', detail: 'Found.' }
    : {
        id: 'key',
        title: 'Fish Audio API key',
        state: 'problem',
        detail: `No ${FISH_KEY} in the environment or in ${facts.envPath}.`,
        fix: `Put ${FISH_KEY}=... in ${facts.envPath} (from fish.audio, API keys), or export it.`,
      }
}

function fish(facts: SetupFacts): SetupCheck {
  const title = 'Fish Audio'
  if (facts.fish.ok) {
    return {
      id: 'fish',
      title,
      state: 'ok',
      detail: 'Answers. Credit for paid models:',
      credit: facts.fish.credit,
    }
  }
  if (facts.fish.reason === 'no-key') {
    return { id: 'fish', title, state: 'off', detail: 'Not asked: there is no key.' }
  }
  return {
    id: 'fish',
    title,
    state: 'problem',
    detail: `Did not answer: ${facts.fish.message}`,
    fix: 'Check the key, and that api.fish.audio can be reached.',
  }
}

function requests(facts: SetupFacts): SetupCheck {
  const title = 'Requests at once'
  if (!facts.key) {
    return { id: 'requests', title, state: 'off', detail: 'Not checked: there is no key.' }
  }
  const { parallel } = facts
  const sends = `Recording sends ${parallel} at a time`
  const chosen = facts.fishTier
  const tier = { chosen }
  if (chosen === null) {
    return parallel <= EVERY_ACCOUNT
      ? {
          id: 'requests',
          title,
          state: 'ok',
          detail: `${sends}, which every Fish account allows.`,
          tier,
        }
      : {
          id: 'requests',
          title,
          state: 'problem',
          detail: `${sends}. Fish allows ${EVERY_ACCOUNT} at once unless you have paid it $100 or more in total; say which to check it.`,
          tier,
        }
  }
  const { limit } = FISH_TIERS.find((t) => t.value === chosen)!
  return parallel <= limit
    ? {
        id: 'requests',
        title,
        state: 'ok',
        detail: `${sends}; your account allows ${limit}.`,
        tier,
      }
    : {
        id: 'requests',
        title,
        state: 'problem',
        detail: `${sends}, but your account allows ${limit}. Fish will turn the extra requests away and recording will slow down while the studio waits and retries.`,
        fix: `Set generate.parallel to ${limit} or less in the project file.`,
        tier,
      }
}

function refresh(facts: SetupFacts): SetupCheck {
  return facts.refreshPart
    ? {
        id: 'refresh',
        title: 'Refresh dialog',
        state: 'ok',
        detail: 'The project names a refresh.part command: the dialog can be extracted from here.',
      }
    : {
        id: 'refresh',
        title: 'Refresh dialog',
        state: 'off',
        detail:
          'No refresh.part command in the project file (optional): extract the dialog outside the studio.',
      }
}

function music(facts: SetupFacts): SetupCheck {
  const title = 'Music generator (ACE-Step)'
  if (!facts.music) {
    return { id: 'music', title, state: 'off', detail: 'The project has no music section.' }
  }
  if (musicModel(facts.music.model).family === 'elevenlabs') {
    return {
      id: 'music',
      title,
      state: 'off',
      detail:
        "Not needed while the project's music model is Eleven Music, made by ElevenLabs in the cloud (its rows are below).",
    }
  }
  if (facts.music.ready.ok && musicModel(facts.music.model).family !== 'acestep') {
    return {
      id: 'music',
      title,
      state: 'ok',
      detail:
        "uv is in place. ACE-Step's models are not checked while the project's music model is a Stable Audio one.",
    }
  }
  if (facts.music.ready.ok) {
    return {
      id: 'music',
      title,
      state: 'ok',
      detail: 'uv and the models are in place; the models load on the first take.',
    }
  }
  return {
    id: 'music',
    title,
    state: 'problem',
    detail: facts.music.ready.message,
    fix: facts.music.ready.fix,
  }
}

/** Where Stable Audio Open's models are looked for, as a person writes it. */
const STABLE_AUDIO_HOME = '~/.cache/stable-audio'

/** A Stable Audio model as its row needs it: its name and the folders (repositories) it is in. */
export interface StableAudioModel {
  id: string
  name: string
  folders: readonly string[]
}

/** The Stable Audio models of the music section, in menu order. */
const STABLE_AUDIO_MODELS: StableAudioModel[] = MUSIC_MODELS.filter(
  (m) => m.family === 'stable-audio',
)

function stableAudio(facts: SetupFacts): SetupCheck {
  return stableAudioRow(facts.music, STABLE_AUDIO_MODELS)
}

/** What the row reads of the music facts. */
interface StableAudioFacts {
  model: string
  stableAudioMissing: readonly string[]
}

/** The Stable Audio row, built from the list of the models: each one's name, folders and whether it is missing. */
export function stableAudioRow(
  music: StableAudioFacts | null,
  models: readonly StableAudioModel[],
): SetupCheck {
  const title = 'Music generator (Stable Audio Open)'
  if (!music) {
    return { id: 'stableAudio', title, state: 'off', detail: 'The project has no music section.' }
  }
  const { stableAudioMissing: missing, model } = music
  const names = (list: readonly StableAudioModel[]) => listed(list.map((m) => m.name))
  if (!missing.length) {
    return {
      id: 'stableAudio',
      title,
      state: 'ok',
      detail: `${names(models)} ${isAre(models.length)} in place; ${models.length > 1 ? 'they load' : 'it loads'} on the first take.`,
    }
  }
  const repos = models.flatMap((m) => m.folders)
  const steps = {
    list: [
      licenceStep(repos.map((repo) => `stabilityai/${repo}`)),
      tokenStep(),
      {
        parts: [
          `Download ${models.length > 2 ? 'all of them' : models.length > 1 ? 'both' : 'it'} into ${STABLE_AUDIO_HOME}, where the studio looks for ${models.length > 1 ? 'them' : 'it'}:`,
        ],
        commands: repos.map(
          (repo) =>
            `HF_TOKEN=… uvx --from huggingface_hub hf download stabilityai/${repo} --local-dir ${STABLE_AUDIO_HOME}/${repo}`,
        ),
      },
    ],
    note: STUDIO_TOKEN_NOTE,
  }
  const mine = models.find((m) => m.id === model)
  if (mine && missing.includes(model)) {
    return {
      id: 'stableAudio',
      title,
      state: 'problem',
      detail: `The project's music model, ${mine.name}, is not on this computer: ${mine.folders.join(', ')} is missing from ${STABLE_AUDIO_HOME}.`,
      steps,
    }
  }
  const detail =
    missing.length === models.length
      ? 'Optional: for stingers and short loops. Its models are not on this computer.'
      : `${names(models.filter((m) => !missing.includes(m.id)))} ${isAre(models.length - missing.length)} in place; ${names(models.filter((m) => missing.includes(m.id)))} ${isAre(missing.length)} missing from ${STABLE_AUDIO_HOME}.`
  return { id: 'stableAudio', title, state: 'off', label: 'Not set up', detail, steps }
}

/** Words joined as a sentence lists them: "a", "a and b", "a, b and c". */
function listed(words: string[]): string {
  return words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
}

/** What a download step needs of a model: its repository and about how big it is. */
interface Download {
  repo: string
  gigabytes: number
}

/** The command that downloads a model's weights. */
function downloadCommand({ repo }: Download): string {
  return `uvx --from huggingface_hub hf download ${repo}`
}

/** The step that downloads some models, once, from Hugging Face. */
function downloadStep(models: Download[]): SetupStep {
  const about = `about ${listed(models.map((m) => `${m.gigabytes} GB`))}`
  return {
    parts: [
      models.length > 1 ? `Download the models, once (${about}):` : `Download it, once (${about}):`,
    ],
    commands: models.map(downloadCommand),
  }
}

/** The step that finishes an interrupted download; the same command picks up where it stopped. */
function finishStep(model: Download): SetupStep {
  return {
    parts: ['Finish the download (it picks up where it stopped):'],
    commands: [downloadCommand(model)],
  }
}

/** The model that is an optional extra for an image's takes unless it is the project's own. */
const EXTRA_IMAGE_MODEL: ImageModelId = 'qwen-image'

/**
 * The image models check, with the optional extras' lines and download steps after the rest:
 * Qwen-Image for an image's takes (while it is not the project's model and not whole), then the
 * patch model for patches.
 */
function imageModels(facts: SetupFacts): SetupCheck {
  const check = mainImageModels(facts)
  if (!facts.images?.mflux.ok) return check
  const notes: string[] = []
  const steps: SetupStep[] = []
  const extra = extraDownload(facts.images)
  if (extra && extra !== 'none-run') {
    const { name } = imageModel(EXTRA_IMAGE_MODEL)
    notes.push(
      extra === 'partial'
        ? `Optional: for an image's takes. ${name}'s download is incomplete.`
        : `Optional: for an image's takes. ${name} is not on this computer.`,
    )
    steps.push(
      extra === 'partial'
        ? finishStep(imageModel(EXTRA_IMAGE_MODEL))
        : downloadStep([imageModel(EXTRA_IMAGE_MODEL)]),
    )
  }
  if (facts.images.patchModel !== 'whole') {
    const edit = EDIT_MODELS['qwen-edit']
    const { name } = edit
    const partial = facts.images.patchModel === 'partial'
    notes.push(
      partial
        ? `Optional: for patches. ${name}'s download is incomplete.`
        : `Optional: for patches. ${name} is not on this computer.`,
    )
    steps.push(partial ? finishStep(edit) : downloadStep([edit]))
  }
  if (!notes.length) return check
  return {
    ...check,
    ...(notes.length ? { notes: [...(check.notes ?? []), ...notes] } : {}),
    steps: {
      list: [...(check.steps?.list ?? []), ...steps],
      note: check.steps?.note ?? 'Then press Check again.',
    },
  }
}

/**
 * What the optional extra, Qwen-Image, needs: `absent` or `partial` while it is not the project's
 * model and not whole; `none-run` when it is in that state but no model at all can run (its step
 * then carries the Optional sentence itself, after the usual models'); null otherwise.
 */
function extraDownload(
  images: NonNullable<SetupFacts['images']>,
): ImageDownload | 'none-run' | null {
  if (images.model === EXTRA_IMAGE_MODEL) return null
  const { download } = images.models[EXTRA_IMAGE_MODEL]
  if (download === 'whole') return null
  return IMAGE_MODEL_IDS.some((id) => images.models[id].download === 'whole')
    ? download
    : 'none-run'
}

function mainImageModels(facts: SetupFacts): SetupCheck {
  const title = 'Image models'
  if (!facts.images) {
    return {
      id: 'imageModels',
      title,
      state: 'off',
      label: 'Not used',
      detail: 'The project has no images section.',
    }
  }
  const { mflux, model, models } = facts.images
  const name = (id: ImageModelId) => imageModel(id).name
  const noteSteps = (list: SetupStep[]) => ({ list, note: 'Then press Check again.' })
  /** Qwen-Image is an optional extra, kept out of the usual logic, until it is the project's model. */
  const extra = (id: ImageModelId) => id === EXTRA_IMAGE_MODEL && id !== model
  // A download that is not whole beats a failed take: it is the thing to fix.
  const absent = IMAGE_MODEL_IDS.filter((id) => models[id].download === 'absent' && !extra(id))
  const partial = IMAGE_MODEL_IDS.filter((id) => models[id].download === 'partial' && !extra(id))
  const failed = IMAGE_MODEL_IDS.filter(
    (id) => models[id].download === 'whole' && models[id].failure,
  )
  const downloadSteps = [
    ...partial.map((id) => finishStep(imageModel(id))),
    ...(absent.length ? [downloadStep(absent.map(imageModel))] : []),
  ]
  const installMflux: SetupStep = {
    parts: ['Install mflux:'],
    commands: ['uv tool install --upgrade mflux'],
  }
  if (!mflux.ok) {
    const isMissingMflux = mflux.reason === 'mflux'
    return {
      id: 'imageModels',
      title,
      state: 'problem',
      detail: isMissingMflux
        ? "Images can't be made: mflux, which runs the image models, is not installed."
        : mflux.message,
      ...(isMissingMflux
        ? { steps: noteSteps([installMflux, ...downloadSteps]) }
        : { fix: mflux.fix }),
    }
  }
  const whole = IMAGE_MODEL_IDS.filter((id) => models[id].download === 'whole')
  if (!whole.length) {
    const cannot = (id: ImageModelId) =>
      models[id].download === 'absent'
        ? `${name(id)} is not on this computer`
        : `${name(id)}'s download is incomplete`
    const extraStep = extraDownload(facts.images)
    const optional = extraStep
      ? [
          {
            parts: [
              `Optional: for an image's takes. ${
                models[EXTRA_IMAGE_MODEL].download === 'partial'
                  ? `${name(EXTRA_IMAGE_MODEL)}'s download is incomplete. ${finishStep(imageModel(EXTRA_IMAGE_MODEL)).parts[0]}`
                  : `${name(EXTRA_IMAGE_MODEL)} is not on this computer. ${downloadStep([imageModel(EXTRA_IMAGE_MODEL)]).parts[0]}`
              }`,
            ],
            commands: [downloadCommand(imageModel(EXTRA_IMAGE_MODEL))],
          },
        ]
      : []
    return {
      id: 'imageModels',
      title,
      state: 'problem',
      detail: IMAGE_MODEL_IDS.every((id) => models[id].download === 'absent')
        ? "Images can't be made: no image model is on this computer."
        : `Images can't be made: ${listed(IMAGE_MODEL_IDS.map(cannot))}.`,
      steps: noteSteps([...downloadSteps, ...optional]),
    }
  }
  // The project's model is named first, then the others in menu order.
  const affected = [model, ...IMAGE_MODEL_IDS.filter((id) => id !== model)].filter(
    (id) => (!extra(id) && models[id].download !== 'whole') || failed.includes(id),
  )
  if (!affected.length) {
    return {
      id: 'imageModels',
      title,
      state: 'ok',
      detail: `${listed(whole.map(name))} ${whole.length > 1 ? 'are' : 'is'} fully downloaded on this computer; a model loads on its first take.`,
    }
  }
  const single = affected.length === 1
  const mainAffected = affected.includes(model)
  const link = (failure: NonNullable<typeof models.klein.failure>) =>
    failure.image
      ? {
          text: `Open ${failure.image.title}`,
          href: `#/images/items/${encodeURIComponent(failure.image.id)}`,
        }
      : undefined
  /** The models that are in place, to close what is said about the affected ones. */
  const inPlace = IMAGE_MODEL_IDS.filter(
    (id) => models[id].download === 'whole' && !models[id].failure,
  )
  const tail = inPlace.length
    ? ` ${listed(inPlace.map(name))} ${inPlace.length > 1 ? 'are' : 'is'} in place${
        mainAffected
          ? `: an image's takes can use ${inPlace.length > 1 ? 'them' : 'it'} meanwhile.`
          : '.'
      }`
    : ''
  /** What is wrong with a model's download, in a sentence. */
  const downloadSentence = (id: ImageModelId) => {
    const main = id === model
    const optional = single && !main ? 'Optional: ' : ''
    if (models[id].download === 'absent')
      return main
        ? `The project's image model, ${name(id)}, is not on this computer.`
        : `${optional}${name(id)} is not on this computer.`
    return main
      ? `The project's image model, ${name(id)}, is only partly downloaded, so it can't run.`
      : `${optional}${name(id)}'s download is incomplete, so it can't run.`
  }
  const downloadSentences = affected
    .filter((id) => models[id].download !== 'whole')
    .map(downloadSentence)
  // The models in place close what is said once: after the downloads, else after a single failure.
  const detail = downloadSentences.join(' ') + (downloadSentences.length ? tail : '')
  const failures = failed.map((id) => {
    const failure = models[id].failure!
    const on = failure.image ? ` on ${failure.image.title}` : ''
    const head =
      id === model
        ? `The last take with ${name(id)}, the project's image model, failed${on}.`
        : `${single ? 'Optional: the' : 'The'} last take with ${name(id)} failed${on}.`
    return {
      sentence: head + (single && !downloadSentences.length ? tail : ''),
      error: failure.error,
      ...(link(failure) ? { link: link(failure) } : {}),
      clears: `This clears when a take with ${name(id)} works.`,
    }
  })
  return {
    id: 'imageModels',
    title,
    ...(mainAffected
      ? { state: 'problem' as const }
      : { state: 'off' as const, label: 'Not set up' }),
    detail,
    ...(failures.length ? { failures } : {}),
    ...(downloadSteps.length ? { steps: noteSteps(downloadSteps) } : {}),
  }
}

/** Where Open 1.0 is looked for: the Stable Audio folder the music's Short model is in. */
const OPEN_DIR = '~/.cache/stable-audio'

/** An effect model as its row needs it: its names, its repository and where its weights go. */
export interface EffectFamilyModel {
  id: string
  name: string
  /** A shorter name. */
  short: string
  /** The gated Hugging Face repository the weights are downloaded from. */
  repo: string
  /** About how many GB the weights take on disk. */
  gigabytes: number
  source: EffectModelSource
}

/** The sound-effect models a row is built from, in menu order. */
export interface EffectFamily {
  models: readonly EffectFamilyModel[]
}

/** The studio's sound-effect models. */
const EFFECT_FAMILY: EffectFamily = { models: EFFECT_MODEL_IDS.map(effectModel) }

/** What the row reads of the effects facts: not tied to the ids the studio has today. */
interface EffectFamilyFacts {
  uv: boolean
  listed: boolean
  model: string
  models: Record<string, SetupFacts['effects']['models'][EffectModelId]>
}

/** The command that downloads an effect model: into the cache for a hub model, into the Stable Audio folder for a folder one. */
function effectDownloadCommand({ repo, source }: EffectFamilyModel): string {
  const base = `HF_TOKEN=… uvx --from huggingface_hub hf download ${repo}`
  return source.kind === 'folder' ? `${base} --local-dir ${OPEN_DIR}/${source.folder}` : base
}

/** The steps that fetch some effect models: one licence step, one token step, then a download or finish step each. */
function effectFetchSteps(absent: EffectFamilyModel[], partial: EffectFamilyModel[]): SetupStep[] {
  const several = absent.length + partial.length > 1
  const steps: SetupStep[] = []
  if (absent.length) steps.push(licenceStep(absent.map((m) => m.repo)), tokenStep())
  for (const model of partial) {
    steps.push({
      parts: [
        `Finish ${several ? `${model.name}'s` : 'the'} download (it picks up where it stopped):`,
      ],
      commands: [effectDownloadCommand(model)],
    })
  }
  for (const model of absent) {
    const what = several ? `Download ${model.name}` : 'Download it'
    steps.push({
      parts: [
        model.source.kind === 'folder'
          ? `${what} into ${OPEN_DIR}, where the studio looks for it:`
          : `${what}, once (about ${model.gigabytes} GB):`,
      ],
      commands: [effectDownloadCommand(model)],
    })
  }
  return steps
}

/** "is" for one, "are" for more. */
const isAre = (n: number) => (n > 1 ? 'are' : 'is')

/** The row for the sound-effect models of the studio. */
function effectModels(facts: SetupFacts): SetupCheck {
  return effectModelsRow(facts.effects, EFFECT_FAMILY)
}

/**
 * The row for sound-effect models, built from the list of them: the project's own model is the
 * only one that makes a problem, and only while the game lists sound effects; the others' trouble
 * is optional, "Not set up". What to fix first wins: uv, a download, a failed effect.
 */
export function effectModelsRow(facts: EffectFamilyFacts, family: EffectFamily): SetupCheck {
  const title = 'Sound-effect models'
  const { uv, listed: gameListsEffects, model, models } = facts
  const all = family.models
  const optional = "Optional: for the game's sound effects."
  const noteSteps = (list: SetupStep[], note = 'Then press Check again.') => ({ list, note })
  /** A problem while the game lists effects; grey and optional before that. */
  const trouble = (problem: boolean) =>
    problem && gameListsEffects
      ? { state: 'problem' as const }
      : { state: 'off' as const, label: 'Not set up' }
  if (!uv) {
    const why = 'uv, which runs the sound-effects models, is not on the PATH.'
    return {
      id: 'effectModels',
      title,
      ...trouble(true),
      detail: gameListsEffects ? `Sound effects can't be made: ${why}` : `${optional} ${why}`,
      steps: noteSteps(
        [
          {
            parts: ['Install uv:'],
            commands: ['brew install uv'],
            after: '(then start the studio again if it is still not found)',
          },
        ],
        '',
      ),
    }
  }
  // A download that is not whole beats a failed effect: it is the thing to fix.
  const absent = all.filter((m) => models[m.id]!.download === 'absent')
  const partial = all.filter((m) => models[m.id]!.download === 'partial')
  const failed = all.filter((m) => models[m.id]!.download === 'whole' && models[m.id]!.failure)
  const steps = effectFetchSteps(absent, partial)
  const broken = absent.length + partial.length
  const names = all.map((m) => m.name)
  if (!broken && !failed.length) {
    return {
      id: 'effectModels',
      title,
      state: 'ok',
      detail: `${listed(names)} ${isAre(all.length)} fully downloaded on this computer; a model loads on its first effect.`,
    }
  }
  const stepsNote = absent.length
    ? `${STUDIO_TOKEN_NOTE} Then press Check again.`
    : 'Then press Check again.'
  const cannot = (m: EffectFamilyModel) =>
    models[m.id]!.download === 'absent'
      ? `${m.name} is not on this computer`
      : `${m.name}'s download is incomplete`
  if (broken === all.length) {
    const why =
      absent.length === all.length
        ? `${listed(names)} ${isAre(all.length)} not on this computer.`
        : `${listed(all.map(cannot))}.`
    return {
      id: 'effectModels',
      title,
      ...trouble(true),
      detail: gameListsEffects ? `Sound effects can't be made: ${why}` : `${optional} ${why}`,
      steps: noteSteps(steps, stepsNote),
    }
  }
  // Some models are affected, and at least one can still run.
  const affected = all.filter((m) => models[m.id]!.download !== 'whole' || models[m.id]!.failure)
  const single = affected.length === 1
  const mainAffected = affected.some((m) => m.id === model)
  /** The models in place and well, to close a sentence about the only affected one. */
  const tail = (id: string) => {
    const inPlace = all.filter((m) => !affected.includes(m)).map((m) => m.name)
    return id === model
      ? ` ${listed(inPlace)} ${isAre(inPlace.length)} in place: an effect's takes can use ${inPlace.length > 1 ? 'them' : 'it'} meanwhile.`
      : ` ${listed(inPlace)} ${isAre(inPlace.length)} in place.`
  }
  const lead = (id: string) => (single && id !== model && gameListsEffects ? 'Optional: ' : '')
  const downloadSentence = (m: EffectFamilyModel) => {
    const main = m.id === model
    if (models[m.id]!.download === 'absent') {
      return main
        ? `The project's sound-effects model, ${m.name}, is not on this computer.`
        : `${lead(m.id)}${m.name} is not on this computer.`
    }
    return main
      ? `The project's sound-effects model, ${m.name}, is only partly downloaded, so it can't run.`
      : `${lead(m.id)}${m.name}'s download is incomplete, so it can't run.`
  }
  const detail = affected
    .filter((m) => models[m.id]!.download !== 'whole')
    .map((m) => downloadSentence(m) + (single ? tail(m.id) : ''))
    .join(' ')
  const failures = failed.map((m) => {
    const failure = models[m.id]!.failure!
    const on = failure.effect ? ` on ${failure.effect.title}` : ''
    const head =
      m.id === model
        ? `The last effect with ${m.name}, the project's sound-effects model, failed${on}.`
        : `${lead(m.id) ? 'Optional: the' : 'The'} last effect with ${m.name} failed${on}.`
    return {
      sentence: head + (single ? tail(m.id) : ''),
      error: failure.error,
      ...(failure.effect
        ? {
            link: {
              text: `Open ${failure.effect.title}`,
              href: `#/effects/items/${encodeURIComponent(failure.effect.id)}`,
            },
          }
        : {}),
      clears: `This clears once an effect made with ${m.short} works.`,
    }
  })
  // Before the game lists effects, everything opens with the one optional sentence.
  const quiet = (sentence: string) =>
    gameListsEffects ? sentence : `${optional} ${sentence.replace(/^Optional: /, '')}`
  return {
    id: 'effectModels',
    title,
    ...trouble(mainAffected),
    detail: detail && quiet(detail),
    ...(failures.length
      ? {
          failures: failures.map((f, i) =>
            i === 0 && !detail ? { ...f, sentence: quiet(f.sentence) } : f,
          ),
        }
      : {}),
    ...(steps.length ? { steps: noteSteps(steps, stepsNote) } : {}),
  }
}

/** The note under the steps that download a gated model. */
const STUDIO_TOKEN_NOTE = 'The studio never asks for or keeps your token.'

/** The step that asks for the Stability AI licence on each repository, then the step's links. */
function licenceStep(repos: string[]): SetupStep {
  return {
    parts: [
      "Sign in to Hugging Face and accept Stability AI's Community Licence on ",
      ...repos.flatMap((repo, i) => [
        ...(i ? [i === repos.length - 1 ? ' and ' : ', '] : []),
        { link: repo, href: `https://huggingface.co/${repo}` },
      ]),
      '.',
    ],
  }
}

/** The step that makes a Hugging Face read token. */
function tokenStep(): SetupStep {
  return {
    parts: [
      'Make a read token at ',
      { link: 'huggingface.co/settings/tokens', href: 'https://huggingface.co/settings/tokens' },
      '.',
    ],
  }
}

function elevenlabsKey(facts: SetupFacts): SetupCheck {
  const title = 'ElevenLabs API key'
  if (facts.elevenlabs.ok || facts.elevenlabs.reason !== 'no-key') {
    return { id: 'elevenlabsKey', title, state: 'ok', detail: 'Found.' }
  }
  return {
    id: 'elevenlabsKey',
    title,
    state: 'off',
    label: 'Not set up',
    detail: `Optional: for ElevenLabs voices and music. No ${ELEVENLABS_KEY} in the environment or in ${facts.envPath}.`,
    fix: `Put ${ELEVENLABS_KEY}=... in ${facts.envPath} (from elevenlabs.io, Developers, API keys), or export it.`,
  }
}

/** A number as a person reads it, with thousands separated: 27,450. */
const count = (n: number) => n.toLocaleString('en-US')

/** A plan's name as ElevenLabs gives it, as a person reads it: `creator_tier` is Creator tier. */
function planName(tier: string): string {
  const words = tier.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What the account allows beyond its characters, in a sentence. */
function overageNote(overage: ElevenAccount['overage']): string {
  if (overage === 'unlimited') return 'Usage beyond them is billed in dollars, without limit.'
  if (overage > 0)
    return `Up to ${count(overage)} more credits may be used beyond them, billed in dollars.`
  return 'Nothing is billed beyond them: ElevenLabs work stops when they run out.'
}

function elevenlabs(facts: SetupFacts): SetupCheck {
  const title = 'ElevenLabs'
  const answer = facts.elevenlabs
  if (!answer.ok) {
    return answer.reason === 'no-key'
      ? { id: 'elevenlabs', title, state: 'off', detail: 'Not asked: there is no key.' }
      : {
          id: 'elevenlabs',
          title,
          state: 'problem',
          detail: `Did not answer: ${answer.message}`,
          fix: 'Check the key, and that api.elevenlabs.io can be reached.',
        }
  }
  const { account } = answer
  const left = Math.max(0, account.characterLimit - account.charactersUsed)
  const renews =
    account.renewsAt === null
      ? ''
      : `, renewing ${new Date(account.renewsAt * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
  const free = account.tier === 'free'
  return {
    id: 'elevenlabs',
    title,
    state: 'ok',
    detail: `Answers. ${planName(account.tier)} plan: ${count(left)} of ${count(account.characterLimit)} credits left${renews}.`,
    notes: [
      overageNote(account.overage),
      `Voice slots: ${account.voiceSlots.used} of ${account.voiceSlots.limit} used.`,
      free
        ? 'On the Free plan ElevenLabs makes no music through the API, and nothing it makes may be used commercially.'
        : "Music made with ElevenLabs may be used in a game while the game has earned under $500,000 and you under $1,000,000 a year from games (ElevenLabs' music terms of 9 October 2026); beyond that it needs their Enterprise Music plan.",
    ],
  }
}
