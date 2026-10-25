import { z } from 'zod'
import type { Project } from '../core/project'
import type { Voice } from '../core/voiceSearch'
import { fishApiKey } from './env'

/** A page of Fish's voice library. */
export interface VoicePage {
  total: number
  items: Voice[]
}

/** A query for Fish's voice library. Fish matches `title` loosely and sorts by popularity. */
export interface VoiceQuery {
  title?: string
  language?: string
  pageSize: number
  /** From 1. */
  pageNumber: number
}

/** A request to speak text in a voice. */
export interface TtsRequest {
  text: string
  voice: string
  model: string
  temperature: number
  topP: number
  speed: number
  /** The audio format; MP3 unless asked for WAV (lines are joined as WAV, then encoded). */
  format?: 'mp3' | 'wav'
}

/** What the studio needs from Fish Audio. Behind an interface, so tests use a fake. */
export interface FishClient {
  listVoices(query: VoiceQuery): Promise<VoicePage>
  getVoice(id: string): Promise<Voice>
  /** Every voice on the account itself (cloned or private), marked `own`. */
  listOwnVoices(): Promise<Voice[]>
  /** The text spoken in the voice, as MP3 (or WAV when asked). */
  tts(request: TtsRequest): Promise<Uint8Array>
  /**
   * The account's remaining API credit (what paid models are billed from). Fish documents it as a
   * string without a unit; it is taken to be US dollars, as the prices are.
   */
  credit(): Promise<number>
  /**
   * Makes a private voice on the account from recordings (1 to 20, each 10 seconds or more), and
   * gives it as Fish describes it. Fish refusing is a `FishError` with its own message.
   */
  createVoice(request: CreateVoiceRequest): Promise<Voice>
  /**
   * Has Fish design voices from a description ($0.01 per successful request, not per voice), each
   * saying `referenceText`. Fish makes no voice on the account: what comes back is audio only.
   * Fish refusing is a `FishError` with its own message; nothing is billed then.
   */
  designVoice(request: DesignVoiceRequest): Promise<DesignedVoice[]>
}

/** A request to design voices from a description. */
export interface DesignVoiceRequest {
  /** The description (1 to 2,000 characters). */
  instruction: string
  /** What each voice says (up to 150 characters). */
  referenceText: string
  /** A language hint such as `en`, or null for none. */
  language: string | null
  /** How many voices (1 to 4). */
  count: number
}

/** A voice Fish designed: its preview, as WAV. */
export interface DesignedVoice {
  /** Fish's identifier for the candidate, within its answer. */
  id: string
  wav: Uint8Array
}

/** A request to make a private voice from recordings. */
export interface CreateVoiceRequest {
  title: string
  files: { name: string; type: string; bytes: Uint8Array }[]
}

/** What the studio says when there is no Fish Audio API key. */
export const NO_KEY = 'Set FISH_AUDIO_API_KEY in the project’s env file, or in the environment.'

/** The account's remaining API credit in dollars, or why it is not known. */
export type CreditResult =
  | { ok: true; credit: number }
  | { ok: false; reason: 'no-key' | 'fish' | 'project'; message: string }

/** Fish Audio answered with an error. */
export class FishError extends Error {
  constructor(
    readonly status: number,
    /** Fish's own message, without the status. */
    readonly detail: string,
  ) {
    super(`Fish Audio answered ${status}: ${detail}`)
    this.name = 'FishError'
  }
}

/** A voice as Fish's API returns it: only what the studio reads, every field tolerated missing. */
const ApiVoiceSchema = z.looseObject({
  _id: z.string(),
  title: z.string().default(''),
  description: z.string().nullish(),
  tags: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  task_count: z.number().default(0),
  like_count: z.number().default(0),
  author: z.looseObject({ nickname: z.string().default('') }).nullish(),
  samples: z
    .array(z.looseObject({ text: z.string().default(''), audio: z.string().nullish() }))
    .default([]),
})

const ApiPageSchema = z.looseObject({
  total: z.number().default(0),
  items: z.array(ApiVoiceSchema).default([]),
})

const ApiDesignSchema = z.looseObject({
  candidates: z.array(z.looseObject({ id: z.string(), audio_base64: z.string() })).default([]),
})

function toVoice(api: z.infer<typeof ApiVoiceSchema>): Voice {
  const sample = api.samples.find((s) => s.audio)
  return {
    id: api._id,
    title: api.title.trim(),
    description: (api.description ?? '').trim(),
    tags: api.tags,
    languages: api.languages,
    uses: api.task_count,
    likes: api.like_count,
    author: api.author?.nickname ?? '',
    sample: sample?.audio ? { text: sample.text, audio: sample.audio } : null,
  }
}

/** The waits, in ms, before asking Fish again after a 429: 1 s, then doubling, to 32 s. */
const RETRY_WAITS = [1000, 2000, 4000, 8000, 16000, 32000]

/**
 * A client for Fish Audio's REST API (https://docs.fish.audio). `fetch` and the base URL can be
 * replaced, for tests.
 */
