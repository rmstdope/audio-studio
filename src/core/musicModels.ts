/** The ids of the music models, as the project file's `music.model` names them. */
export const MUSIC_MODEL_IDS = [
  'balanced',
  'quick',
  'quickest',
  'careful',
  'short',
  'shortest',
] as const

/** One of the music models the studio can make takes with. */
export type MusicModelId = (typeof MUSIC_MODEL_IDS)[number]

/** How much longer than it plays a loop is generated, since every take closes as a song does. */
export const LOOP_EXTRA_SECONDS = 20

/** The generators the models run on. */
export type MusicFamily = 'acestep' | 'stable-audio'

/** A music model: ACE-Step's diffusion model with a planning language model, or a Stable Audio Open model. */
export interface MusicModel {
  id: MusicModelId
  /** The generator it runs on. */
  family: MusicFamily
  /** The longest piece it can make, in seconds; null when it has no limit. */
  longest: number | null
  /** The plain name a person reads first. */
  name: string
  /** The generator's own names, set faint beside the plain name. */
  generator: string
  /** What a take records as the model that made it, and the lock keeps. */
  recipe: string
  /**
   * The folders it needs: in ACE-Step's checkpoints the diffusion model, then the language model;
   * for Stable Audio the one folder of the model, in its own folder.
   */
  folders: readonly string[]
  /** About how long a take takes, in seconds, for the progress shown. */
  seconds: number
  /** The same time as words after "about". */
  minutes: string
  /** About how much the folders download, when it has been measured. */
  download: string | null
}

/** The models, in the order the menus list them. */
export const MUSIC_MODELS: readonly MusicModel[] = [
  {
    id: 'balanced',
    family: 'acestep',
    longest: null,
    name: 'Balanced',
    generator: 'XL turbo · 4B',
    recipe: 'acestep-v15-xl-turbo+lm-4B',
    folders: ['acestep-v15-xl-turbo', 'acestep-5Hz-lm-4B'],
    seconds: 180,
    minutes: '3 min',
    download: 'about 28 GB',
  },
  {
    id: 'quick',
    family: 'acestep',
    longest: null,
    name: 'Quick',
    generator: 'XL turbo · 1.7B',
    recipe: 'acestep-v15-xl-turbo+lm-1.7B',
    folders: ['acestep-v15-xl-turbo', 'acestep-5Hz-lm-1.7B'],
    seconds: 75,
    minutes: '1¼ min',
    download: null,
  },
  {
    id: 'quickest',
    family: 'acestep',
    longest: null,
    name: 'Quickest',
    generator: 'Turbo · 1.7B',
    recipe: 'acestep-v15-turbo+lm-1.7B',
    folders: ['acestep-v15-turbo', 'acestep-5Hz-lm-1.7B'],
    seconds: 60,
    minutes: '1 min',
    download: null,
  },
  {
    id: 'careful',
    family: 'acestep',
    longest: null,
    name: 'Careful',
    generator: 'XL sft · 4B',
    recipe: 'acestep-v15-xl-sft+lm-4B',
    folders: ['acestep-v15-xl-sft', 'acestep-5Hz-lm-4B'],
    seconds: 420,
    minutes: '7 min',
    download: null,
  },
  {
    id: 'short',
    family: 'stable-audio',
    longest: 47,
    name: 'Short',
    generator: 'Stable Audio Open 1.0',
    recipe: 'stable-audio-open-1.0',
    folders: ['stable-audio-open-1.0'],
    seconds: 40,
    minutes: '40 s',
    download: null,
  },
  {
    id: 'shortest',
    family: 'stable-audio',
    longest: 11,
    name: 'Shortest',
    generator: 'Stable Audio Open Small',
    recipe: 'stable-audio-open-small',
    folders: ['stable-audio-open-small'],
    seconds: 10,
    minutes: '10 s',
    download: null,
  },
]

/** The menus' two groups: each under its heading, in the order the menus list them. */
export const MUSIC_GROUPS: readonly { heading: string; ids: readonly MusicModelId[] }[] = [
  { heading: 'ACE-Step · any length', ids: ['balanced', 'quick', 'quickest', 'careful'] },
  { heading: 'Stable Audio · short music only', ids: ['short', 'shortest'] },
]

/** The model a project uses when its file names none, and what every earlier take was made with. */
export const DEFAULT_MUSIC_MODEL: MusicModelId = 'balanced'

/** The model with this id. */
export function musicModel(id: MusicModelId): MusicModel {
  return MUSIC_MODELS.find((model) => model.id === id)!
}

