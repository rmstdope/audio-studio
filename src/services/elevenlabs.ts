import { z } from 'zod'
import type { Project } from '../core/project'
import type { ElevenAccount } from '../core/setup'
import { elevenLabsApiKey } from './env'

/** What the studio needs from ElevenLabs. Behind an interface, so tests use a fake. */
export interface ElevenLabsClient {
  /** The account's plan, its characters this period, what may be billed beyond them, and its voice slots. */
  subscription(): Promise<ElevenAccount>
}

/** What the studio says when there is no ElevenLabs API key. */
export const NO_ELEVENLABS_KEY =
  'Set ELEVENLABS_API_KEY in the project’s env file, or in the environment.'

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

/**
 * A client for ElevenLabs' REST API (https://elevenlabs.io/docs/api-reference). `fetch` and the
 * base URL can be replaced, for tests.
 */
export function createElevenLabsClient(
  apiKey: string,
  {
    fetch = globalThis.fetch,
    baseUrl = 'https://api.elevenlabs.io',
    timeoutMs = 120_000,
  }: { fetch?: typeof globalThis.fetch; baseUrl?: string; timeoutMs?: number } = {},
): ElevenLabsClient {
  /** A GET whose whole answer, the body included, gives up after `timeoutMs`, saying so. */
  async function get(path: string): Promise<unknown> {
    try {
      const response = await fetch(new URL(path, baseUrl), {
        headers: { 'xi-api-key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new ElevenLabsError(response.status, await errorMessage(response))
      return (await response.json()) as unknown
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        throw new Error(`ElevenLabs did not answer within ${timeoutMs / 1000} s`)
      }
      throw error
    }
  }

  return {
    async subscription() {
      const api = ApiSubscriptionSchema.parse(await get('/v1/user/subscription'))
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

/**
 * The ElevenLabs client for a project, made from its API key (environment, else the project's env
 * file), or null when there is none. Read on every call, so a key added later is picked up.
 */
export async function elevenLabsFromEnv(
  root: string,
  project: Project,
  environment: Record<string, string | undefined> = process.env,
): Promise<ElevenLabsClient | null> {
  const key = await elevenLabsApiKey(root, project.env, environment)
  return key ? createElevenLabsClient(key) : null
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
