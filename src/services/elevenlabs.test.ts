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

  it('says so when ElevenLabs does not answer in time', async () => {
    const fetch = (async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    }) as unknown as typeof globalThis.fetch
    await expect(
      createElevenLabsClient('k', { fetch, timeoutMs: 5000 }).subscription(),
    ).rejects.toThrow('ElevenLabs did not answer within 5 s')
  })
})
