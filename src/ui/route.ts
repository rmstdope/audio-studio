import { useEffect, useState } from 'react'

/** The Music pages: none chosen (the first list), an act's loops, the stingers, or one track. */
export type MusicRoute =
  | { view: 'music'; page: null }
  | { view: 'music'; page: 'act'; part: string }
  | { view: 'music'; page: 'stingers' }
  | { view: 'music'; page: 'track'; track: string }

/** The Images pages: none chosen (the first act), an act's images, the Style page, or one image. */
export type ImagesRoute =
  | { view: 'images'; page: null }
  | { view: 'images'; page: 'act'; part: string }
  | { view: 'images'; page: 'style' }
  | { view: 'images'; page: 'image'; image: string; from?: string }

/**
 * Where the UI is: a part's overview or its lines, every character, one character's page or its
 * audition, or the project's uncommitted changes.
 */
export type Route =
  | { view: 'part'; part: string | null; language?: string }
  | { view: 'lines'; part: string; language?: string }
  | { view: 'characters'; language?: string }
  | { view: 'changes' }
  | { view: 'spending' }
  | { view: 'setup' }
  | MusicRoute
  | ImagesRoute
  | { view: 'character'; character: string; language?: string }
  | { view: 'audition'; character: string; language?: string }

/**
 * The route in a location hash: `#/parts/act1`, `#/parts/act1/lines` (either with `?language=sv`), `#/characters`,
 * `#/characters/mira`, `#/characters/mira/audition` (these two too with `?language=sv`), `#/changes`, `#/spending`, `#/setup`, `#/music`, `#/music/parts/act1`, `#/music/stingers`, `#/music/tracks/victory`, `#/images`, `#/images/parts/act1`, `#/images/style`, `#/images/items/silver-stag-inn` (with `?from=act1`, the act it was opened from); anything else is the
 * default part.
 */
export function parseRoute(hash: string): Route {
  const [path = '', query] = hash.replace(/^#/, '').split('?')
  const language = new URLSearchParams(query).get('language') ?? undefined
  const from = new URLSearchParams(query).get('from') ?? undefined
  const [, first, second, third] = path.split('/')
  if (first === 'changes') return { view: 'changes' }
  if (first === 'spending') return { view: 'spending' }
  if (first === 'setup') return { view: 'setup' }
  if (first === 'music') {
    if (second === 'parts' && third) {
      return { view: 'music', page: 'act', part: decodeURIComponent(third) }
    }
    if (second === 'tracks' && third) {
      return { view: 'music', page: 'track', track: decodeURIComponent(third) }
    }
    return second === 'stingers'
      ? { view: 'music', page: 'stingers' }
      : { view: 'music', page: null }
  }
  if (first === 'images') {
    if (second === 'parts' && third) {
      return { view: 'images', page: 'act', part: decodeURIComponent(third) }
    }
    if (second === 'items' && third) {
      const image = decodeURIComponent(third)
      return from
        ? { view: 'images', page: 'image', image, from }
        : { view: 'images', page: 'image', image }
    }
    return second === 'style' ? { view: 'images', page: 'style' } : { view: 'images', page: null }
  }
  if (first === 'characters') {
    if (!second) return language ? { view: 'characters', language } : { view: 'characters' }
    const character = decodeURIComponent(second)
    const view = third === 'audition' ? 'audition' : 'character'
    return language ? { view, character, language } : { view, character }
  }
  if (first === 'parts' && second) {
    const part = decodeURIComponent(second)
    const view = third === 'lines' ? 'lines' : 'part'
    return language ? { view, part, language } : { view, part }
  }
  return { view: 'part', part: null }
}

/** The hash for a route. */
export function routeHref(route: Route): string {
  if (route.view === 'changes') return '#/changes'
  if (route.view === 'spending') return '#/spending'
  if (route.view === 'setup') return '#/setup'
  if (route.view === 'music') {
    if (route.page === 'track') return `#/music/tracks/${encodeURIComponent(route.track)}`
    return route.page === 'act'
      ? `#/music/parts/${encodeURIComponent(route.part)}`
      : route.page === 'stingers'
        ? '#/music/stingers'
        : '#/music'
  }
  if (route.view === 'images') {
    if (route.page === 'image') {
      const from = route.from ? `?from=${encodeURIComponent(route.from)}` : ''
      return `#/images/items/${encodeURIComponent(route.image)}${from}`
    }
    return route.page === 'act'
      ? `#/images/parts/${encodeURIComponent(route.part)}`
      : route.page === 'style'
        ? '#/images/style'
        : '#/images'
  }
  const query = route.language ? `?language=${encodeURIComponent(route.language)}` : ''
  if (route.view === 'characters') return `#/characters${query}`
  if (route.view === 'character')
    return `#/characters/${encodeURIComponent(route.character)}${query}`
  if (route.view === 'audition')
    return `#/characters/${encodeURIComponent(route.character)}/audition${query}`
  const part = encodeURIComponent(route.part ?? '')
  return `${route.view === 'lines' ? `#/parts/${part}/lines` : `#/parts/${part}`}${query}`
}

/** The current route, following the location hash. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
