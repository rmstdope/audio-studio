import { basename, dirname } from 'node:path'
import { z } from 'zod'
import { setKeywords, setPhrase, setSpeed, setStyle, type FishFactory } from '../services/auditions'
import { createLimiter } from '../services/limit'
import { costCeiling, creditCeiling, planGeneration } from '../core/generation'
import type { LineState } from '../core/planner'
import { createImageFineTunes } from '../services/imageFineTunes'
import { createImagePatches } from '../services/imagePatches'
import { CAST_FILE } from '../core/project'
import { providerOf } from '../core/voices'
import { finalStepFor, modelForStage, voicesOf } from '../core/elevenSpeech'
import type { ElevenAnswer } from '../core/setup'
import {
  accountOf,
  createElevenLabsClient,
  elevenFromEnv,
  NO_ELEVENLABS_KEY,
  type ElevenLabsFactory,
} from '../services/elevenlabs'
import { createElevenMusic } from '../services/elevenMusic'
import { elevenLabsApiKey } from '../services/env'
import {
  isPaid,
  sittingMoney,
  suggestedAmount,
  suggestedCredits,
  type SittingView,
} from '../core/sitting'
import {
  createBudget,
  creditProblem,
  creditsLeft,
  spendProblem,
  type Budget,
  type SpendProblem,
} from '../core/spend'
import { planPart } from '../core/planner'
import { sentPieces } from '../core/spoken'
import { createJobs } from '../services/jobs'
import { appendMusic, createSpendLog } from '../services/spending'
import { type ModelsChange } from '../services/models'
import type { Stage } from '../core/models'
import type { Busy } from '../core/models'
import { type RuledOutResult } from '../services/ruledOut'
import { auditionMoney, viewOf, SESSIONS_DIR, type SessionResult } from '../services/sessions'
import { voiceToSpeak } from '../services/elevenVoices'
import type { Voice } from '../core/voiceSearch'
import { fishFromEnv, NO_KEY, type CreditResult } from '../services/fish'
import { onGpu, onGpuFree } from '../services/gpu'
import { createAceStepWorker, createMusicRouter, type MusicGenerator } from '../services/music'
import { createStableAudioWorker } from '../services/stableAudio'
import { createFakeMusic } from '../services/musicFake'
import { createEffectHealth } from '../services/effectHealth'
import {
  createEffectGenerator,
  createEffectsWorker,
  createOpenEffects,
  type EffectGenerator,
} from '../services/effects'
import { createEffectTakes } from '../services/effectTakes'
import { createFakeEffects } from '../services/effectsFake'
import { createMusicTakes } from '../services/musicTakes'
import { createImageHealth } from '../services/imageHealth'
import { createImageTakes } from '../services/imageTakes'
import { createMfluxGenerator } from '../services/images'
import { createFakeImages } from '../services/imagesFake'
import { createWhisperWorker, type Transcriber } from '../services/transcriber'
import { declaredLanguage } from '../core/project'
import { cacheNameFor, loadProject, openProject, readPart } from '../services/workspace'
import {
  allowedHosts,
  type Given,
  CharacterBody,
  SHOWN_ACCOUNT_MS,
  StageModelBody,
  StageParam,
  forbidden,
  languageOf,
  notFound,
  type RouteRequest,
} from './shared'
import type { ServerOptions } from './index'

/**
 * The process's one sound effects generator, kept across `--dev` reloads like the music workers:
 * Small SFX's worker and Open 1.0 on the music's Stable Audio worker (`music`), each started with
 * its first effect and ended with the studio.
 */
export function sharedEffects(music: MusicGenerator): EffectGenerator {
  const state = globalThis as { contentStudioEffects?: EffectGenerator }
  return (state.contentStudioEffects ??=
    process.env.CONTENT_STUDIO_FAKE_EFFECTS === '1'
      ? createFakeEffects()
      : createEffectGenerator({
          'small-sfx': createEffectsWorker(),
          'open-1': createOpenEffects(music),
        }))
}

/**
 * The process's one Whisper worker, kept across `--dev` reloads (which rerun this module) so a
 * reload never leaves a worker and its model behind. It starts on its first take and exits when
 * the studio does.
 */