/** The model a take's stored recipe names: none stored is Balanced's; one not known is null. */
export function modelOfRecipe(recipe: string | undefined): MusicModel | null {
  return (
    MUSIC_MODELS.find((model) => model.recipe === (recipe ?? musicModel('balanced').recipe)) ?? null
  )
}

/** What a take says it was made with: "Balanced · XL turbo · 4B", or the recipe as stored if not known. */
export function modelLine(recipe: string | undefined): string {
  const model = modelOfRecipe(recipe)
  return model ? `${model.name} · ${model.generator}` : (recipe ?? '')
}

/** A track as the menus need it: its kind and the seconds it plays. */
export interface TrackLength {
  kind: 'loop' | 'stinger'
  seconds: number
}

/** A length as m:ss. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** The longest track of this kind the model can make, in seconds (0: none); null when unlimited. */
export function longestFor(id: MusicModelId, kind: 'loop' | 'stinger'): number | null {
  const { longest } = musicModel(id)
  if (longest === null || kind === 'stinger') return null
  return Math.max(0, longest - LOOP_EXTRA_SECONDS)
}

/** Whether the model can make a track of this kind and length. */
export function canMake(id: MusicModelId, kind: 'loop' | 'stinger', seconds: number): boolean {
  const longest = longestFor(id, kind)
  return longest === null || seconds <= longest
}

/** Why a model cannot make this track, in a menu entry: what it can make, and how long this is; null if it can. */
export function lengthReason(
  id: MusicModelId,
  kind: 'loop' | 'stinger',
  seconds: number,
): string | null {
  if (canMake(id, kind, seconds)) return null
  const longest = longestFor(id, kind)!
  const makes = longest === 0 ? 'makes no loops' : `makes loops up to ${longest} s`
  return `${makes} · this one is ${clock(seconds)}`
}

/**
 * A menu entry: the name, the generator, and how long a take takes; on a track a model that
 * cannot make its length says why in place of the time (and that wins over its being missing),
 * and a model whose files are missing says so.
 */
export function menuEntry(id: MusicModelId, installed: boolean, track?: TrackLength): string {
  const model = musicModel(id)
  const heading = `${model.name} · ${model.generator}`
  const reason = track ? lengthReason(id, track.kind, track.seconds) : null
  if (reason) return `${heading} — ${reason}`
  const base = `${heading} — about ${model.minutes} a take`
  return installed ? base : `${base} — not on this computer`
}

/** What an empty track says a take takes with this model: "about 3 minutes each". */
export function eachWords(id: MusicModelId): string {
  const { minutes } = musicModel(id)
  if (minutes.endsWith(' s')) return `about ${minutes.replace(' s', ' seconds')} each`
  return `about ${minutes === '1 min' ? '1 minute' : minutes.replace(' min', ' minutes')} each`
}

/** The line under a track's menu when the picked model cannot make the track's length; null if it can. */
export function tooLongOnTrack(
  id: MusicModelId,
  kind: 'loop' | 'stinger',
  seconds: number,
): string | null {
  if (canMake(id, kind, seconds)) return null
  const longest = longestFor(id, kind)!
  const makes = longest === 0 ? 'makes no loops' : `makes loops up to ${longest} s`
  return `${musicModel(id).name} ${makes}, and this one is ${clock(seconds)}. Pick another model for these takes.`
}

/**
 * The faint line under Setup's menu while a Stable Audio model is chosen: what it can make, and
 * how many of the project's loops (their lengths in seconds) are longer; null for any other model.
 */
export function setupShortLine(id: MusicModelId, loopSeconds: readonly number[]): string | null {
  const model = musicModel(id)
  if (model.family !== 'stable-audio') return null
  const longest = longestFor(id, 'loop')!
  const first = `${model.name} makes stingers, and ${longest === 0 ? 'no loops' : `loops up to ${longest} s`}.`
  const longer = loopSeconds.filter((seconds) => seconds > longest).length
  if (!longer) return first
  const rest =
    longest === 0
      ? `${longer} ${longer === 1 ? 'loop' : 'loops'} will need another model, picked on their page.`
      : `${longer} ${longer === 1 ? 'loop is longer: its takes' : 'loops are longer: their takes'} will need another model, picked on their page.`
  return `${first} ${rest}`
}

/** The line under a track's menu when it starts on a model this computer does not have. */
export function missingOnTrack(id: MusicModelId): string {
  return `${musicModel(id).name} isn't on this computer. Pick another model for these takes, or see Setup for how to download it.`
}

/** The heading of the box shown when saving the project's music model failed. */
export function saveFailureHeading(id: MusicModelId): string {
  return `${musicModel(id).name} could not be saved as the music model.`
}
