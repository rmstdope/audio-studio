import { describe, expect, it } from 'bun:test'
import { projectJson, tempRepo } from '../../test/helpers'
import { ProjectSchema } from '../core/project'
import { createFishClient, FishError, fishFromEnv } from './fish'

const apiVoice = {
  _id: 'v1',
  type: 'tts',
  title: 'Warm Granny ',
  description: 'An elderly woman',
  cover_image: 'x.png',
  tags: ['elderly', 'female'],
  languages: ['en'],
  task_count: 1200,
  like_count: 30,
  samples: [{ title: 's', text: 'Hello there.', task_id: 't', audio: 'https://cdn/x.mp3' }],
  author: { _id: 'a', nickname: 'granny-maker', avatar: '' },
  visibility: 'public',
}

/** A fetch that records requests and answers with `body`. */
function fakeFetch(body: unknown, status = 200) {
  const requests: Request[] = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push(new Request(input, init))
    return Response.json(body, { status })
  }
  return { fetch: fetch as typeof globalThis.fetch, requests }
}

describe('createFishClient', () => {
  it('lists voices with the query and the key, as the studio’s Voice', async () => {
    const { fetch, requests } = fakeFetch({ total: 1, items: [apiVoice] })
    const client = createFishClient('secret', { fetch })
    const page = await client.listVoices({
      title: 'warm',
      language: 'en',
      pageSize: 100,
      pageNumber: 2,
    })
    const url = new URL(requests[0]!.url)
    expect(url.origin + url.pathname).toBe('https://api.fish.audio/model')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      title: 'warm',
      language: 'en',
      page_size: '100',
      page_number: '2',
      sort_by: 'task_count',
    })
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer secret')
    expect(page).toEqual({
      total: 1,
      items: [
        {
          id: 'v1',
          title: 'Warm Granny',
          description: 'An elderly woman',
          tags: ['elderly', 'female'],
          languages: ['en'],
          uses: 1200,
          likes: 30,
          author: 'granny-maker',
          sample: { text: 'Hello there.', audio: 'https://cdn/x.mp3' },
        },
      ],
    })
  })

  it('gets one voice', async () => {
    const { fetch, requests } = fakeFetch(apiVoice)
    const voice = await createFishClient('k', { fetch }).getVoice('v1')
    expect(new URL(requests[0]!.url).pathname).toBe('/model/v1')
    expect(voice.title).toBe('Warm Granny')
  })

  it('tolerates voices with fields missing', async () => {
    const { fetch } = fakeFetch({ total: 1, items: [{ _id: 'v2', title: 'Bare' }] })
    const page = await createFishClient('k', { fetch }).listVoices({
      title: 'x',
      pageSize: 10,
      pageNumber: 1,
    })
    expect(page.items[0]).toMatchObject({ id: 'v2', tags: [], uses: 0, author: '', sample: null })
  })

  it('throws a FishError with the status on failure', async () => {
    const { fetch } = fakeFetch({ message: 'Invalid api key' }, 401)
    const failing = createFishClient('bad', { fetch }).getVoice('v1')
    await expect(failing).rejects.toBeInstanceOf(FishError)
    await expect(failing).rejects.toThrow('Fish Audio answered 401: Invalid api key')
  })
})

describe('credit', () => {
  it('reads the account’s remaining API credit, in dollars', async () => {
    const { fetch, requests } = fakeFetch({
      _id: 'w',
      user_id: 'u',
      credit: '12.3456',
      cumulative_top_up: '20',
    })
    const client = createFishClient('secret', { fetch })
    expect(await client.credit()).toBe(12.3456)
    expect(new URL(requests[0]!.url).pathname).toBe('/wallet/self/api-credit')
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer secret')
  })

  it('throws when Fish answers with something that is not an amount', async () => {
    for (const credit of ['lots', '', ' ', '0x10', '1e400']) {
      const { fetch } = fakeFetch({ credit })
      await expect(createFishClient('secret', { fetch }).credit()).rejects.toThrow('credit')
    }
  })
})

