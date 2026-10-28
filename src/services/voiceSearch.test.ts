import { describe, expect, it } from 'bun:test'
import { fakeEleven } from '../../test/helpers'
import type { LibraryQuery } from './elevenlabs'
import type { Voice } from '../core/voiceSearch'
import type { FishClient, VoiceQuery } from './fish'
import { searchLibrary, searchVoices } from './voiceSearch'

function voice(id: string, title: string, uses = 0): Voice {
  return {
    id,
    title,
    description: '',
    tags: [],
    languages: ['en'],
    uses,
    likes: 0,
    author: '',
    sample: null,
  }
}

/** A Fish client whose library is `voices`; a title query returns voices whose title contains it. */
function fakeFish(voices: Voice[], pageSize = 100) {
  const queries: VoiceQuery[] = []
  const client: FishClient = {
    async listOwnVoices() {
      return []
    },
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return 25
    },
    async listVoices(query) {
      queries.push(query)
      const hits = voices.filter((v) => v.title.toLowerCase().includes(query.title ?? ''))
      const start = (query.pageNumber - 1) * query.pageSize
      return { total: hits.length, items: hits.slice(start, start + query.pageSize) }
    },
    async getVoice(id) {
      const found = voices.find((v) => v.id === id)
      if (!found) throw new Error('no such voice')
      return found
    },
    async tts() {
      return new Uint8Array([0x49, 0x44, 0x33])
    },
  }
  return { client, queries, pageSize }
}

describe('searchVoices', () => {
  it('searches every term, pools and ranks the results', async () => {
    const { client, queries } = fakeFish([
      voice('a', 'warm storyteller', 5),
      voice('b', 'warm', 50),
      voice('c', 'cold'),
    ])
    const found = await searchVoices(client, ['warm', 'storyteller'], {
      language: 'en',
      exclude: new Set(),
    })
    expect(found.map((c) => c.voice.id)).toEqual(['a', 'b'])
    expect(queries.map((q) => q.title)).toEqual(['warm', 'storyteller'])
    expect(queries.every((q) => q.language === 'en' && q.pageNumber === 1)).toBe(true)
  })

  it('reads further pages only while they come back full', async () => {
    const library = Array.from({ length: 5 }, (_, i) => voice(`v${i}`, 'warm'))
    const { client, queries } = fakeFish(library)
    await searchVoices(client, ['warm'], {
      language: 'en',
      exclude: new Set(),
      pageSize: 2,
      pages: 5,
    })
    expect(queries.map((q) => q.pageNumber)).toEqual([1, 2, 3])
  })

  it('leaves out excluded voices', async () => {
    const { client } = fakeFish([voice('a', 'warm'), voice('b', 'warm')])
    const found = await searchVoices(client, ['warm'], { language: 'en', exclude: new Set(['a']) })
    expect(found.map((c) => c.voice.id)).toEqual(['b'])
  })

  it('finds nothing without keywords, and asks Fish nothing', async () => {
    const { client, queries } = fakeFish([voice('a', 'warm')])
    expect(await searchVoices(client, [], { language: 'en', exclude: new Set() })).toEqual([])
    expect(queries).toEqual([])
  })
})

describe('searchLibrary', () => {
  /** A library voice titled `title`, described `description`, used `uses` times. */
  const shared = (id: string, title: string, description: string, uses = 0): Voice => ({
    id: `eleven:${id}`,
    title,
    description,
    tags: [],
    languages: ['en'],
    uses,
    likes: 0,
    author: '',
    sample: null,
    library: { owner: 'o', added: false },
  })

  it('searches every term with the gender and age the keywords name, pools and ranks', async () => {
    const queries: LibraryQuery[] = []
    const { client } = fakeEleven()
    client.sharedVoices = async (query) => {
      queries.push(query)
      return query.search === 'gruff'
        ? [shared('a', 'Gruff', 'a gruff old man', 5), shared('b', 'Bark', 'gruff', 50)]
        : [shared('a', 'Gruff', 'a gruff old man', 5)]
    }
    const found = await searchLibrary(client, ['gruff', 'old man'], {
      language: 'en',
      exclude: new Set(),
    })
    expect(found.map((c) => [c.voice.id, c.matched])).toEqual([
      ['eleven:a', ['gruff', 'old man']],
      ['eleven:b', ['gruff']],
    ])
    expect(queries.map((q) => q.search)).toEqual(['gruff', 'old man', 'old', 'man'])
    expect(queries[0]).toEqual({
      search: 'gruff',
      language: 'en',
      gender: 'male',
      age: 'old',
      pageSize: 100,
    })
  })

  it('leaves out excluded voices, and asks nothing without keywords', async () => {
    const { client } = fakeEleven()
    client.sharedVoices = async () => [shared('a', 'Gruff', 'gruff')]
    expect(
      await searchLibrary(client, ['gruff'], { language: 'en', exclude: new Set(['eleven:a']) }),
    ).toEqual([])
    client.sharedVoices = async () => {
      throw new Error('asked')
    }
    expect(await searchLibrary(client, [], { language: 'en', exclude: new Set() })).toEqual([])
  })
})
