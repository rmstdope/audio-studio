import { z } from 'zod'
import type { ElevenAccount, ElevenAnswer } from '../core/setup'
import type { Voice } from '../core/voiceSearch'
import type { Project } from '../core/project'
import { elevenVoice } from '../core/voices'
import { elevenLabsApiKey } from './env'

/** What the studio needs from ElevenLabs. Behind an interface, so tests use a fake. */
export interface ElevenLabsClient {
  /** The account's plan, its credits this period, what may be billed beyond them, and its voice slots. */
  subscription(): Promise<ElevenAccount>
  /**
   * An instrumental piece of music from a prompt, as MP3 (Eleven Music v2.5; ElevenLabs takes no
   * seed with a prompt). Aborting `signal` ends it at once, and it rejects.
   */
  music(request: MusicPieceRequest, signal?: AbortSignal): Promise<Uint8Array>
  /** The text spoken in a voice of the user's own, as 16-bit WAV at 24 kHz (every plan may ask for it). */
  tts(request: SpeechRequest): Promise<Uint8Array>
  /**
   * A voice the account can speak with, by ElevenLabs' id (one of the user's own, or one of
   * ElevenLabs' premade voices), as the studio shows voices: its id marked as ElevenLabs', its
   * preview as its sample.
   */
  voice(id: string): Promise<Voice>
}

/** The ElevenLabs client for a project, or null when it has no key. Replaced in tests. */
export type ElevenLabsFactory = (root: string, project: Project) => Promise<ElevenLabsClient | null>

/** What the studio says when something needs ElevenLabs and there is no key. */
export const NO_ELEVENLABS_KEY =
  'Set ELEVENLABS_API_KEY in the project’s env file, or in the environment.'

/**
 * A client made from the project's ElevenLabs key (the environment, else the project's env
 * file), or null when there is none. Read on every call, so a key added later is picked up.
 */
export async function elevenFromEnv(
  root: string,
  project: Project,
  environment: Record<string, string | undefined> = process.env,
): Promise<ElevenLabsClient | null> {
  const key = await elevenLabsApiKey(root, project.env, environment)
  return key ? createElevenLabsClient(key) : null
}

/** Text to speak: the voice as ElevenLabs knows it, the model, its settings and the language. */
export interface SpeechRequest {
  text: string
  /** ElevenLabs' id of the voice, without the studio's `eleven:`. */
  voice: string
  model: string
  settings: { stability: number; similarityBoost: number; style: number; speed: number }
  /** The language to speak, as an ISO 639-1 code, for a model that takes one. */
  language?: string
}

/** A piece of music to make: what it should sound like, and how long it is. */
export interface MusicPieceRequest {
  prompt: string
  /** Its length in milliseconds (ElevenLabs takes 3 s to 10 minutes). */
  lengthMs: number
}

/** ElevenLabs answered with an error. */
export class ElevenLabsError extends Error {
  constructor(
    readonly status: number,
    /** ElevenLabs' own message, without the status. */
    readonly detail: string,
  ) {
    super(`ElevenLabs answered ${status}: ${detail}`)
    this.name = 'ElevenLabsError'
  }
}

/** A subscription as ElevenLabs' API returns it: only what the studio reads. */
const ApiSubscriptionSchema = z.looseObject({
  tier: z.string(),
  character_count: z.number(),
  character_limit: z.number(),
  next_character_count_reset_unix: z.number().nullish(),
  max_credit_limit_extension: z.union([z.number(), z.literal('unlimited')]).nullish(),
  voice_limit: z.number().default(0),
  voice_slots_used: z.number().default(0),
})

/** A voice as ElevenLabs' API returns it: only what the studio reads. */
const ApiVoiceSchema = z.looseObject({
  voice_id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  labels: z.record(z.string(), z.string()).nullish(),
  preview_url: z.string().nullish(),
  verified_languages: z.array(z.looseObject({ language: z.string() })).nullish(),
})

/** How long asking for the account may take: it holds up Setup, so not as long as other work. */
const ACCOUNT_TIMEOUT_MS = 10_000

/** How long making a piece may take: up to ten minutes of music, made in the cloud. */
const MUSIC_TIMEOUT_MS = 10 * 60_000

/** What the studio says of an answer it cannot read: not JSON, or not the shape it expects. */
const UNREADABLE = 'ElevenLabs answered in a form the studio does not read'

/**
 * A client for ElevenLabs' REST API (https://elevenlabs.io/docs/api-reference). `fetch` and the
 * base URL can be replaced, for tests; `timeoutMs` is the longest any request may take.
 */
