import { rankVoices, searchTerms, type Candidate, type Voice } from '../core/voiceSearch'
import { libraryFilters, libraryWords } from '../core/elevenLibrary'
import type { ElevenLabsClient } from './elevenlabs'
import type { FishClient } from './fish'

/** How to search: the language to filter on, voices to leave out, and how far to page. */
export interface SearchOptions {
  language: string
  exclude: Set<string>
  /** Results per request (Fish allows up to 100). */
  pageSize?: number
  /** Pages to read per term at most. */
  pages?: number
  /** Requests to Fish at once (the project's `quality.parallel`). */
  parallel?: number
}

/**
 * Voices in Fish's library for an audition: every search term (see `searchTerms`) is searched,
 * a few pages each, and the pooled results ranked by keywords matched, then popularity.
 */
export async function searchVoices(
  client: FishClient,
  keywords: string[],
  { language, exclude, pageSize = 100, pages = 2, parallel = 4 }: SearchOptions,
): Promise<Candidate[]> {
  const terms = searchTerms(keywords)
  const pooled: Voice[] = []
  const searchTerm = async (title: string) => {
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const page = await client.listVoices({ title, language, pageSize, pageNumber })
      pooled.push(...page.items)
      if (page.items.length < pageSize) break
    }
  }
  for (let i = 0; i < terms.length; i += parallel) {
    await Promise.all(terms.slice(i, i + parallel).map(searchTerm))
  }
  return rankVoices(pooled, keywords, exclude)
}

/**
 * Voices in ElevenLabs' shared library for an audition: every search term (see `searchTerms`) is
 * searched, two pages at most, in the language and for the gender and age the keywords name, two
 * terms at a time, and the pooled results ranked as Fish's are. The words that asked for the
 * gender and age count as matched by every voice found, which ElevenLabs filtered by them.
 */
export async function searchLibrary(
  client: ElevenLabsClient,
  keywords: string[],
  { language, exclude, pages = 2 }: Pick<SearchOptions, 'language' | 'exclude' | 'pages'>,
): Promise<Candidate[]> {
  const terms = searchTerms(keywords)
  const filters = libraryFilters(keywords)
  const pooled: Voice[] = []
  const searchTerm = async (search: string) => {
    for (let page = 0; page < pages; page++) {
      const found = await client.sharedVoices({
        search,
        language,
        ...filters,
        pageSize: 100,
        page,
      })
      pooled.push(...found.voices)
      if (!found.more) break
    }
  }
  for (let i = 0; i < terms.length; i += 2) {
    await Promise.all(terms.slice(i, i + 2).map(searchTerm))
  }
  const asked = libraryWords(keywords)
  const shown = new Map(pooled.map((voice) => [voice.id, voice]))
  const ranked = rankVoices(
    pooled.map((voice) => ({ ...voice, tags: [...voice.tags, ...asked] })),
    keywords,
    exclude,
  )
  return ranked.map((c) => ({ ...c, voice: shown.get(c.voice.id)! }))
}
