import { describe, expect, it } from 'bun:test'
import type { Voice } from '../core/voiceSearch'
import type { FishClient, VoiceQuery } from './fish'
import { searchVoices } from './voiceSearch'

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
