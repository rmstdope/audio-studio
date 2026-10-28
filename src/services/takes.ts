import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { resolveInRoot } from '../core/paths'
import {
  declaredLanguage,
  FREE_MODELS,
  phraseProblem,
  type Problem,
  type Project,
} from '../core/project'
import type { Budget } from '../core/spend'
import { isPaid } from '../core/sitting'
import { sceneCueFor } from '../core/fingerprint'
import { cueFor, projectCast, ttsFor, type Cast } from '../core/resources'
import type { ProjectSummary } from '../core/summary'
import { auditionText, takeKey, type AuditionText } from '../core/takes'
import { normalizeCue, withInside, wordsOf } from '../core/cued'
import { clipInputs } from '../core/fingerprint'
import { spokenPieces } from '../core/spoken'
import type { FishFactory } from './auditions'
import { writeAtomic } from './files'
import { createLimiter, type Limiter } from './limit'
import { loadWorkspace, readPart, type ProjectFailure } from './workspace'
import { providerId, providerOf } from '../core/voices'
import {
  elevenCredits,
  elevenModelName,
  readsCues,
  requestsAtOnce,
  speedProblem,
  takesLanguage,
} from '../core/elevenSpeech'
import { spokenText } from '../core/spoken'
import { NO_ELEVENLABS_KEY, type ElevenLabsClient, type ElevenLabsFactory } from './elevenlabs'
import { appendTry } from './spending'
import { randomUUID } from 'node:crypto'
import { NO_KEY } from './fish'

/** Where audition takes are kept, in the project's tool cache (gitignored by the consumer). */
export const TAKES_DIR = '.audio-studio/takes'

/** A recorded take (its key, and the text it is of), or why there is none. Null for an unknown character. */
export type TakeResult =
  | ({ ok: true; key: string; spoken: string; cached: boolean } & ElevenSpoken)
  | {
      ok: false
      reason:
        | 'no-key'
        | 'fish'
        | 'elevenlabs'
        | 'speed'
        | 'not-yet'
        | 'no-sitting'
        | 'waits'
        | 'no-phrase'
      message: string
    }
  | { ok: false; problems: Problem[] }
  | null

/**
 * What a take or try with an ElevenLabs voice adds: the model it was spoken with, the credits it
 * cost (none when it came from the cache), and whether its cues were left out because the model
 * would have spoken them. Nothing for a Fish voice.
 */
export interface ElevenSpoken {
  model?: string
  credits?: number
  cuesLeftOut?: boolean
  /** The text as the page shows it, cues and all, when it may differ from what was sent. */
  asked?: string
}

/** What a take or try with an ElevenLabs voice is spoken by: the client, and where it waits. */
export interface ElevenTakeOptions {
  elevenlabs?: ElevenLabsFactory
  /** The limiter ElevenLabs' requests wait in (a fresh one when absent). */
  elevenLimiter?: Limiter
}

/** A line tried with a cue: a take of it, or why there is none. Null for an unknown part or line. */
export type TryResult =
  TakeResult | { ok: false; reason: 'uncast'; message: string } | ProjectFailure

/**
 * Who a take is for and what pays for it. A take of the audition board uses the audition model,
 * which may be paid: it is then charged to `budget` (the audition's sitting) just before it is
 * sent, and `charged` hears what it cost once Fish has made it. Any other take (the cast voice's
 * on its page, a try with a cue) is on the free model, whatever the audition model is; with an
 * ElevenLabs voice it is on ElevenLabs' audition model, not confirmed, and logged.
 */
export interface TakeOptions extends ElevenTakeOptions {
  board?: boolean
  /**
   * The ElevenLabs credits of the audition's sitting: a board take with an ElevenLabs voice is
   * charged to it just before it is sent, as a paid Fish take is to `budget`.
   */
  credits?: Budget
  budget?: Budget
  charged?: (dollars: number) => void | Promise<void>
  /** Whether the sitting `budget` belongs to is still going on; checked when the take is charged. */
  open?: () => boolean
  /**
   * Told when a charged take is sent, with its cost; the answer is called when it is done. Lets
   * the server hold that money back from the credit while Fish may not have billed it yet.
   */
  flight?: (dollars: number) => () => void
  /**
   * The ElevenLabs voice to speak an ElevenLabs take with, asked once it is charged: a voice of
   * the library is added to the user's voices first. The voice itself when absent.
   */
  speakAs?: (client: ElevenLabsClient) => Promise<string>
}

