import { describe, expect, it } from 'bun:test'
import { createElevenLabsClient, ElevenLabsError } from './elevenlabs'

/** A fetch that answers every request with `body` and `status`, and records what was asked. */
function fakeFetch(body: unknown, status = 200) {
  const asked: { url: string; headers: Headers }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }) as typeof globalThis.fetch
  return { fetch, asked }
}

/** A subscription as ElevenLabs' API reference shows one, with fields the studio does not read. */
const subscription = {
  tier: 'starter',
  status: 'active',
  character_count: 2550,
  character_limit: 30000,
  next_character_count_reset_unix: 1794474000,
  max_credit_limit_extension: 0,
  voice_limit: 10,
  voice_slots_used: 3,
  can_use_instant_voice_cloning: true,
  currency: 'usd',
}

describe('createElevenLabsClient', () => {
  it('reads the account from the subscription, with the key in xi-api-key', async () => {
    const { fetch, asked } = fakeFetch(subscription)
    const client = createElevenLabsClient('k', { fetch })
    expect(await client.subscription()).toEqual({
      tier: 'starter',
      charactersUsed: 2550,
      characterLimit: 30000,
      renewsAt: 1794474000,
      overage: 0,
      voiceSlots: { used: 3, limit: 10 },
    })
    expect(asked[0]!.url).toBe('https://api.elevenlabs.io/v1/user/subscription')
    expect(asked[0]!.headers.get('xi-api-key')).toBe('k')
  })

  it('takes an overage without limit, and fields ElevenLabs leaves out', async () => {
    const { fetch } = fakeFetch({
      tier: 'free',
      character_count: 0,
      character_limit: 10000,
      max_credit_limit_extension: 'unlimited',
    })
    expect(await createElevenLabsClient('k', { fetch }).subscription()).toEqual({
      tier: 'free',
      charactersUsed: 0,
      characterLimit: 10000,
      renewsAt: null,
      overage: 'unlimited',
      voiceSlots: { used: 0, limit: 0 },
    })
  })

  it("throws ElevenLabs' own message when it refuses", async () => {
    const { fetch } = fakeFetch(
      { detail: { status: 'invalid_api_key', message: 'Invalid API key' } },
      401,
    )
    const refused = createElevenLabsClient('k', { fetch }).subscription()
    await expect(refused).rejects.toBeInstanceOf(ElevenLabsError)
    await expect(refused).rejects.toThrow('ElevenLabs answered 401: Invalid API key')
  })

  it('says so when the answer is not one the studio reads', async () => {
    for (const [body, status] of [
      ['<html>Sign in to the network</html>', 200],
      [{ character_count: 1 }, 200],
    ] as const) {
      const { fetch } = fakeFetch(body, status)
      await expect(createElevenLabsClient('k', { fetch }).subscription()).rejects.toThrow(
        'ElevenLabs answered in a form the studio does not read',
      )
    }
  })

  it('gives up on the account after 10 seconds, whatever longer wait takes are given', async () => {
    let signal: AbortSignal | undefined
    const fetch = (async (_: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Response(JSON.stringify(subscription))
    }) as unknown as typeof globalThis.fetch
    await createElevenLabsClient('k', { fetch, timeoutMs: 120_000 }).subscription()
    expect(signal).toBeDefined()
  })

  it('says so when ElevenLabs does not answer in time', async () => {
    const fetch = (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    }) as unknown as typeof globalThis.fetch
    await expect(
      createElevenLabsClient('k', { fetch, timeoutMs: 5000 }).subscription(),
    ).rejects.toThrow('ElevenLabs did not answer within 5 s')
    await expect(createElevenLabsClient('k', { fetch }).subscription()).rejects.toThrow(
      'ElevenLabs did not answer within 10 s',
    )
  })
})

describe('making music', () => {
  /** A fetch that answers with MP3 bytes and records the request. */
  function musicFetch(status = 200, answer: BodyInit = new Uint8Array([0x49, 0x44, 0x33])) {
    const asked: { url: string; init: RequestInit }[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(input), init: init ?? {} })
      return new Response(answer, { status })
    }) as typeof globalThis.fetch
    return { fetch, asked }
  }

  it('asks for an instrumental piece of the length given, as 128 kbps MP3, with Music v2.5', async () => {
    const { fetch, asked } = musicFetch()
    const mp3 = await createElevenLabsClient('k', { fetch }).music({
      prompt: 'warm lute, 84 BPM, D major',
      lengthMs: 50_000,
    })
    expect([...mp3]).toEqual([0x49, 0x44, 0x33])
    expect(asked[0]!.url).toBe('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128')
    expect(asked[0]!.init.method).toBe('POST')
    expect(new Headers(asked[0]!.init.headers).get('xi-api-key')).toBe('k')
    expect(JSON.parse(String(asked[0]!.init.body))).toEqual({
      prompt: 'warm lute, 84 BPM, D major',
      music_length_ms: 50_000,
      model_id: 'music_v2_5',
      force_instrumental: true,
    })
  })

  it("throws ElevenLabs' own message when it refuses", async () => {
    const { fetch } = musicFetch(
      402,
      JSON.stringify({ detail: { message: 'Music requires a paid plan' } }),
    )
    await expect(
      createElevenLabsClient('k', { fetch }).music({ prompt: 'a', lengthMs: 10_000 }),
    ).rejects.toThrow('ElevenLabs answered 402: Music requires a paid plan')
  })

  it('stops when asked to, saying so', async () => {
    const fetch = (async (_: unknown, init?: RequestInit) => {
      if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
      return new Response(new Uint8Array())
    }) as unknown as typeof globalThis.fetch
    const stop = new AbortController()
    stop.abort()
    await expect(
      createElevenLabsClient('k', { fetch }).music({ prompt: 'a', lengthMs: 10_000 }, stop.signal),
    ).rejects.toThrow('The music generator was stopped.')
  })
})

