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
