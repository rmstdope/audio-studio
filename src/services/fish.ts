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
  /** The text spoken in the voice, as MP3 (or WAV when asked). */
  tts(request: TtsRequest): Promise<Uint8Array>
}

/** Fish Audio answered with an error. */
export class FishError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`Fish Audio answered ${status}: ${message}`)
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

/**
 * A client for Fish Audio's REST API (https://docs.fish.audio). `fetch` and the base URL can be
 * replaced, for tests.
 */
export function createFishClient(
  apiKey: string,
  { fetch = globalThis.fetch, baseUrl = 'https://api.fish.audio' } = {},
): FishClient {
  async function get(path: string, params: Record<string, string | number | undefined> = {}) {
    const url = new URL(path, baseUrl)
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(name, String(value))
    }
    const response = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } })
    if (!response.ok) throw new FishError(response.status, await errorMessage(response))
    return response.json()
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
    async getVoice(id) {
      return toVoice(ApiVoiceSchema.parse(await get(`/model/${encodeURIComponent(id)}`)))
    },
    async tts({ text, voice, model, temperature, topP, speed, format = 'mp3' }) {
      const response = await fetch(new URL('/v1/tts', baseUrl), {
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