export function sharedWhisper(): Transcriber {
  const state = globalThis as { contentStudioWhisper?: Transcriber }
  if (!state.contentStudioWhisper) {
    state.contentStudioWhisper = createWhisperWorker()
    onGpuFree(() => state.contentStudioWhisper?.close())
  }
  return state.contentStudioWhisper
}

/**
 * The process's music generators as one, kept across `--dev` reloads like Whisper's: the ACE-Step
 * and Stable Audio workers, each started with its first take and ended with the studio, and Eleven
 * Music, with the project's ElevenLabs key read on every use. `CONTENT_STUDIO_FAKE_MUSIC=1` swaps
 * them for a stand-in that makes tones, for working on the pages.
 */
export function sharedMusic(projectFile: string): MusicGenerator {
  const state = globalThis as { contentStudioMusic?: MusicGenerator }
  if (!state.contentStudioMusic) {
    state.contentStudioMusic =
      process.env.CONTENT_STUDIO_FAKE_MUSIC === '1'
        ? createFakeMusic()
        : createMusicRouter({
            acestep: createAceStepWorker(),
            'stable-audio': createStableAudioWorker(),
            elevenlabs: createElevenMusic({
              apiKey: async () => {
                const opened = await openProject(projectFile)
                return opened.ok ? elevenLabsApiKey(dirname(projectFile), opened.project.env) : null
              },
            }),
          })
    // An image take closes the music workers first (they come back with the next take).
    onGpuFree(() => state.contentStudioMusic?.close())
  }
  return state.contentStudioMusic
}

/**
 * Everything the routes share: the studio's generators and queues, its counters of what is going
 * on and what is held, and the guards a route goes through. Built once by `startServer`.
 */
