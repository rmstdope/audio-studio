import { z } from 'zod'
import { FadesSchema, hasFades, type Fades } from './fades'
import { EFFECT_MODEL_IDS, type EffectModelId } from './effectModels'
import type { ImageDownload } from './imageModels'

/** What a sound-effect take is made from: the description in use and the length the game asks. */
export const EffectInputsSchema = z.object({
  description: z.string(),
  seconds: z.number(),
  /** The effect loops (the take was made seamless); absent in what was made before loops, which plays once. */
  loops: z.boolean().optional(),
})

/** What a sound-effect take is made from. */
export type EffectInputs = z.infer<typeof EffectInputsSchema>

/**
 * What a chosen take was made from, as the lock file holds it: the description as `text`. Read as
 * the take's `EffectInputs`.
 */
const LockInputsSchema = z
  .object({
    text: z.string(),
    seconds: z.number(),
    /** The effect loops (the take was made seamless); absent for a take made to play once. */
    loops: z.boolean().optional(),
  })
  .transform(({ text, ...rest }): EffectInputs => ({ description: text, ...rest }))

/** One effect in the effects lock: the take the game plays, and what it was made from. */
export const EffectLockEntrySchema = z.object({
  /** A hash of what went into the take (description, length). */
  fp: z.string(),
  model: z.string(),
  /** The seed the take was made from. */
  seed: z.number().optional(),
  /** The number of the take on the effect's board. */
  take: z.number().int().positive(),
  /**
   * What the chosen take counts as made from, which the effect's inputs are compared with: its
   * own inputs, with a description accepted since (Accept) in place of what it was made from.
   */
  inputs: LockInputsSchema,
  /** When it was chosen (ISO time). */
  at: z.string(),
})

/** `content-studio/effects/lock.json`: the chosen take of each effect, by effect id. */
export const EffectLockSchema = z.record(z.string(), EffectLockEntrySchema)

/** The manifest in the effects clips folder, which the game reads: `{ effect: { file, duration } }`. */
export const EffectManifestSchema = z.record(
  z.string(),
  z.object({ file: z.string(), duration: z.number() }),
)

/** An effect's entry in the lock. */
export type EffectLockEntry = z.infer<typeof EffectLockEntrySchema>
/** The effects lock. */
export type EffectLock = z.infer<typeof EffectLockSchema>
/** The effects manifest. */
export type EffectManifest = z.infer<typeof EffectManifestSchema>

/** A take on an effect's board, saved in `content-studio/cache/effect-boards/<effect>.json`. */
export const EffectBoardTakeSchema = z.object({
  n: z.number().int().positive(),
  /** The hash of its inputs, which with `n` names its WAV. */
  hash: z.string().regex(/^[0-9a-f]{16}$/),
  seed: z.number().optional(),
  /** The effect model that made it. */
  model: z.string(),
  /** Its real length: the sound ends where it ends. */
  seconds: z.number(),
  peaks: z.array(z.number()),
  inputs: EffectInputsSchema,
  /** For a loop whose sound ended before its length: where, in seconds. */
  quietAt: z.number().optional(),
  /** The fades of a take made to play once, applied when it is chosen; absent when it has none. The WAV stays as generated. */
  fades: FadesSchema.optional(),
})

/** An effect's board: the takes kept, and the number the next take gets (numbers are never reused). */
export const EffectBoardSchema = z.object({
  next: z.number().int().positive(),
  takes: z.array(EffectBoardTakeSchema),
})

/** An effect's saved board. */
export type EffectBoard = z.infer<typeof EffectBoardSchema>
/** A take on the board. */
export type EffectBoardTake = z.infer<typeof EffectBoardTakeSchema>

/** The most takes one click asks for. */
export const MAX_EFFECT_TAKES = 8

/** The body of a request for takes: this many new ones, or a failed one again. */
export const MakeEffectTakesBody = z.union([
  z
    .object({
      count: z.number().int().min(1).max(MAX_EFFECT_TAKES),
      /** The model to make them with; absent is the default for the effect. */
      model: z.enum(EFFECT_MODEL_IDS).optional(),
    })
    .strict(),
  z.object({ retry: z.number().int().positive() }).strict(),
])

/** The body of a save of fades: both lengths in seconds and the shape of both. */
export const SetEffectFadesBody = FadesSchema.strict()

/** The body of a choice: the file name of the take on the effect's board. */
export const ChooseEffectTakeBody = z.object({ file: z.string().min(1) }).strict()

/** What can have changed since a take was chosen: the words, the length, or how the effect plays. */
export type EffectChangedField = 'description' | 'length' | 'now loops' | 'no longer loops'

/** What differs between the chosen take's own inputs and the effect's now. */
export function effectChangedFields(
  lock: EffectLockEntry,
  now: EffectInputs,
): EffectChangedField[] {
  const changed: EffectChangedField[] = []
  if (lock.inputs.description !== now.description) changed.push('description')
  if (lock.inputs.seconds !== now.seconds) changed.push('length')
  if (Boolean(lock.inputs.loops) !== Boolean(now.loops)) {
    changed.push(now.loops ? 'now loops' : 'no longer loops')
  }
  return changed
}