describe('speaking', () => {
  function speechFetch(status = 200, answer: BodyInit = new Uint8Array([0x52, 0x49, 0x46, 0x46])) {
    const asked: { url: string; init: RequestInit }[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(input), init: init ?? {} })
      return new Response(answer, { status })
    }) as typeof globalThis.fetch
    return { fetch, asked }
  }

  it('asks for the text in the voice as 24 kHz WAV, with the model, settings and language', async () => {
    const { fetch, asked } = speechFetch()
    const wav = await createElevenLabsClient('k', { fetch }).tts({
      text: '[whispers] Come in.',
      voice: '21m00Tcm4TlvDq8ikWAM',
      model: 'eleven_v3',
      settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1.1 },
      language: 'sv',
    })
    expect([...wav]).toEqual([0x52, 0x49, 0x46, 0x46])
    expect(asked[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=wav_24000',
    )
    expect(asked[0]!.init.method).toBe('POST')
    expect(new Headers(asked[0]!.init.headers).get('xi-api-key')).toBe('k')
    expect(JSON.parse(String(asked[0]!.init.body))).toEqual({
      text: '[whispers] Come in.',
      model_id: 'eleven_v3',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.1 },
      language_code: 'sv',
    })
  })

  it('sends no language when given none', async () => {
    const { fetch, asked } = speechFetch()
    await createElevenLabsClient('k', { fetch }).tts({
      text: 'a',
      voice: 'v',
      model: 'eleven_multilingual_v2',
      settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1 },
    })
    expect(JSON.parse(String(asked[0]!.init.body))).not.toHaveProperty('language_code')
  })

  it("throws ElevenLabs' own message when it refuses", async () => {
    const { fetch } = speechFetch(
      401,
      JSON.stringify({ detail: { message: 'You have run out of credits' } }),
    )
    await expect(
      createElevenLabsClient('k', { fetch }).tts({
        text: 'a',
        voice: 'v',
        model: 'eleven_v3',
        settings: { stability: 0.5, similarityBoost: 0.75, style: 0, speed: 1 },
      }),
    ).rejects.toThrow('ElevenLabs answered 401: You have run out of credits')
  })
})

describe('looking a voice up', () => {
  /** A voice as ElevenLabs' API reference shows one, with fields the studio does not read. */
  const apiVoice = {
    voice_id: 'JBFqnCBsd6RMkjVDRZzb',
    name: 'George',
    category: 'premade',
    description: 'Warm, captivating storyteller',
    labels: { accent: 'british', age: 'middle aged', gender: 'male', use_case: 'narration' },
    preview_url: 'https://storage.googleapis.com/eleven-public-prod/george.mp3',
    verified_languages: [{ language: 'en' }, { language: 'sv' }, { language: 'en' }],
    settings: null,
  }

  it('gives it as a voice of the studio, its id marked as ElevenLabs’, its preview as its sample', async () => {
    const { fetch, asked } = fakeFetch(apiVoice)
    expect(await createElevenLabsClient('k', { fetch }).voice('JBFqnCBsd6RMkjVDRZzb')).toEqual({
      id: 'eleven:JBFqnCBsd6RMkjVDRZzb',
      title: 'George',
      description: 'Warm, captivating storyteller',
      tags: ['british', 'middle aged', 'male', 'narration'],
      languages: ['en', 'sv'],
      uses: 0,
      likes: 0,
      author: '',
      sample: {
        text: '',
        audio: 'https://storage.googleapis.com/eleven-public-prod/george.mp3',
      },
    })
    expect(asked[0]!.url).toBe('https://api.elevenlabs.io/v1/voices/JBFqnCBsd6RMkjVDRZzb')
    expect(asked[0]!.headers.get('xi-api-key')).toBe('k')
  })

  it('takes a voice without description, labels, preview or languages', async () => {
    const { fetch } = fakeFetch({
      voice_id: 'x1',
      name: 'Mine',
      description: null,
      preview_url: null,
    })
    expect(await createElevenLabsClient('k', { fetch }).voice('x1')).toMatchObject({
      id: 'eleven:x1',
      description: '',
      tags: [],
      languages: [],
      sample: null,
    })
  })

  it("throws ElevenLabs' own message for a voice it does not have", async () => {
    const { fetch } = fakeFetch(
      {
        detail: {
          status: 'voice_not_found',
          message: 'A voice with the voice_id x was not found.',
        },
      },
      404,
    )
    await expect(createElevenLabsClient('k', { fetch }).voice('x')).rejects.toThrow(
      'ElevenLabs answered 404: A voice with the voice_id x was not found.',
    )
  })
})