export function createFishClient(
  apiKey: string,
  {
    fetch = globalThis.fetch,
    baseUrl = 'https://api.fish.audio',
    timeoutMs = 120_000,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    fetch?: typeof globalThis.fetch
    baseUrl?: string
    timeoutMs?: number
    /** How to wait between tries, replaced in tests. */
    sleep?: (ms: number) => Promise<void>
  } = {},
): FishClient {
  /**
   * A request that gives up after `timeoutMs`, saying so, so a stuck request never blocks a job;
   * and that is asked again, after each of `RETRY_WAITS`, when Fish answers 429 (too many
   * requests at once for the account's tier; Fish sends no Retry-After). After the last wait the
   * 429 is thrown like any refusal, saying what to do about it.
   */
  async function timed<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await request()
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'TimeoutError' || error.name === 'AbortError')
        ) {
          throw new Error(`Fish Audio did not answer within ${timeoutMs / 1000} s`)
        }
        if (error instanceof FishError && error.status === 429) {
          const wait = RETRY_WAITS[attempt]
          if (wait !== undefined) {
            await sleep(wait)
            continue
          }
          throw new FishError(
            429,
            `${error.detail} (${attempt + 1} tries over a minute): lower quality.parallel, or wait for other work on this key`,
          )
        }
        throw error
      }
    }
  }

  async function get(path: string, params: Record<string, string | number | undefined> = {}) {
    const url = new URL(path, baseUrl)
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(name, String(value))
    }
    // The whole request, the body read included, is timed: a body that stalls gives up too.
    return timed(async () => {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new FishError(response.status, await errorMessage(response))
      return (await response.json()) as unknown
    })
  }

  return {
    async listVoices({ title, language, pageSize, pageNumber }) {
      const body = await get('/model', {
        title,
        language,
        page_size: pageSize,
        page_number: pageNumber,
        sort_by: 'task_count',
      })
      const page = ApiPageSchema.parse(body)
      return { total: page.total, items: page.items.map(toVoice) }
    },
    async listOwnVoices() {
      const voices: Voice[] = []
      for (let pageNumber = 1; ; pageNumber++) {
        const body = await get('/model', { self: 'true', page_size: 100, page_number: pageNumber })
        const page = ApiPageSchema.parse(body)
        voices.push(...page.items.map((item) => ({ ...toVoice(item), own: true })))
        if (!page.items.length || voices.length >= page.total) return voices
      }
    },
    async credit() {
      const { credit } = z
        .looseObject({ credit: z.string() })
        .parse(await get('/wallet/self/api-credit'))
      // A plain decimal amount only: Number() would read "" as 0 and "0x10" as 16.
      const dollars = /^-?\d+(\.\d+)?$/.test(credit) ? Number(credit) : NaN
      if (!Number.isFinite(dollars)) {
        throw new Error(`Fish gave a credit that is not an amount: "${credit}"`)
      }
      return dollars
    },
    async getVoice(id) {
      return toVoice(ApiVoiceSchema.parse(await get(`/model/${encodeURIComponent(id)}`)))
    },
    async createVoice({ title, files }) {
      // Uploading and training take longer than a lookup: a stuck request still gives up.
      return timed(async () => {
        const form = new FormData()
        form.set('type', 'tts')
        form.set('title', title)
        form.set('visibility', 'private')
        form.set('train_mode', 'fast')
        for (const file of files) {
          form.append(
            'voices',
            new File([new Uint8Array(file.bytes)], file.name, { type: file.type }),
          )
        }
        const limit = timeoutMs * 3
        try {
          const response = await fetch(new URL('/model', baseUrl), {
            signal: AbortSignal.timeout(limit),
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}` },
            body: form,
          })
          if (!response.ok) throw new FishError(response.status, await errorMessage(response))
          return toVoice(ApiVoiceSchema.parse(await response.json()))
        } catch (error) {
          if (
            error instanceof Error &&
            (error.name === 'TimeoutError' || error.name === 'AbortError')
          ) {
            // Said here, not by `timed`: the limit is longer, and Fish may have made the voice.
            throw new Error(
              `Fish Audio did not answer within ${limit / 1000} s; the voice may still have been made on your account`,
            )
          }
          throw error
        }
      })
    },
    async designVoice({ instruction, referenceText, language, count }) {
      return timed(async () => {
        const response = await fetch(new URL('/v1/voice-design', baseUrl), {
          signal: AbortSignal.timeout(timeoutMs),
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            model: 'voice-design-1',
          },
          body: JSON.stringify({
            instruction,
            reference_text: referenceText,
            language,
            n: count,
          }),
        })
        if (!response.ok) throw new FishError(response.status, await errorMessage(response))
        const { candidates } = ApiDesignSchema.parse(await response.json())
        if (!candidates.length) throw new Error('Fish made no voices from that description')
        return candidates.map((c) => ({
          id: c.id,
          wav: new Uint8Array(Buffer.from(c.audio_base64, 'base64')),
        }))
      })
    },
    async tts({ text, voice, model, temperature, topP, speed, format = 'mp3' }) {
      return timed(async () => {
        const response = await fetch(new URL('/v1/tts', baseUrl), {
          signal: AbortSignal.timeout(timeoutMs),
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
            model,
          },
          body: JSON.stringify({
            text,
            reference_id: voice,
            format,
            latency: 'normal',
            temperature,
            top_p: topP,
            prosody: { speed, volume: 0 },
          }),
        })
        if (!response.ok) throw new FishError(response.status, await errorMessage(response))
        return new Uint8Array(await response.arrayBuffer())
      })
    },
  }
}

/**
 * The Fish client for a project, made from its API key (environment, else the project's env
 * file), or null when there is none. Read on every call, so a key added later is picked up.
 */
export async function fishFromEnv(
  root: string,
  project: Project,
  environment: Record<string, string | undefined> = process.env,
): Promise<FishClient | null> {
  const key = await fishApiKey(root, project.env, environment)
  return key ? createFishClient(key) : null
}

async function errorMessage(response: Response): Promise<string> {
  const text = await response.text()
  try {
    const body = JSON.parse(text) as { message?: unknown; detail?: unknown }
    const message = body.message ?? body.detail
    if (typeof message === 'string') return message
  } catch {
    // not JSON: use the text
  }
  return text.slice(0, 200) || response.statusText
}
