import { describe, expect, it } from 'bun:test'
import { createFishClient, FishError } from './fish'

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