/**
 * Has `voiceId` say the character's audition phrase, in its style, and keeps the audio in the tool
 * cache. A take already recorded is not recorded again (and costs nothing), and requests for the
 * same take share one recording; at most `quality.parallel` are recorded at once. See `TakeOptions`
 * for the model.
 */
export async function recordTake(
  projectFile: string,
  characterId: string,
  voiceId: string,
  fishFor: FishFactory,
  limiter: Limiter,
  options: TakeOptions = {},
  asked?: string,
): Promise<TakeResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return { ok: false, problems: loaded.problems }
  const { project, cast, summary } = loaded
  if (!summary.characters.some((c) => c.id === characterId)) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }

  const root = dirname(projectFile)
  const {
    language,
    cast: seen,
    audition: text,
  } = auditionIn(project, cast, summary, characterId, asked)
  if (text.phrase === null) {
    return { ok: false, reason: 'no-phrase', message: 'There is no audition phrase to record.' }
  }
  // A phrase edited into the cast by hand is checked too: never pay for a take that is too long.
  const tooLong = phraseProblem(text.phrase, project.narration.quality.chunkLimit)
  if (tooLong) {
    const source = language === project.narration.languages[0]
    const where =
      text.from === 'own'
        ? phrasePath(characterId, source ? undefined : language)
        : source
          ? 'narration.audition.phrase'
          : `narration.audition.phrases.${language}`
    const file = text.from === 'own' ? project.narration.characters : basename(projectFile)
    return { ok: false, problems: [{ file, path: where, message: tooLong }] }
  }
  const character = seen.speakers[characterId]
  const tts = ttsFor(project.narration.tts, character)
  if (providerOf(voiceId) === 'elevenlabs') {
    return speakEleven(projectFile, project, voiceId, tts, options, {
      kind: options.board ? 'audition' : 'take',
      character: characterId,
      language,
      ...pageText(text, seen, characterId),
    })
  }
  const model = options.board ? project.narration.models.audition : FREE_MODELS[0]
  return speak(root, project, voiceId, text.spoken, tts, model, fishFor, limiter, options)
}

/**
 * Hears a line with a cue before the cue is saved: the speaker's cast voice says the line, as
 * the cast says it, after the cue (empty: the character's style, as a line without its own cue
 * is said). A try is a take: recorded with the free model, the whole line in one
 * request (Fish splits long text itself), and kept in the tool cache, so the same cue on the same
 * line is recorded once. Nothing of the game's is written.
 */
