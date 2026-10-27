import type { z } from 'zod'
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
  /** Characters used this period. */
  charactersUsed: number
  /** Characters the plan includes this period. */
  characterLimit: number
  /** When the characters renew (Unix seconds), if ElevenLabs says. */
  renewsAt: number | null
  /** Credits that may be used beyond the plan, billed in dollars: 0 is none. */
  overage: number | 'unlimited'
  voiceSlots: { used: number; limit: number }
}

/** What asking ElevenLabs for the account gave. */
export type ElevenAnswer =
  | { ok: true; account: ElevenAccount }
  | { ok: false; reason: 'no-key' | 'elevenlabs' | 'project'; message: string }

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
  /** The project file names a `refreshDialog` command. */
  refreshDialog: boolean
  /** The project's `quality.parallel`: requests recording sends to Fish at a time. */
  parallel: number
  /** The tier the user told the studio (`quality.fishTier`), or none. */
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
  /** What asking ElevenLabs for the account gave (not asked without its key). */
  elevenlabs: ElevenAnswer
}

/** One numbered step: text with links in it, and commands to copy after it. */
export interface SetupStep {
  parts: (string | { link: string; href: string })[]
  commands?: string[]
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
        'The project sets quality.transcriber to "none": one take a line, not checked, with word timings spread evenly.',
    }
  }
  if (!facts.appleSilicon) {
    return {
      id: 'whisper',
      title,
      state: 'problem',
      detail: 'mlx-whisper runs on macOS with Apple silicon only; this is not such a machine.',
      fix: 'Set quality.transcriber to "none" in the project file to record without checking.',
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
        fix: `Set quality.parallel to ${limit} or less in the project file.`,
        tier,
      }
}

function refresh(facts: SetupFacts): SetupCheck {
  return facts.refreshDialog
    ? {
        id: 'refresh',
        title: 'Refresh dialog',
        state: 'ok',
        detail: 'The project names a refreshDialog command: the dialog can be extracted from here.',
      }
    : {
        id: 'refresh',
        title: 'Refresh dialog',
        state: 'off',
        detail:
          'No refreshDialog command in the project file (optional): extract the dialog outside the studio.',
      }
}

function music(facts: SetupFacts): SetupCheck {
  const title = 'Music generator (ACE-Step)'
  if (!facts.music) {
    return { id: 'music', title, state: 'off', detail: 'The project has no music section.' }
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

/** The Hugging Face repositories of the Stable Audio models, which the folders are named after. */
const STABLE_AUDIO_REPOS = MUSIC_MODELS.filter((m) => m.family === 'stable-audio').flatMap(
  (m) => m.folders,
)

function stableAudio(facts: SetupFacts): SetupCheck {
  const title = 'Music generator (Stable Audio Open)'
  if (!facts.music) {
    return { id: 'stableAudio', title, state: 'off', detail: 'The project has no music section.' }
  }
  const { stableAudioMissing: missing, model } = facts.music
  if (!missing.length) {
    return {
      id: 'stableAudio',
      title,
      state: 'ok',
      detail: 'Short and Shortest are in place; they load on the first take.',
    }
  }
  const steps = {
    list: [
      {
        parts: [
          "Sign in to Hugging Face and accept Stability AI's Community Licence on ",
          ...STABLE_AUDIO_REPOS.flatMap((repo, i) => [
            ...(i ? [' and '] : []),
            { link: `stabilityai/${repo}`, href: `https://huggingface.co/stabilityai/${repo}` },
          ]),
          '.',
        ],
      },
      {
        parts: [
          'Make a read token at ',
          {
            link: 'huggingface.co/settings/tokens',
            href: 'https://huggingface.co/settings/tokens',
          },
          '.',
        ],
      },
      {
        parts: [`Download both into ${STABLE_AUDIO_HOME}, where the studio looks for them:`],
        commands: STABLE_AUDIO_REPOS.map(
          (repo) =>
            `HF_TOKEN=… uvx --from huggingface_hub hf download stabilityai/${repo} --local-dir ${STABLE_AUDIO_HOME}/${repo}`,
        ),
      },
    ],
    note: 'The studio never asks for or keeps your token.',
  }
  if (missing.includes(model)) {
    const { name, folders } = musicModel(model)
    return {
      id: 'stableAudio',
      title,
      state: 'problem',
      detail: `The project's music model, ${name}, is not on this computer: ${folders.join(', ')} is missing from ${STABLE_AUDIO_HOME}.`,
      steps,
    }
  }
  const detail =
    missing.length === 2
      ? 'Optional: for stingers and short loops. Its models are not on this computer.'
      : `${MUSIC_MODELS.filter((m) => m.family === 'stable-audio' && !missing.includes(m.id))
          .map((m) => m.name)
          .join(
            ' and ',
          )} is in place; ${missing.map((id) => musicModel(id).name).join(' and ')} is missing from ${STABLE_AUDIO_HOME}.`
  return { id: 'stableAudio', title, state: 'off', label: 'Not set up', detail, steps }
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
    detail: `Answers. ${planName(account.tier)} plan: ${count(left)} of ${count(account.characterLimit)} characters left${renews}.`,
    notes: [
      overageNote(account.overage),
      `Voice slots: ${account.voiceSlots.used} of ${account.voiceSlots.limit} used.`,
      free
        ? 'On the Free plan ElevenLabs makes no music through the API, and nothing it makes may be used commercially.'
        : "Music made with ElevenLabs may be used in a game while the game has earned under $500,000 and you under $1,000,000 a year from games (ElevenLabs' music terms of 9 October 2026); beyond that it needs their Enterprise Music plan.",
    ],
  }
}