/** Whether the change can be accepted: only a description can; a new length needs a new take. */
export function effectAcceptable(changed: EffectChangedField[]): boolean {
  return changed.length === 1 && changed[0] === 'description'
}

/** Where an effect stands, as the list's Status column says it. */
export type EffectStatus = 'none-yet' | 'not-chosen' | 'chosen' | 'changed' | 'missing' | 'unknown'

/** The words of a status chip (a batch being made is worded by `makingStatus`). */
export const EFFECT_STATUS_LABEL: Record<EffectStatus, string> = {
  'none-yet': 'none yet',
  'not-chosen': 'not chosen',
  chosen: 'chosen',
  changed: 'changed since chosen',
  missing: 'clip missing',
  unknown: 'not known',
}

/**
 * An effect's status. Not known while the lock cannot be read; a chosen take whose clip is gone is
 * missing, said ahead of changed; no take chosen is "none yet" until a take exists.
 */
export function effectStatus(input: {
  lockUnread: boolean
  chosen: { lock: EffectLockEntry; fileExists: boolean } | undefined
  now: EffectInputs
  hasTakes: boolean
}): EffectStatus {
  const { lockUnread, chosen, now, hasTakes } = input
  if (lockUnread) return 'unknown'
  if (!chosen) return hasTakes ? 'not-chosen' : 'none-yet'
  if (!chosen.fileExists) return 'missing'
  return effectChangedFields(chosen.lock, now).length ? 'changed' : 'chosen'
}

/** The way of playing a change names, if it names one. */
const playChange = (fields: EffectChangedField[]) =>
  fields.find((f) => f === 'now loops' || f === 'no longer loops')

/** The first line of the box saying what changed since the take was chosen. */
export function effectChangedLine(fields: EffectChangedField[]): string {
  const play = playChange(fields)
  const named = fields.filter((f) => f === 'description' || f === 'length').join(' and ')
  const what = !play ? named : named ? `${named}, and ${play}` : play
  return `Changed since its take was chosen: ${what}.`
}

/** The rest of that box: what the game plays meanwhile, and what to do. */
export function effectChangedAdvice(fields: EffectChangedField[]): string {
  const meanwhile = 'The game plays the chosen take until you choose another.'
  const play = playChange(fields)
  if (play === 'now loops') {
    return `${meanwhile} Make more takes that loop. A take made to play once can't loop without a jump.`
  }
  if (play === 'no longer loops') {
    return `${meanwhile} Make more takes that play once. A take made to loop runs to the full length instead of ending with its sound.`
  }
  return effectAcceptable(fields)
    ? `${meanwhile} Make more takes to hear the new description, or Accept to count the chosen take as up to date.`
    : `${meanwhile} Make more takes to hear the new length. A changed length needs a new take.`
}

/** The chip on a take made the other way from how the effect plays now, or null when it is the right kind. */
export function effectTakeKind(
  take: { loops: boolean },
  effectLoops: boolean,
): 'made to play once' | 'made to loop' | null {
  if (take.loops === effectLoops) return null
  return take.loops ? 'made to loop' : 'made to play once'
}

/** The amber line under a loop whose sound ends early: where it goes quiet. */
export function effectQuietLine(quietAt: number): string {
  return `Goes quiet at ${quietAt.toFixed(1)} s, so it loops with a gap.`
}

/** Whether a take can be chosen: only one made the way the effect plays now. */
export function effectTakeChoosable(take: { loops: boolean }, effectLoops: boolean): boolean {
  return effectTakeKind(take, effectLoops) === null
}

/** Whether a take can fade: made to play once, on an effect that plays once. */
export function effectFadable(take: { loops: boolean }, effectLoops: boolean): boolean {
  return !take.loops && !effectLoops
}

/**
 * The fades a take has as the game will play them: those saved with it, while it can fade. A take
 * keeps them while its effect loops, but they are not shown or played then.
 */
export function effectFadesOf(
  take: { loops: boolean; fades?: Fades | undefined },
  effectLoops: boolean,
): Fades | undefined {
  return take.fades && hasFades(take.fades) && effectFadable(take, effectLoops)
    ? take.fades
    : undefined
}

/** What an effect's In the game block shows. */
export type EffectInTheGameState =
  | { kind: 'take'; take: number; missing: boolean; hint: string }
  | { kind: 'nothing'; hint: string }
  | { kind: 'unknown'; hint: string }

/** What the game plays for an effect: the chosen take (its clip gone or not), else nothing; not known while the lock cannot be read. */
export function effectInTheGame(current: EffectCurrent): EffectInTheGameState {
  if (current.kind === 'unknown') {
    return { kind: 'unknown', hint: 'Which take the game plays is not known.' }
  }
  if (current.kind === 'take') {
    return {
      kind: 'take',
      take: current.take,
      missing: !current.exists,
      hint: current.exists
        ? 'Un-choose and the game plays nothing here.'
        : "The game's clip for this effect is not there. Choose again writes it again.",
    }
  }
  return { kind: 'nothing', hint: 'Choose a take below and the game plays it.' }
}