export function createElevenLabsClient(
  apiKey: string,
  {
    fetch = globalThis.fetch,
    baseUrl = 'https://api.elevenlabs.io',
    timeoutMs = 120_000,
  }: { fetch?: typeof globalThis.fetch; baseUrl?: string; timeoutMs?: number } = {},
): ElevenLabsClient {
  /** A GET whose whole answer, the body included, gives up after `waitMs`, saying so. */
  async function get(path: string, waitMs: number): Promise<unknown> {
    try {
      const response = await fetch(new URL(path, baseUrl), {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(waitMs),
      })
      if (!response.ok) throw new ElevenLabsError(response.status, await errorMessage(response))
      const text = await response.text()
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new Error(UNREADABLE)
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new Error(`ElevenLabs did not answer within ${waitMs / 1000} s`)
      }
      throw error
    }
  }

  return {
    async tts({ text, voice, model, settings, language }) {
      try {
        const url = new URL(
          `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=wav_24000`,
          baseUrl,
        )
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
              stability: settings.stability,
              similarity_boost: settings.similarityBoost,
              style: settings.style,
              speed: settings.speed,
            },
            ...(language && { language_code: language }),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) throw new ElevenLabsError(response.status, await errorMessage(response))
        return new Uint8Array(await response.arrayBuffer())
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          throw new Error(`ElevenLabs did not answer within ${timeoutMs / 1000} s`)
        }
        throw error
      }
    },

    async music({ prompt, lengthMs }, signal) {
      const timeout = AbortSignal.timeout(MUSIC_TIMEOUT_MS)
      try {
        const response = await fetch(new URL('/v1/music?output_format=mp3_44100_128', baseUrl), {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            prompt,
            music_length_ms: lengthMs,
            model_id: 'music_v2_5',
            force_instrumental: true,
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        })
        if (!response.ok) throw new ElevenLabsError(response.status, await errorMessage(response))
        return new Uint8Array(await response.arrayBuffer())
      } catch (error) {
        if (signal?.aborted) throw new Error('The music generator was stopped.')
        if (timeout.aborted) {
          throw new Error(`ElevenLabs did not answer within ${MUSIC_TIMEOUT_MS / 60_000} minutes`)
        }
        throw error
      }
    },

    async voice(id) {
      const parsed = ApiVoiceSchema.safeParse(
        await get(`/v1/voices/${encodeURIComponent(id)}`, timeoutMs),
      )
      if (!parsed.success) throw new Error(UNREADABLE)
      const api = parsed.data
      return {
        id: elevenVoice(api.voice_id),
        title: api.name,
        description: api.description ?? '',
        tags: Object.values(api.labels ?? {}),
        languages: [...new Set((api.verified_languages ?? []).map((l) => l.language))],
        // ElevenLabs says nothing of how often a voice of the account's own was used.
        uses: 0,
        likes: 0,
        author: '',
        sample: api.preview_url ? { text: '', audio: api.preview_url } : null,
      }
    },

    async subscription() {
      const parsed = ApiSubscriptionSchema.safeParse(
        await get('/v1/user/subscription', Math.min(timeoutMs, ACCOUNT_TIMEOUT_MS)),
      )
      if (!parsed.success) throw new Error(UNREADABLE)
      const api = parsed.data
      return {
        tier: api.tier,
        charactersUsed: api.character_count,
        characterLimit: api.character_limit,
        renewsAt: api.next_character_count_reset_unix ?? null,
        overage: api.max_credit_limit_extension ?? 0,
        voiceSlots: { used: api.voice_slots_used, limit: api.voice_limit },
      }
    },
  }
}

/** The account as Setup shows it: what `subscription` gave, or why it could not be read. */
export async function accountOf(client: ElevenLabsClient): Promise<ElevenAnswer> {
  try {
    return { ok: true, account: await client.subscription() }
  } catch (error) {
    return {
      ok: false,
      reason: 'elevenlabs',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

/** ElevenLabs' message from an error answer: `detail.message`, `detail` or `message`, else the text. */
async function errorMessage(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as { detail?: unknown; message?: unknown }
    const detail = body.detail
    if (detail && typeof detail === 'object' && 'message' in detail) {
      const message = (detail as { message?: unknown }).message
      if (typeof message === 'string') return message
    }
    if (typeof detail === 'string') return detail
    if (typeof body.message === 'string') return body.message
  } catch {
    // not JSON: use the text
  }
  return text || response.statusText
}