export async function tryLine(
  projectFile: string,
  partId: string,
  key: string,
  cue: string,
  fishFor: FishFactory,
  limiter: Limiter,
  language?: string,
  at?: number,
  eleven: ElevenTakeOptions = {},
): Promise<TryResult> {
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return read
  // Only the cast is needed besides the dialog (a line of a broken dialog is not found): a broken
  // manifest or lock, which the lines page lists lines under, does not stop a try.
  const problems = castProblems(read.project, read.problems)
  if (problems.length) return { ok: false, problems }
  const line = read.input.lines.find((l) => l.key === key)
  if (!line) return null
  const { cast } = read.input
  const character = cast.speakers[line.speaker]
  if (!character?.voice) {
    return {
      ok: false,
      reason: 'uncast',
      message: `${line.speaker} has no voice yet; cast one first.`,
    }
  }
  let spoken: string
  if (at === undefined) {
    // Nothing typed: the cue the line would follow without its own: the source language's, else its
    // scene's, else the character's style.
    const withoutOwn = Object.fromEntries(
      Object.entries(read.input.cues).filter(([k]) => k !== key),
    )
    const tried =
      cue.trim() ||
      cueFor(read.sourceCues, key) ||
      sceneCueFor(line, withoutOwn, read.project.narration) ||
      (character.style ?? '')
    // The line's saved cues inside stay: it is heard as it would be recorded with this opening.
    const { inside } = clipInputs(
      line,
      character,
      read.input.cues,
      cast.pronounce,
      read.project.narration,
    )!
    spoken = spokenPieces(line.text, tried, cast.pronounce, Infinity, inside)[0]!
  } else {
    // A cue tried inside the line: its opening and the cues saved inside stay, the typed cue is
    // added at the gap (replacing the one there; empty: without it), the whole line in one request.
    if (!Number.isInteger(at) || at < 1 || at >= wordsOf(line.text).length) {
      return {
        ok: false,
        problems: [
          { file: read.paths.cuesPath, path: key, message: 'a cue goes between two words' },
        ],
      }
    }
    const inputs = clipInputs(
      line,
      character,
      read.input.cues,
      cast.pronounce,
      read.project.narration,
    )!
    const inside = withInside(inputs.inside, at, normalizeCue(cue))
    spoken = spokenPieces(line.text, inputs.cue, cast.pronounce, Infinity, inside)[0]!
  }
  const tts = ttsFor(read.project.narration.tts, character)
  if (providerOf(character.voice) === 'elevenlabs') {
    const bare = spokenPieces(line.text, '', cast.pronounce, Infinity)[0]!
    return speakEleven(projectFile, read.project, character.voice, tts, eleven, {
      kind: 'try',
      character: line.speaker,
      part: partId,
      language: read.language,
      withCues: spoken,
      bare,
      cued: spoken !== bare,
    })
  }
  return speak(
    dirname(projectFile),
    read.project,
    character.voice,
    spoken,
    tts,
    FREE_MODELS[0],
    fishFor,
    limiter,
  )
}

/**
 * `voice` saying `spoken` with `model` at `tts` (the character's settings), kept in
 * the tool cache under its take key; a take already there is not recorded again, and requests
 * for the same take share one recording.
 */
