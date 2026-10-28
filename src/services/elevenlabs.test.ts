import { describe, expect, it } from 'bun:test'
import { createElevenLabsClient, ElevenLabsError } from './elevenlabs'

/** A fetch that answers every request with `body` and `status`, and records what was asked. */
function fakeFetch(body: unknown, status = 200) {
  const asked: { url: string; headers: Headers; method?: string; body?: unknown }[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({
      url: String(input),
      headers: new Headers(init?.headers),
      method: init?.method,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    })
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

describe('searching the library', () => {
  /** A library voice as ElevenLabs' API reference shows one, with fields the studio does not read. */
  const shared = {
    public_owner_id: 'owner1',
    voice_id: 'lib1',
    date_unix: 1714204800,
    name: 'Gravel',
    accent: 'british',
    gender: 'male',
    age: 'old',
    descriptive: 'gruff',
    use_case: 'characters_animation',
    category: 'professional',
    language: 'en',
    description: 'An old wizard, gruff and slow',
    preview_url: 'https://example.com/gravel.mp3',
    usage_character_count_1y: 10,
    usage_character_count_7d: 1,
    play_api_usage_character_count_1y: 0,
    cloned_by_count: 1234,
    free_users_allowed: true,
    live_moderation_enabled: false,
    featured: false,
    rate: 1,
    is_added_by_user: false,
  }

  it('asks for the words, language, gender and age, and gives voices as the studio shows them', async () => {
    const { fetch, asked } = fakeFetch({ voices: [shared], has_more: true })
    const found = await createElevenLabsClient('k', { fetch }).sharedVoices({
      search: 'old wizard',
      language: 'en',
      gender: 'male',
      age: 'old',
      pageSize: 100,
      page: 1,
    })
    expect(found.more).toBe(true)
    expect(found.voices).toEqual([
      {
        id: 'eleven:lib1',
        title: 'Gravel',
        description: 'An old wizard, gruff and slow',
        tags: ['british', 'male', 'old', 'gruff', 'characters animation'],
        languages: ['en'],
        uses: 1234,
        likes: 0,
        author: '',
        sample: { text: '', audio: 'https://example.com/gravel.mp3' },
        library: { owner: 'owner1', added: false },
      },
    ])
    const url = new URL(asked[0]!.url)
    expect(url.pathname).toBe('/v1/shared-voices')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      search: 'old wizard',
      language: 'en',
      gender: 'male',
      age: 'old',
      page_size: '100',
      page: '1',
    })
  })

  it('leaves out voices at a rate of their own, which cost more credits than the studio counts', async () => {
    const { fetch } = fakeFetch({
      voices: [
        { ...shared, voice_id: 'a', rate: 2 },
        { ...shared, voice_id: 'b', fiat_rate: 0.3 },
        { ...shared, voice_id: 'c', rate: null, is_added_by_user: true, cloned_by_count: null },
      ],
      has_more: false,
    })
    const found = await createElevenLabsClient('k', { fetch }).sharedVoices({ search: 'x' })
    expect(found.more).toBe(false)
    expect(found.voices.map((v) => [v.id, v.library, v.uses])).toEqual([
      ['eleven:c', { owner: 'owner1', added: true }, 0],
    ])
  })
})

describe('adding a library voice', () => {
  it('adds it under its name and gives the id it has on the account', async () => {
    const { fetch, asked } = fakeFetch({ voice_id: 'own1' })
    const id = await createElevenLabsClient('k', { fetch }).addSharedVoice(
      'owner1',
      'lib1',
      'Gravel',
    )
    expect(id).toBe('own1')
    expect(asked[0]!.url).toBe('https://api.elevenlabs.io/v1/voices/add/owner1/lib1')
    expect(asked[0]!.method).toBe('POST')
    expect(asked[0]!.body).toEqual({ new_name: 'Gravel' })
  })

  it("throws ElevenLabs' own message, such as at the plan's voice limit", async () => {
    const { fetch } = fakeFetch(
      { detail: { status: 'voice_limit_reached', message: 'You have reached your voice limit.' } },
      400,
    )
    await expect(
      createElevenLabsClient('k', { fetch }).addSharedVoice('o', 'v', 'N'),
    ).rejects.toThrow('ElevenLabs answered 400: You have reached your voice limit.')
  })
})

describe('removing a voice', () => {
  it('deletes it by its id', async () => {
    const { fetch, asked } = fakeFetch({ status: 'ok' })
    await createElevenLabsClient('k', { fetch }).deleteVoice('own1')
    expect(asked[0]!.url).toBe('https://api.elevenlabs.io/v1/voices/own1')
    expect(asked[0]!.method).toBe('DELETE')
  })

  it('takes an empty answer as done', async () => {
    const { fetch } = fakeFetch('')
    await createElevenLabsClient('k', { fetch }).deleteVoice('own1')
  })

  it("throws ElevenLabs' own message", async () => {
    const { fetch } = fakeFetch(
      { detail: { message: 'A voice with the voice_id x was not found.' } },
      404,
    )
    await expect(createElevenLabsClient('k', { fetch }).deleteVoice('x')).rejects.toThrow(
      'ElevenLabs answered 404: A voice with the voice_id x was not found.',
    )
  })
})

describe('designing voices', () => {
  it('asks Eleven v3 design for previews of the description saying the text, and decodes them', async () => {
    const { fetch, asked } = fakeFetch({
      previews: [
        {
          audio_base_64: Buffer.from([1, 2]).toString('base64'),
          generated_voice_id: 'g1',
          media_type: 'audio/mpeg',
          duration_secs: 3,
        },
        {
          audio_base_64: Buffer.from([3]).toString('base64'),
          generated_voice_id: 'g2',
          media_type: 'audio/mpeg',
          duration_secs: 3,
        },
      ],
      text: 'What they said.',
    })
    const designed = await createElevenLabsClient('k', { fetch }).designVoices({
      description: 'An old wizard',
      text: 'x'.repeat(100),
    })
    expect(designed).toEqual({
      text: 'What they said.',
      previews: [
        { generated: 'g1', audio: new Uint8Array([1, 2]) },
        { generated: 'g2', audio: new Uint8Array([3]) },
      ],
    })
    expect(asked[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-voice/design?output_format=mp3_44100_128',
    )
    expect(asked[0]!.body).toEqual({
      voice_description: 'An old wizard',
      model_id: 'eleven_ttv_v3',
      text: 'x'.repeat(100),
    })
  })

  it('asks ElevenLabs to write its own text when given none', async () => {
    const { fetch, asked } = fakeFetch({ previews: [], text: 'Its own.' })
    await createElevenLabsClient('k', { fetch }).designVoices({ description: 'd', text: null })
    expect(asked[0]!.body).toEqual({
      voice_description: 'd',
      model_id: 'eleven_ttv_v3',
      auto_generate_text: true,
    })
  })

  it('saves a preview as a voice of the user’s, named, and gives its id', async () => {
    const { fetch, asked } = fakeFetch({ voice_id: 'v9', name: 'Mara (designed)' })
    const id = await createElevenLabsClient('k', { fetch }).saveDesignedVoice({
      generated: 'g1',
      name: 'Mara (designed)',
      description: 'An old wizard',
    })
    expect(id).toBe('v9')
    expect(asked[0]!.url).toBe('https://api.elevenlabs.io/v1/text-to-voice')
    expect(asked[0]!.body).toEqual({
      voice_name: 'Mara (designed)',
      voice_description: 'An old wizard',
      generated_voice_id: 'g1',
    })
  })
})