describe('tts', () => {
  it('posts the text, voice and settings as JSON with the model in a header, and returns the audio', async () => {
    const requests: Request[] = []
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return new Response(new Uint8Array([1, 2, 3]))
    }) as unknown as typeof globalThis.fetch
    const audio = await createFishClient('secret', { fetch }).tts({
      text: '[warm] Hello.',
      voice: 'v1',
      model: 's2.1-pro-free',
      temperature: 0.7,
      topP: 0.6,
      speed: 0.9,
    })
    expect([...audio]).toEqual([1, 2, 3])
    const request = requests[0]!
    expect(request.method).toBe('POST')
    expect(new URL(request.url).pathname).toBe('/v1/tts')
    expect(request.headers.get('model')).toBe('s2.1-pro-free')
    expect(request.headers.get('authorization')).toBe('Bearer secret')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.json()).toEqual({
      text: '[warm] Hello.',
      reference_id: 'v1',
      format: 'mp3',
      latency: 'normal',
      temperature: 0.7,
      top_p: 0.6,
      prosody: { speed: 0.9, volume: 0 },
    })
  })

  it('throws a FishError when Fish refuses', async () => {
    const fetch = (async () =>
      Response.json(
        { message: 'No credit' },
        { status: 402 },
      )) as unknown as typeof globalThis.fetch
    const failing = createFishClient('k', { fetch }).tts({
      text: 'x',
      voice: 'v',
      model: 'm',
      temperature: 0.7,
      topP: 0.7,
      speed: 1,
    })
    await expect(failing).rejects.toThrow('Fish Audio answered 402: No credit')
  })
})

describe('rate limit', () => {
  const request = { text: 'x', voice: 'v', model: 'm', temperature: 0.7, topP: 0.7, speed: 1 }

  /** A fetch that answers 429 `limited` times, then the audio. */
  function limitedFetch(limited: number) {
    let calls = 0
    const fetch = (async () => {
      calls++
      return calls <= limited
        ? Response.json({ message: 'Too many requests' }, { status: 429 })
        : new Response(new Uint8Array([7]))
    }) as unknown as typeof globalThis.fetch
    return { fetch, calls: () => calls }
  }

  it('waits and asks again when Fish answers 429, doubling the wait each time', async () => {
    const waits: number[] = []
    const sleep = async (ms: number) => {
      waits.push(ms)
    }
    const { fetch, calls } = limitedFetch(3)
    const audio = await createFishClient('k', { fetch, sleep }).tts(request)
    expect([...audio]).toEqual([7])
    expect(calls()).toBe(4)
    expect(waits).toEqual([1000, 2000, 4000])
  })

  it('gives up after the last wait, with Fish’s answer', async () => {
    const waits: number[] = []
    const sleep = async (ms: number) => {
      waits.push(ms)
    }
    const { fetch, calls } = limitedFetch(100)
    const failing = createFishClient('k', { fetch, sleep }).tts(request)
    await expect(failing).rejects.toThrow('Fish Audio answered 429: Too many requests')
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000])
    expect(calls()).toBe(7)
  })

  it('asks again for searches too, and not for other refusals', async () => {
    const sleep = async () => {}
    let calls = 0
    const fetch = (async () => {
      calls++
      return calls === 1
        ? Response.json({}, { status: 429 })
        : Response.json({ total: 0, items: [] })
    }) as unknown as typeof globalThis.fetch
    const page = await createFishClient('k', { fetch, sleep }).listVoices({
      title: 'x',
      pageSize: 1,
      pageNumber: 1,
    })
    expect(page.total).toBe(0)
    expect(calls).toBe(2)

    let refusals = 0
    const refusing = (async () => {
      refusals++
      return Response.json({ message: 'No credit' }, { status: 402 })
    }) as unknown as typeof globalThis.fetch
    await expect(createFishClient('k', { fetch: refusing, sleep }).tts(request)).rejects.toThrow(
      '402',
    )
    expect(refusals).toBe(1)
  })
})

describe('tts, timeout', () => {
  it('gives up on a request that never answers', async () => {
    const fetch = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof globalThis.fetch
    const client = createFishClient('k', { fetch, timeoutMs: 20 })
    const request = { text: 'x', voice: 'v', model: 'm', temperature: 0.7, topP: 0.7, speed: 1 }
    await expect(client.tts(request)).rejects.toThrow('did not answer within')
  })
})

describe('requests, a stalled body', () => {
  it('gives up on an answer whose body never ends', async () => {
    const fetch = ((_input: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"total'))
          init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason))
        },
      })
      return Promise.resolve(
        new Response(body, { headers: { 'content-type': 'application/json' } }),
      )
    }) as unknown as typeof globalThis.fetch
    const client = createFishClient('k', { fetch, timeoutMs: 20 })
    await expect(client.listVoices({ title: 'x', pageSize: 1, pageNumber: 1 })).rejects.toThrow(
      'did not answer within',
    )
  })
})

describe('fishFromEnv', () => {
  const project = ProjectSchema.parse(projectJson())

  it('makes a client from the key in the project’s env file', async () => {
    const root = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=secret\n' })
    expect(await fishFromEnv(root, project, {})).not.toBeNull()
  })

  it('is null without a key', async () => {
    expect(await fishFromEnv(tempRepo({}), project, {})).toBeNull()
  })
})