async function speak(
  root: string,
  project: Project,
  voice: string,
  spoken: string,
  tts: Project['narration']['tts'],
  model: string,
  fishFor: FishFactory,
  limiter: Limiter,
  options: TakeOptions = {},
): Promise<TakeResult> {
  const { quality } = project.narration
  const key = takeKey({ model, voice, spoken, tts })
  const file = resolveInRoot(root, takePath(key))
  const recorded = { ok: true as const, key, spoken }
  if (existsSync(file)) return { ...recorded, cached: true }

  const paid = isPaid(model, new Date())
  if (paid && !options.budget) {
    return {
      ok: false,
      reason: 'no-sitting',
      message: `Takes with ${model} are paid: start the audition with an amount to spend.`,
    }
  }
  const fish = await fishFor(root, project)
  if (!fish) {
    return {
      ok: false,
      reason: 'no-key',
      message: NO_KEY,
    }
  }
  let waits: string | null = null
  let ended = false
  try {
    const cached = await limiter.run(key, quality.parallel, async () => {
      // Another request may have recorded it while this one waited: never pay for it twice.
      if (existsSync(file)) return true
      // Charged now, as late as it can be: the budget may have been spent while this one waited.
      const { budget } = options
      const before = budget?.left ?? 0
      // A sitting that ended while this take waited its turn pays for nothing.
      if (paid && options.open && !options.open()) {
        ended = true
        return true
      }
      if (paid && budget) {
        waits = budget.spend(model, spoken, new Date())
        if (waits) return true
      }
      const cost = before - (budget?.left ?? 0)
      const landed = cost > 0 ? options.flight?.(cost) : undefined
      try {
        const audio = await fish.tts({ text: spoken, voice, model, ...tts })
        if (!audio.length) throw new Error('Fish Audio sent no audio')
        await writeAtomic(root, takePath(key), audio)
      } catch (error) {
        // Nothing was made, so nothing is charged.
        budget?.refund(cost)
        throw error
      } finally {
        landed?.()
      }
      // What it cost is noted for the page; failing to note it does not unmake the take.
      if (cost > 0) {
        try {
          await options.charged?.(cost)
        } catch {
          // Only the page's figure of what was spent is lost.
        }
      }
      return false
    })
    if (ended) {
      return { ok: false, reason: 'no-sitting', message: 'The audition’s sitting has ended.' }
    }
    // Also for a request that shared another's recording, which the money did not cover.
    if (waits || !existsSync(file)) {
      const why = waits ? `: ${waits}` : ''
      return { ok: false, reason: 'waits', message: `Take waits for more money${why}` }
    }
    return { ...recorded, cached }
  } catch (error) {
    return {
      ok: false,
      reason: 'fish',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** What an ElevenLabs take or try is of, for the text sent and the spending record. */
interface ElevenText {
  kind: 'take' | 'try' | 'audition'
  character: string
  /** A try's part. */
  part?: string
  language: string
  /** The text with its cues, as a model that reads them is sent it, and as the page shows it. */
  withCues: string
  /** The text without them, for a model that would speak them. */
  bare: string
  /** Whether the text has cues at all, so leaving them out is worth saying. */
  cued: boolean
}

/** The page take's text with and without the character's style, as `ElevenText` wants it. */
function pageText(
  text: AuditionText,
  cast: Cast,
  characterId: string,
): Pick<ElevenText, 'withCues' | 'bare' | 'cued'> {
  return {
    withCues: text.spoken,
    bare: text.phrase === null ? '' : spokenText(text.phrase, '', cast.pronounce),
    cued: Boolean(cast.speakers[characterId]?.style?.trim()),
  }
}

/**
 * `voice`, an ElevenLabs one, saying a take or try with the audition model and the project's
 * voice settings at the character's speed, kept in the tool cache under its take key (ElevenLabs'
 * WAV, which the take route serves as such). Nothing is confirmed first: a take or try is a line's
 * worth of characters. What it cost is added to the spending record; one already kept costs and
 * logs nothing.
 */
async function speakEleven(
  projectFile: string,
  project: Project,
  voice: string,
  tts: Project['narration']['tts'],
  options: ElevenTakeOptions & Pick<TakeOptions, 'credits' | 'open' | 'flight' | 'speakAs'>,
  text: ElevenText,
): Promise<TakeResult> {
  const root = dirname(projectFile)
  const { narration } = project
  const { model, spoken, key, cues } = elevenTake(project, voice, tts, text, text.language)
  // `asked` is the text as the page shows it, by which it knows the take for its own.
  const said = { model, cuesLeftOut: !cues && text.cued, asked: text.withCues }
  const settings = narration.elevenlabs.tts
  const file = resolveInRoot(root, takePath(key))
  if (existsSync(file)) return { ok: true, key, spoken, cached: true, ...said }
  const slow = speedProblem(tts.speed)
  if (slow) return { ok: false, reason: 'speed', message: slow }
  const client = await (options.elevenlabs ?? (async () => null))(root, project)
  if (!client) return { ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY }
  // A board take is paid from the sitting's credits; there is no free model to fall back on.
  const board = text.kind === 'audition'
  const sitting = board ? options.credits : undefined
  if (board && !sitting) {
    return {
      ok: false,
      reason: 'no-sitting',
      message:
        'Takes of ElevenLabs voices are paid in credits: give the audition credits to spend.',
    }
  }
  if (sitting && sitting.model !== model) {
    return {
      ok: false,
      reason: 'no-sitting',
      message: `The audition’s credits were given for ${elevenModelName(sitting.model)}, and ElevenLabs’ audition model is now ${elevenModelName(model)}: resume the audition.`,
    }
  }
  const limiter = options.elevenLimiter ?? createLimiter()
  const credits = elevenCredits(model, spoken)!
  // What became of the run: made (by whoever ran it), already there, or not paid for.
  type Outcome = { made: 'made' | 'cached' } | { waits: string } | { ended: true }
  // Whether this request's own job ran (only then is the outcome its own), and whether it paid.
  let ran = false as boolean
  let paid = false as boolean
  const run = () =>
    limiter.run(
      key,
      requestsAtOnce(narration.quality.parallel, voice),
      async (): Promise<Outcome> => {
        ran = true
        // Another request may have made it while this one waited: never pay for it twice.
        if (existsSync(file)) return { made: 'cached' }
        // Charged now, as late as it can be: the sitting may have ended or been spent meanwhile.
        if (sitting) {
          if (options.open && !options.open()) return { ended: true }
          const waits = sitting.spend(model, spoken, new Date())
          if (waits) return { waits }
        }
        const landed = sitting ? options.flight?.(credits) : undefined
        let audio: Uint8Array
        try {
          const speaker = options.speakAs ? await options.speakAs(client) : voice
          audio = await client.tts({
            text: spoken,
            voice: providerId(speaker),
            model,
            settings: { ...settings, speed: tts.speed },
            ...(takesLanguage(model) && { language: text.language }),
          })
          if (!audio.length) throw new Error('ElevenLabs sent no audio')
        } catch (error) {
          // Nothing was made, so nothing is charged.
          sitting?.refund(credits)
          throw error
        } finally {
          landed?.()
        }
        paid = true
        // Logged as soon as ElevenLabs made it: it is paid for even if it cannot be kept.
        try {
          await appendTry(projectFile, {
            id: randomUUID(),
            at: new Date().toISOString(),
            kind: text.kind,
            character: text.character,
            ...(text.part !== undefined && { part: text.part }),
            language: text.language,
            model,
            characters: [...spoken].length,
            credits,
          })
        } catch {
          // Only the record of what it cost is lost; the take stays.
        }
        await writeAtomic(root, takePath(key), audio)
        return { made: 'made' }
      },
    )
  try {
    let outcome = await run()
    // A run shared with another request that was not paid for (its sitting was short or had
    // ended) is not this one's answer: this one tries on its own, with its own money.
    // Several may be queued so: each pass either runs this request's own job or shares a run
    // whose owner's job finished it, so this ends; the bound only guards against a bug.
    for (let pass = 0; !ran && !('made' in outcome) && pass < 20; pass++) outcome = await run()
    if ('ended' in outcome) {
      return { ok: false, reason: 'no-sitting', message: 'The audition’s sitting has ended.' }
    }
    if ('waits' in outcome) {
      return {
        ok: false,
        reason: 'waits',
        message: `Take waits for more credits: ${outcome.waits}`,
      }
    }
    if (!existsSync(file)) {
      return { ok: false, reason: 'elevenlabs', message: 'The take could not be kept.' }
    }
    return { ok: true, key, spoken, cached: !paid, ...said, ...(paid && { credits }) }
  } catch (error) {
    return {
      ok: false,
      reason: 'elevenlabs',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** The audition phrase and the takes already recorded for it, by voice, or why not. */
export type AuditionTakesResult =
  | { ok: true; audition: AuditionText; takes: Record<string, string> }
  | { ok: false; problems: Problem[] }
  | null

/** A character's audition phrase and which of `voiceIds` already have a take of it. */
export async function auditionTakes(
  projectFile: string,
  characterId: string,
  voiceIds: string[],
  asked?: string,
): Promise<AuditionTakesResult> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return { ok: false, problems: loaded.problems }
  const { project, cast, summary } = loaded
  if (!summary.characters.some((c) => c.id === characterId)) return null
  if (!cast) return { ok: false, problems: castProblems(project, summary.problems) }
  const seen = auditionIn(project, cast, summary, characterId, asked)
  return {
    ok: true,
    audition: seen.audition,
    takes: recordedTakes(
      dirname(projectFile),
      project,
      seen.cast,
      characterId,
      seen.audition,
      voiceIds,
    ),
  }
}

/**
 * A character's audition in a language (the source language's when none is asked for, or the
 * project lacks it): the language, the cast as that language sees it, and what the character says.
 */
export function auditionIn(
  project: Project,
  cast: Cast,
  summary: ProjectSummary,
  characterId: string,
  asked?: string,
): { language: string; cast: Cast; audition: AuditionText } {
  const { languages } = project.narration
  const language = declaredLanguage(project.narration, asked)
  const seen = projectCast(cast, language, languages[0]!)
  const longest = summary.characters.find((c) => c.id === characterId)?.languages[language]?.longest
  return {
    language,
    cast: seen,
    audition: auditionText(
      seen.speakers[characterId] ?? {},
      cast.pronounce,
      project.narration,
      language,
      longest ?? null,
    ),
  }
}

/**
 * The keys of the takes already recorded, by voice, for the character's current phrase in
 * `language`, on `model` (the audition model, the board's; the free one for the cast voice's on its
 * page; ElevenLabs' audition model for an ElevenLabs voice's).
 */
export function recordedTakes(
  root: string,
  project: Project,
  cast: Cast,
  characterId: string,
  text: AuditionText,
  voiceIds: string[],
  model: string = project.narration.models.audition,
  language: string = project.narration.languages[0]!,
): Record<string, string> {
  const takes: Record<string, string> = {}
  for (const voice of voiceIds) {
    const key = takeOf(project, voice, text, cast, characterId, model, language)
    if (existsSync(resolveInRoot(root, takePath(key)))) takes[voice] = key
  }
  return takes
}

/** The file of a recorded take, or null if the key is not a take key or has no file. */
export async function takeFile(projectFile: string, key: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}$/.test(key)) return null
  const file = join(resolveInRoot(dirname(projectFile), TAKES_DIR), `${key}.mp3`)
  return existsSync(file) ? file : null
}

/** The problems of the cast file, out of all the project's. */
export function castProblems(project: Project, problems: Problem[]): Problem[] {
  return problems.filter((problem) => problem.file === project.narration.characters)
}

/** Where a character's own phrase is in the cast, as a problem path. */
export function phrasePath(characterId: string, language?: string): string {
  const id = /^[A-Za-z_][\w-]*$/.test(characterId)
    ? `.${characterId}`
    : `[${JSON.stringify(characterId)}]`
  return language === undefined
    ? `speakers${id}.audition.phrase`
    : `speakers${id}.languages.${language}.phrase`
}

function takePath(key: string): string {
  return `${TAKES_DIR}/${key}.mp3`
}

function takeOf(
  project: Project,
  voice: string,
  text: AuditionText,
  cast: Cast,
  characterId: string,
  model: string,
  language: string,
): string {
  const { tts } = project.narration
  const settings = ttsFor(tts, cast.speakers[characterId])
  if (providerOf(voice) === 'elevenlabs') {
    // An ElevenLabs voice's page take, as `speakEleven` keeps it.
    return elevenTake(project, voice, settings, pageText(text, cast, characterId), language).key
  }
  return takeKey({ model, voice, spoken: text.spoken, tts: settings })
}

/**
 * What one take of the character's audition phrase costs with an ElevenLabs voice, whichever:
 * ElevenLabs' audition model and its credits, for the sitting's box and meter.
 */
export function elevenTakeCost(
  project: Project,
  cast: Cast,
  characterId: string,
  text: AuditionText,
): { model: string; perTake: number } {
  const { model, credits } = elevenPageTake(project, cast, characterId, text, ELEVEN_ANY, '')
  return { model, perTake: credits }
}

/** A voice id standing for any ElevenLabs voice: what a take costs does not depend on which. */
const ELEVEN_ANY = 'eleven:any'

/**
 * What the cast voice's page take costs with an ElevenLabs voice, before it is recorded: the
 * audition model, its credits, and whether the character's style is left out because the model
 * would speak it.
 */
export function elevenPageTake(
  project: Project,
  cast: Cast,
  characterId: string,
  text: AuditionText,
  voice: string,
  language: string,
): { model: string; credits: number; cuesLeftOut: boolean } {
  const tts = ttsFor(project.narration.tts, cast.speakers[characterId])
  const page = pageText(text, cast, characterId)
  const { model, spoken, cues } = elevenTake(project, voice, tts, page, language)
  return { model, credits: elevenCredits(model, spoken)!, cuesLeftOut: !cues && page.cued }
}

/**
 * What an ElevenLabs take or try is made of: the audition model, the text it is sent (`withCues`,
 * or `bare` for a model that would speak them) and its take key with the project's voice settings
 * and, for a model told the language, the language.
 */
function elevenTake(
  project: Project,
  voice: string,
  tts: Project['narration']['tts'],
  { withCues, bare }: Pick<ElevenText, 'withCues' | 'bare'>,
  language: string,
): { model: string; spoken: string; key: string; cues: boolean } {
  const { elevenlabs } = project.narration
  const model = elevenlabs.models.audition
  const cues = readsCues(model)
  const spoken = cues ? withCues : bare
  const told = takesLanguage(model) ? { language } : {}
  return {
    model,
    spoken,
    cues,
    key: takeKey({ model, voice, spoken, tts, eleven: elevenlabs.tts, ...told }),
  }
}
