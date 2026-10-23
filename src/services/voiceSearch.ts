import { rankVoices, searchTerms, type Candidate, type Voice } from '../core/voiceSearch'
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