export function createContext({
  projectFile,
  fish,
  encode,
  transcriber,
  music,
  elevenlabs,
  images,
  effects,
}: ServerOptions) {
  /** The port the server listens on, set once it does: the guards need it. */
  const listening: { port?: number } = {}
  function hosts(): string[] {
    return allowedHosts(listening.port!)
  }

  const imageGenerator =
    images ??
    (process.env.CONTENT_STUDIO_FAKE_IMAGES === '1' ? createFakeImages() : createMfluxGenerator())
  const imagePatches = createImagePatches({ generator: imageGenerator })
  const imageHealth = createImageHealth()
  const imageTakes = createImageTakes({ generator: imageGenerator, health: imageHealth })
  const imageFineTunes = createImageFineTunes({ generator: imageGenerator, takes: imageTakes })
  const musicGenerator = music ?? sharedMusic(projectFile)
  const effectGenerator = effects ?? sharedEffects(musicGenerator)
  const effectHealth = createEffectHealth()
  const effectTakes = createEffectTakes({
    generator: effectGenerator,
    health: effectHealth,
    ...(encode ? { encode } : {}),
  })
  const musicTakes = createMusicTakes({
    generator: musicGenerator,
    ...(encode ? { encode } : {}),
    // A paid take is a row of the spending record (its version 2).
    spent: async (file, take) => {
      const saved = await appendMusic(file, take)
      if (!saved.ok) {
        console.error(
          'Content Studio: a paid music take was not saved to the spending record:',
          saved.problems,
        )
      }
    },
  })
  /** The Fish client: the one given (tests), else made from the project's API key on every use. */
  const fishFor: FishFactory = fish !== undefined ? async () => fish : fishFromEnv
  /** The ElevenLabs client: the one given (tests; null for none), else made from the project's key on every use. */
  const elevenFor: ElevenLabsFactory =
    elevenlabs !== undefined ? async () => elevenlabs : elevenFromEnv
  /** A character's ruled-out voices as an answer: 404 for an unknown character, 409 for a broken project. */
  async function ruledOut(pending: Promise<RuledOutResult>): Promise<Response> {
    const result = await pending
    if (!result) return notFound()
    return Response.json(result, { status: result.ok ? 200 : 409 })
  }

  /** A session action's answer: the session as the page shows it; 404 for an unknown character. */
  async function answer(
    characterId: string,
    pending: Promise<SessionResult>,
    options: { recorded?: boolean; language?: string } = {},
  ): Promise<Response> {
    const result = await pending
    if (!result) return notFound()
    const view = await viewOf(projectFile, characterId, result, options)
    return Response.json(view, { status: view.ok ? 200 : 409 })
  }

  /**
   * The language a request means, as the project declares it (the source language's if unknown).
   * Jobs need the code itself, as they are kept by part and language; the services given the
   * raw `?language=` settle it themselves.
   */
  async function languageFor(request: Request): Promise<string | undefined> {
    const opened = await openProject(projectFile)
    return opened.ok ? declaredLanguage(opened.project, languageOf(request)) : undefined
  }

  /** Fish TTS requests (audition takes and lines alike): `generate.parallel` at a time, each once. */
  const fishWork = createLimiter()
  /** ElevenLabs' requests wait for each other only, never for Fish's. */
  const elevenWork = createLimiter()
  /** Generation jobs, one per part at a time. */
  const jobs = createJobs()

  /** What is asking Fish now outside a job: a part's line being recorded or tried, a character's audition. */
  const going = new Map<string, number>()

  /** Runs one request that records or auditions, which counts as going on until it answers. */
  async function whileGoing<T>(kind: 'part' | 'character', id: string, run: () => Promise<T>) {
    const key = `${kind}:${id}`
    going.set(key, (going.get(key) ?? 0) + 1)
    try {
      return await run()
    } finally {
      const left = (going.get(key) ?? 1) - 1
      if (left > 0) going.set(key, left)
      else going.delete(key)
    }
  }

  /** What is recording or auditioning now, which stops the models being changed; null if nothing. */
  async function busyNow(): Promise<Busy | null> {
    const opened = await openProject(projectFile)
    if (!opened.ok) return null
    const { parts } = opened.project
    const titleOf = (id: string) => parts.find((p) => p.id === id)?.title ?? id
    const underway = (kind: 'part' | 'character') =>
      [...going.keys()].find((key) => key.startsWith(`${kind}:`))?.slice(kind.length + 1)
    const recording = jobs.active()[0] ?? spendLog.running()[0]?.part ?? underway('part')
    if (recording !== undefined) return { kind: 'recording', name: titleOf(recording) }
    const character = underway('character')
    if (character === undefined) return null
    const loaded = await loadProject(projectFile)
    const name = loaded.ok ? loaded.summary.characters.find((c) => c.id === character)?.name : null
    return { kind: 'auditioning', name: name ?? character }
  }

  /** The account's remaining credit, or why it cannot be read. */
  async function creditOf(): Promise<CreditResult> {
    const opened = await openProject(projectFile)
    if (!opened.ok)
      return { ok: false, reason: 'project', message: 'The project file cannot be read.' }
    const client = await fishFor(dirname(projectFile), opened.project)
    if (!client) {
      return {
        ok: false,
        reason: 'no-key',
        message: NO_KEY,
      }
    }
    try {
      return { ok: true, credit: await client.credit() }
    } catch (error) {
      return {
        ok: false,
        reason: 'fish',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * The ElevenLabs account, asked with the key Setup found: through the client given (tests; null
   * is none, so nothing is asked), else one made from that key.
   */
  async function elevenAccountOf(apiKey: string): Promise<ElevenAnswer> {
    const client = elevenlabs !== undefined ? elevenlabs : createElevenLabsClient(apiKey)
    return client
      ? accountOf(client)
      : { ok: false, reason: 'no-key', message: 'No ElevenLabs client.' }
  }

  /**
   * Admits a recording on `model` costing at most `ceiling`: a budget for it (the confirmed
   * dollars, held back from the credit while it runs; release it with `budgets.delete`), or why
   * not. The credit is asked for only once a paid cost is confirmed.
   */
  function admit(
    model: string,
    ceiling: number | null,
    confirmed?: number,
  ): Promise<{ budget: Budget } | { problem: SpendProblem }> {
    const asked = spendProblem({ ceiling, confirmed })
    if (asked && asked.reason !== 'credit') return Promise.resolve({ problem: asked })
    // Free: nothing to hold back, so no need to wait for anyone else's credit check.
    if (!ceiling) return Promise.resolve({ budget: createBudget({ model, dollars: 0 }) })
    // The budget is what was confirmed, rounded to cents at most a cent above the ceiling; the
    // credit is checked against that whole budget.
    const dollars = Math.min(confirmed ?? ceiling, ceiling + 0.01)
    return (async () => {
      // A recording that ends while the credit is read may not be billed in that reading yet:
      // what was held back when it was asked for is still counted.
      const heldWhenAsked = new Set(budgets)
      const credit = await creditOf()
      // From here to adding the budget nothing awaits, so two recordings asked for at once cannot
      // both count on the same credit: the second sees the first's budget held back.
      const free = credit.ok ? credit.credit - reserved(heldWhenAsked) : null
      const problem = spendProblem({ ceiling: dollars, confirmed: dollars, credit: free })
      if (problem) return { problem }
      const budget = createBudget({ model, dollars })
      budgets.add(budget)
      return { budget }
    })()
  }

  /**
   * Admits a recording on ElevenLabs' `model` taking at most `ceiling` credits: a budget for it
   * (the confirmed credits, held back from what the plan has left while it runs; release it with
   * `held.delete`), or why not. The account is asked only once the credits are confirmed.
   */
  async function admitCredits(
    model: string,
    ceiling: number,
    confirmed?: number,
    replacing?: Budget,
  ): Promise<{ budget: Budget } | { problem: SpendProblem }> {
    const asked = creditProblem({ ceiling, confirmed, left: Infinity })
    if (asked) return { problem: asked }
    if (!ceiling) return { budget: createBudget({ model, dollars: 0 }) }
    // The confirmation covers the ceiling; what is held is the ceiling up to the whole credit.
    const credits = Math.ceil(ceiling)
    const budget = createBudget({ model, dollars: credits })
    const problem = await holdCredits(credits, () => creditBudgets.add(budget), replacing)
    return problem ? { problem } : { budget }
  }

  /**
   * Checks that the plan has `credits` free beyond what running recordings and sittings hold (but
   * `replacing`, a sitting's credits about to be replaced), and if so calls `hold` before anything
   * else can run, so two of them cannot count on the same credits; else gives the problem (no key,
   * unknown, too few).
   */
  async function holdCredits(
    credits: number,
    hold: () => void,
    replacing?: Budget,
  ): Promise<SpendProblem | null> {
    const opened = await openProject(projectFile)
    const client = opened.ok ? await elevenFor(dirname(projectFile), opened.project) : null
    if (!client) return { reason: 'credits', message: NO_ELEVENLABS_KEY }
    // As with Fish's credit: what was held back when the account was asked is still counted.
    const heldWhenAsked = new Set(creditBudgets)
    const answer = await accountOf(client)
    // From here to `hold` nothing awaits.
    const holding = [...new Set([...creditBudgets, ...heldWhenAsked])]
    // A sitting about to be replaced holds only its takes in flight, which ElevenLabs may still bill.
    const held = holding.reduce(
      (sum, b) => sum + (b === replacing ? (creditsInFlight.get(b) ?? 0) : heldCredits(b)),
      0,
    )
    const left = answer.ok ? creditsLeft(answer.account) - held - landingCredits() : null
    const problem = creditProblem({ ceiling: credits, confirmed: credits, left })
    if (!problem) hold()
    return problem
  }

  /** The credits running recordings and audition sittings hold back from the plan. */
  function elevenHeld(): number {
    return (
      [...creditBudgets].reduce((sum, budget) => sum + heldCredits(budget), 0) + landingCredits()
    )
  }

  /**
   * The ElevenLabs account as plans show it: asked at most every half minute, since a part's plan
   * is asked for again after every line recorded. Admission always asks afresh.
   */
  let shown: { at: number; answer: Promise<ElevenAnswer> } | null = null
  /** Forgets the account as last shown, so the next view asks ElevenLabs afresh. */
  function forgetShownAccount() {
    shown = null
  }
  async function shownAccount(): Promise<ElevenAnswer> {
    if (shown && Date.now() - shown.at < SHOWN_ACCOUNT_MS) return shown.answer
    const opened = await openProject(projectFile)
    const client = opened.ok ? await elevenFor(dirname(projectFile), opened.project) : null
    const answer: Promise<ElevenAnswer> = client
      ? accountOf(client)
      : Promise.resolve({ ok: false, reason: 'no-key', message: NO_ELEVENLABS_KEY })
    shown = { at: Date.now(), answer }
    return answer
  }

  /**
   * The ElevenLabs budgets of the recordings and audition sittings running now: held back from
   * what the plan has left until they end (`heldCredits` says how much).
   */
  const creditBudgets = new Set<Budget>()
  /**
   * What an ElevenLabs budget holds back from the plan: all a recording was given, but only what
   * is left of a sitting, and what its takes in flight cost, as Fish's sittings hold dollars.
   */
  const heldCredits = (budget: Budget) =>
    [...creditSittings.values()].includes(budget)
      ? budget.left + (creditsInFlight.get(budget) ?? 0)
      : budget.dollars
  /** What ElevenLabs takes sent but not finished cost, per sitting. */
  const creditsInFlight = new Map<Budget, number>()
  /**
   * Sittings ended (or replaced) with takes still in flight: what those takes cost stays held
   * until each lands, since ElevenLabs may bill them all the same.
   */
  const landing = new Set<Budget>()
  const landingCredits = () =>
    [...landing].reduce((sum, b) => sum + (creditsInFlight.get(b) ?? 0), 0)

  /**
   * Admits recording `keys` of a planned part: a Fish budget in dollars and an ElevenLabs one in
   * credits, each confirmed in its own unit, or the first problem. `release` gives both back.
   */
  async function admitBoth(
    planned: {
      model: string
      elevenModel: string
      ceilingOf: (keys: string[], takes?: number) => number | null
      creditsOf: (keys: string[], takes?: number) => number
    },
    keys: string[],
    confirmed: { confirmedCost?: number; confirmedCredits?: number },
    takes?: number,
  ): Promise<{ budget: Budget; credits: Budget; release: () => void } | { problem: SpendProblem }> {
    const fish = await admit(planned.model, planned.ceilingOf(keys, takes), confirmed.confirmedCost)
    if ('problem' in fish) return fish
    const eleven = await admitCredits(
      planned.elevenModel,
      planned.creditsOf(keys, takes),
      confirmed.confirmedCredits,
    )
    if ('problem' in eleven) {
      budgets.delete(fish.budget)
      return eleven
    }
    return {
      budget: fish.budget,
      credits: eleven.budget,
      release: () => {
        budgets.delete(fish.budget)
        creditBudgets.delete(eleven.budget)
      },
    }
  }

  /**
   * The budgets of the recordings running now. All they were given is held back from the credit
   * until they end: Fish may bill a request some time after it was charged to its budget.
   */
  const budgets = new Set<Budget>()
  const reserved = (also: Set<Budget> = new Set()) =>
    [...new Set([...budgets, ...also])].reduce((sum, budget) => sum + held(budget), 0)
  /**
   * What a budget holds back from the credit: all a recording was given (Fish may bill it after
   * it was charged), but only what is left of a sitting, which lasts a whole audition: what it
   * spent is already out of the credit Fish reports.
   */
  const held = (budget: Budget) =>
    isSitting(budget) ? budget.left + (inFlight.get(budget) ?? 0) : budget.dollars
  /**
   * Notes `amount` in flight for `budget` in `map` (a take sent, not finished), and gives what
   * takes it off again once the take is done.
   */
  function flightIn(map: Map<Budget, number>, budget: Budget, amount: number): () => void {
    map.set(budget, (map.get(budget) ?? 0) + amount)
    return () => {
      const now = map.get(budget)
      if (now === undefined) return
      const rest = Math.max(now - amount, 0)
      map.set(budget, rest)
      // An ended sitting's last take has landed: nothing of it is held any more.
      if (rest === 0 && landing.delete(budget)) map.delete(budget)
    }
  }
  /** What takes sent but not finished cost, per sitting: Fish's credit may not show it yet. */
  const inFlight = new Map<Budget, number>()
  const isSitting = (budget: Budget) => [...sittings.values()].includes(budget)

  /**
   * The sittings of the auditions going on, by character: what each may still spend on the
   * audition model's paid takes. In memory only, so a sitting ends with the studio. Each one is
   * also in `budgets`, so its money is held back from the credit while it lasts.
   */
  const sittings = new Map<string, Budget>()
  /**
   * The ElevenLabs credits of the same sittings, for board takes of ElevenLabs voices; each is also
   * in `creditBudgets`, so what it has left is held back from the plan while it lasts.
   */
  const creditSittings = new Map<string, Budget>()

  /** What a character's sitting is kept under: its id and the language of the audition it is for. */
  const sittingKey = (characterId: string, request: Request) =>
    cacheNameFor(projectFile, characterId, languageOf(request))

  /**
   * The id a shortlisted voice of ElevenLabs' library is cast as: the voice it became when the
   * studio added it, added now if it was not (once).
   */
  async function saveToAccount(voice: Voice, characterId: string): Promise<string> {
    const id = await voiceToSpeak(
      projectFile,
      async () => {
        const opened = await openProject(projectFile)
        return opened.ok ? elevenFor(dirname(projectFile), opened.project) : null
      },
      voice,
      characterId,
    )
    // It may have taken a voice slot: the board asks for the account afresh.
    shown = null
    return id
  }

  /** The refusal to offer or remove voices while what is in use cannot be read, naming the files. */
  async function unknownUse(): Promise<Response> {
    const opened = await openProject(projectFile)
    const cast = opened.ok ? CAST_FILE : 'The cast'
    return Response.json(
      {
        ok: false,
        reason: 'unknown-use',
        message: `${cast} or a saved audition in ${SESSIONS_DIR} can’t be read, so no ElevenLabs voice is offered for removal. Fix it and try again.`,
      },
      { status: 409 },
    )
  }

  /** Ends a character's sitting: what was left is not kept, and the credit is free again. */
  function endSitting(characterId: string) {
    const budget = sittings.get(characterId)
    if (budget) {
      budgets.delete(budget)
      inFlight.delete(budget)
    }
    sittings.delete(characterId)
    endCredits(characterId)
  }

  /**
   * Makes `key`'s sitting a fresh one, in place of both halves of any it had: dollars on a paid
   * audition model (`amount`, which it needs), and ElevenLabs credits when `credits` are asked
   * for. Both are admitted before anything is replaced, so a refusal leaves the sitting as it was
   * and holds nothing; the old dollars are held while the new are checked (less than a take, when
   * the old sitting is used up), the old credits are not counted against the new.
   */
  async function freshSitting(
    key: string,
    money: { model: string; eleven: { model: string } },
    { amount, credits }: { amount?: number; credits?: number },
  ): Promise<Given | { problem: SpendProblem }> {
    const given: Given = {}
    const paid = isPaid(money.model, new Date())
    // Nothing to give: a free model's dollars are not a sitting, and an old one is left alone.
    if (!paid && credits === undefined) {
      return {
        problem: {
          reason: 'confirm-credits',
          ceiling: 0,
          message: `Takes with ${money.model} are free; give credits for ElevenLabs voices’ takes.`,
        },
      }
    }
    if (paid) {
      if (amount === undefined) {
        return {
          problem: {
            reason: 'confirm',
            ceiling: 0,
            message: `Takes with ${money.model} are paid; say how much the audition may spend.`,
          },
        }
      }
      const got = await admit(money.model, amount, amount)
      if ('problem' in got) return got
      given.dollars = got.budget
    }
    if (credits !== undefined) {
      const got = await admitCredits(money.eleven.model, credits, credits, creditSittings.get(key))
      if ('problem' in got) {
        if (given.dollars) budgets.delete(given.dollars)
        return got
      }
      given.credits = got.budget
    }
    // After the credit was read, so two at once cannot leave a budget behind.
    endSitting(key)
    if (given.dollars) sittings.set(key, given.dollars)
    if (given.credits) creditSittings.set(key, given.credits)
    return given
  }

  /** Ends the halves `given` gave `key`'s sitting, if they are still its own. */
  function endGiven(key: string, given: Given) {
    if (given.dollars && sittings.get(key) === given.dollars) {
      budgets.delete(given.dollars)
      inFlight.delete(given.dollars)
      sittings.delete(key)
    }
    if (given.credits && creditSittings.get(key) === given.credits) endCredits(key)
  }

  /**
   * Ends a sitting's ElevenLabs credits alone: what was left is free again, but what its takes in
   * flight cost stays held until they land (`landing`).
   */
  function endCredits(characterId: string) {
    const credits = creditSittings.get(characterId)
    if (credits) {
      creditBudgets.delete(credits)
      if (creditsInFlight.get(credits)) landing.add(credits)
      else creditsInFlight.delete(credits)
    }
    creditSittings.delete(characterId)
  }

  /** The money of a character's audition for the page; null for an unknown character. */
  async function sittingView(characterId: string, key: string, language?: string) {
    const money = await auditionMoney(projectFile, characterId, language)
    if (!money || !money.ok) return money
    const paid = isPaid(money.model, new Date())
    const budget = paid ? sittings.get(key) : undefined
    const credits = creditSittings.get(key)
    const view: SittingView = {
      model: money.model,
      paid,
      perTake: money.perTake,
      suggested: paid ? suggestedAmount(money.perTake) : 0,
      spentBefore: money.spentBefore,
      sitting: budget ? sittingMoney(budget.dollars, budget.left, money.perTake) : null,
      eleven: {
        ...money.eleven,
        suggested: suggestedCredits(money.eleven.perTake),
        sitting: credits ? sittingMoney(credits.dollars, credits.left, money.eleven.perTake) : null,
      },
    }
    return { ok: true as const, ...view }
  }

  /** A sitting's answer: its money, or why it was refused (409), or 404 for an unknown character. */
  async function sittingAnswer(
    request: Request,
    characterId: string,
    refused?: SpendProblem | null,
  ) {
    if (refused) return Response.json({ ok: false, ...refused }, { status: 409 })
    const view = await sittingView(
      characterId,
      await sittingKey(characterId, request),
      languageOf(request),
    )
    if (!view) return notFound()
    return Response.json(view, { status: view.ok ? 200 : 409 })
  }

  /** The take checker: the one given (tests), else the process's one Whisper worker. */
  async function transcriberFor(): Promise<Transcriber | null> {
    return transcriber !== undefined ? transcriber : onGpu(sharedWhisper())
  }

  /** What generating a part (or one speaker in it) would do, or why it can't be planned. */
  /** Saves the one field of a character a PATCH changes. */
  function changeCharacter(id: string, change: z.infer<typeof CharacterBody>, language?: string) {
    if ('keywords' in change) return setKeywords(projectFile, id, change.keywords)
    if ('style' in change) return setStyle(projectFile, id, change.style)
    if ('speed' in change) return setSpeed(projectFile, id, change.speed, language)
    return setPhrase(projectFile, id, change.phrase, language)
  }

  async function planFor(
    part: string,
    speaker?: string,
    includeWeak = false,
    asked: 'draft' | 'final' = 'draft',
    language?: string,
  ) {
    const read = await readPart(projectFile, part, language)
    if (!read) return null
    if (!read.ok) return read
    if (read.problems.length) return { ok: false as const, problems: read.problems }
    const { project } = read
    const { narration } = project
    // Without a final step for its voices (one model for both, on each one's provider), the final
    // plan is the draft one.
    const stage: 'draft' | 'final' =
      asked === 'final' &&
      finalStepFor(narration, voicesOf(read.input.lines, read.input.cast.speakers))
        ? 'final'
        : 'draft'
    const { pronounce, speakers } = read.input.cast
    const state = planPart(read.input)
    // A line with an ElevenLabs voice is recorded, and priced, by ElevenLabs.
    const elevenModelOf = (line: { speaker: string }) => {
      const voice = speakers[line.speaker]?.voice ?? ''
      return providerOf(voice) === 'elevenlabs' ? modelForStage(narration, voice, stage) : null
    }
    const pricing = {
      at: new Date(),
      model: narration.models.fish[stage],
      // What is sent: each piece of a line with its cue (for a model that reads cues) and the
      // cast's pronunciations.
      sent: (line: LineState) =>
        sentPieces(
          line,
          elevenModelOf(line) ?? narration.models.fish[stage],
          pronounce,
          narration.generate.chunkLimit,
        ),
      takes: narration.generate.transcriber === 'none' ? 1 : narration.generate.takes,
      elevenModelOf,
    }
    const plan = planGeneration(state, {
      ...pricing,
      speaker,
      checked: narration.generate.transcriber !== 'none',
      includeWeak,
      final: stage === 'final',
    })
    // The most recording these lines can cost, priced as the plan was: Fish's in dollars,
    // ElevenLabs' in credits.
    const ceilingOf = (keys: string[], takes = pricing.takes) =>
      costCeiling(state, keys, { ...pricing, takes })
    const creditsOf = (keys: string[], takes = pricing.takes) =>
      creditCeiling(state, keys, { ...pricing, takes })
    return {
      ok: true as const,
      plan,
      model: pricing.model,
      // The stage's ElevenLabs model, which every ElevenLabs line of the part is recorded with.
      elevenModel: narration.models.elevenlabs[stage],
      ceilingOf,
      creditsOf,
      parallel: narration.generate.parallel,
      stage,
      // Recording is in the source language.
      language: project.languages[0] ?? 'en',
    }
  }

  /** The paid recordings of this studio: running ones live, finished ones saved. */
  const spendLog = createSpendLog(projectFile)

  /**
   * Runs one request's recording of a single line, following it in the spend log: it counts as one
   * line recorded when the result is a recording, and is saved if it spent anything.
   */
  async function loggedOne<T extends { ok: boolean } | null>(
    planned: { model: string; stage: 'draft' | 'final'; language: string },
    part: string,
    { budget, credits }: { budget: Budget; credits?: Budget },
    run: () => Promise<T>,
  ): Promise<T> {
    const followed = spendLog.follow({
      part,
      ...planned,
      planned: 1,
      budget,
      credits,
      progress: () => ({ lines: 0 }),
    })
    let result: T | undefined
    try {
      result = await run()
      return result
    } finally {
      const recorded = result?.ok === true && !(result && 'skipped' in result)
      await followed.end({ lines: recorded ? 1 : 0, outcome: recorded ? 'done' : 'error' })
    }
  }

  /**
   * Saves one stage's model with `save` (Fish's or ElevenLabs'), from the body's `{ model, was }`:
   * 404 for a stage that is not one, and refused while a part records or a character auditions,
   * naming it, so no recording changes model under its feet.
   */
  async function putStageModel(
    request: Request,
    asked: string,
    path: string,
    save: (projectFile: string, stage: Stage, model: string, was: string) => Promise<ModelsChange>,
  ): Promise<Response> {
    const stage = StageParam.safeParse(asked)
    if (!stage.success) return notFound()
    const body = StageModelBody.safeParse(await request.json().catch(() => null))
    if (!body.success) {
      return Response.json({ error: 'expected { model, was }' }, { status: 400 })
    }
    const busy = await busyRefusal(`${path}.${stage.data}`)
    if (busy) return busy
    const result = await save(projectFile, stage.data, body.data.model, body.data.was)
    return Response.json(result, { status: result.ok ? 200 : 409 })
  }

  /**
   * The refusal of a save at `path` while a part records or a character auditions, naming it, so
   * no recording changes what it records with under its feet; null when nothing is going on.
   */
  async function busyRefusal(path: string): Promise<Response | null> {
    const busy = await busyNow()
    if (!busy) return null
    return Response.json(
      {
        ok: false,
        problems: [{ file: basename(projectFile), path, message: `${busy.name} is ${busy.kind}` }],
      },
      { status: 409 },
    )
  }

  /** Only requests addressed to the studio itself reach `handler`. */
  const guard =
    <R extends Request = RouteRequest>(handler: (request: R) => Response | Promise<Response>) =>
    (request: R) =>
      hosts().includes(request.headers.get('host')?.toLowerCase() ?? '')
        ? handler(request)
        : forbidden('requests must be addressed to the studio itself')

  /** Only changes sent by the studio's own page reach `handler`. A browser sends Origin with every POST. */
  const fromOwnPage = <R extends Request = RouteRequest>(
    handler: (request: R) => Promise<Response>,
  ) =>
    guard((request: R) =>
      hosts()
        .map((host) => `http://${host}`)
        .includes(request.headers.get('origin') ?? '')
        ? handler(request)
        : forbidden('changes are only accepted from the studio itself'),
    )

  return {
    admit,
    admitBoth,
    admitCredits,
    answer,
    budgets,
    busyNow,
    busyRefusal,
    changeCharacter,
    creditBudgets,
    creditOf,
    creditsInFlight,
    creditSittings,
    effectGenerator,
    effectHealth,
    effectTakes,
    elevenAccountOf,
    elevenFor,
    elevenHeld,
    elevenWork,
    encode,
    endGiven,
    endSitting,
    fishFor,
    fishWork,
    flightIn,
    forgetShownAccount,
    freshSitting,
    fromOwnPage,
    guard,
    holdCredits,
    imageFineTunes,
    imageGenerator,
    imageHealth,
    imagePatches,
    imageTakes,
    inFlight,
    jobs,
    languageFor,
    listening,
    loggedOne,
    musicGenerator,
    musicTakes,
    planFor,
    projectFile,
    putStageModel,
    reserved,
    ruledOut,
    saveToAccount,
    shownAccount,
    sittingAnswer,
    sittingKey,
    sittings,
    spendLog,
    transcriberFor,
    unknownUse,
    whileGoing,
  }
}

/** What a route file is given. */
export type RouteContext = ReturnType<typeof createContext>
