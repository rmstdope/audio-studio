import type { z } from 'zod'
import type { FishTierSchema } from './project'

/** The name of the variable that holds the Fish Audio API key (`services/env.ts` reads it). */
const FISH_KEY = 'FISH_AUDIO_API_KEY'

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
  music: { ready: { ok: true } | { ok: false; message: string }; checkpoints: string } | null
}

/**
 * One check: ok, a problem with how to fix it, or off (not needed as the project is set up, or
 * optional and not set).
 */
export interface SetupCheck {
  id: 'ffmpeg' | 'whisper' | 'key' | 'fish' | 'requests' | 'refresh' | 'music'
  title: string
  state: 'ok' | 'problem' | 'off'
  /** What was found, in a sentence. */
  detail: string
  /** What to do about a problem: a command or a setting. */
  fix?: string
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
    fix: `Put the models acestep-v15-xl-turbo and acestep-5Hz-lm-4B (about 28 GB) in ${facts.music.checkpoints}, or set ACESTEP_CHECKPOINTS to the folder that holds them.`,
  }
}
