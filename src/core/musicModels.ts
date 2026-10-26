/** The ids of the music models, as the project file's `music.model` names them. */
export const MUSIC_MODEL_IDS = ['balanced', 'quick', 'quickest', 'careful'] as const

/** One of the music models the studio can make takes with. */
export type MusicModelId = (typeof MUSIC_MODEL_IDS)[number]

/** A music model: ACE-Step's diffusion model with a planning language model, named plainly. */
export interface MusicModel {
  id: MusicModelId
  /** The plain name a person reads first. */
  name: string
  /** The generator's own names, set faint beside the plain name. */
  generator: string
  /** What a take records as the model that made it, and the lock keeps. */
  recipe: string
  /** The two folders in ACE-Step's checkpoints: the diffusion model, then the language model. */
  folders: readonly [dit: string, lm: string]
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
    name: 'Careful',
    generator: 'XL sft · 4B',
    recipe: 'acestep-v15-xl-sft+lm-4B',
    folders: ['acestep-v15-xl-sft', 'acestep-5Hz-lm-4B'],
    seconds: 420,
    minutes: '7 min',
    download: null,
  },
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

/** A menu entry: the name, the generator, and how long a take takes; marked when the files are missing. */
export function menuEntry(id: MusicModelId, installed: boolean): string {
  const model = musicModel(id)
  const base = `${model.name} · ${model.generator} — about ${model.minutes} a take`
  return installed ? base : `${base} — not on this computer`
}

/** What an empty track says a take takes with this model: "about 3 minutes each". */
export function eachWords(id: MusicModelId): string {
  const { minutes } = musicModel(id)
  return `about ${minutes === '1 min' ? '1 minute' : minutes.replace(' min', ' minutes')} each`
}

/** The line under a track's menu when it starts on a model this computer does not have. */
export function missingOnTrack(id: MusicModelId): string {
  return `${musicModel(id).name} isn't on this computer. Pick another model for these takes, or see Setup for how to download it.`
}

/** The heading of the box shown when saving the project's music model failed. */
export function saveFailureHeading(id: MusicModelId): string {
  return `${musicModel(id).name} could not be saved as the music model.`
}