/** What an effect plays in the game now. */
export type EffectCurrent =
  { kind: 'nothing' } | { kind: 'unknown' } | { kind: 'take'; take: number; exists: boolean }

/** The question before un-choosing take `take`: what is deleted, and what stays. */
export function effectUnchooseQuestion(take: number): string {
  return `The game plays nothing here until another take is chosen. Take ${take}'s clip is deleted from the game; Take ${take} stays with the other takes, to be chosen again.`
}

/** The label of the make button: "Make 4 takes", or "Make 4 more takes" once takes exist. */
export function makeEffectTakesLabel(count: number, hasTakes: boolean): string {
  const takes = count === 1 ? 'take' : 'takes'
  return `Make ${count}${hasTakes ? ' more' : ''} ${takes}`
}

/** A menu entry of the count: "1 take" … "8 takes". */
export function effectCountEntry(count: number): string {
  return `${count} ${count === 1 ? 'take' : 'takes'}`
}

/** One take on an effect's page. */
export interface EffectTakeView {
  n: number
  /** The file name to ask for under the effect's takes. */
  file: string
  seconds: number
  /** The waveform's bars, 0 to 1. */
  peaks: number[]
  /** The take the game plays. */
  chosen: boolean
  /** The model that made it: "Stable Audio 3 Small SFX". */
  model: string
  /** It was made to loop (seamless, the length the game asked) rather than to play once. */
  loops: boolean
  /** For a loop whose sound ended early: where it goes quiet, in seconds. */
  quietAt: number | null
  /** The fades saved with a take made to play once; absent when it has none. */
  fades?: Fades
}

/** What is using the GPU: a music take, an image take, a sound effect take, or a check of a recording. */
export type GpuUse = 'music' | 'image' | 'effect' | 'recording'

/** The faint line under a take waiting for the graphics chip: what is using it now; null when nothing is. */
export function effectChipLine(using: GpuUse | null): string | null {
  if (!using) return null
  return {
    music: 'Music is being made first.',
    image: 'An image is being made first.',
    effect: 'Another effect is being made first.',
    recording: 'A recording is being checked first.',
  }[using]
}

/** A take being made or waiting its turn. */
export interface EffectMakingView {
  n: number
  state: 'waiting' | 'making'
  /** Seconds since it began; 0 while it waits. */
  elapsed: number
  /** About how long a take takes, in seconds. */
  expected: number
  /** The model making it: its full name. */
  model: string
  /**
   * Set on the first waiting take of the effect that waits for the graphics chip, with what is
   * using the chip now; absent on the takes behind it, which say "waiting".
   */
  chip?: { using: GpuUse | null }
}

/** A take that could not be made, and why. */
export interface EffectFailedView {
  n: number
  message: string
}

/** Which sound-effects models can make takes here: what the page and the Make all question need. */
export interface EffectModelsView {
  ok: true
  /** Whether takes can be made at all: one of the models can run on this computer. */
  canMake: boolean
  /** The project's main model. */
  projectModel: EffectModelId
  /** Whether uv, which runs the models, is on the PATH. */
  uv: boolean
  /** Each model: how much of it is on this computer, and whether its last effect failed. */
  models: { id: EffectModelId; download: ImageDownload; failed: boolean }[]
}

/** An effect's takes as its page shows them. */
export interface EffectTakesView extends EffectModelsView {
  takes: EffectTakeView[]
  making: EffectMakingView[]
  failed: EffectFailedView[]
  /** The effects lock cannot be read: nothing can be chosen, dropped or un-chosen. */
  lockUnread: boolean
}

/** What is being made for an effect: how many takes wait or are made, and about how many seconds are left. */
export interface EffectMakingSummary {
  takes: number
  left: number
}

/** Seconds as a person reads a wait: "12 s", "1 min", "1 min 10 s". */
export function waitOf(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const rest = seconds % 60
  return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ''}`
}

/** What a take being made says beside its name: its wait, or about how long is left. */
export function effectTimeLeft(
  making: Pick<EffectMakingView, 'state' | 'elapsed' | 'expected' | 'chip'>,
): string {
  if (making.state === 'waiting') return making.chip ? 'waiting for the graphics chip' : 'waiting'
  const left = Math.max(1, Math.floor(making.expected - making.elapsed))
  return `making · about ${waitOf(left)} left`
}

/** A list status while takes are made: how many, and about how long is left. */
export function effectMakingStatus({ takes, left }: EffectMakingSummary): string {
  return `making ${takes} ${takes === 1 ? 'take' : 'takes'} · about ${waitOf(Math.max(1, Math.round(left)))}`
}

/** A take's real length as the card writes it: "1.4 s". */
export function effectTakeLength(seconds: number): string {
  return `${seconds.toFixed(1)} s`
}
