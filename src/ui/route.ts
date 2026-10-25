import { useEffect, useState } from 'react'

/**
 * Where the UI is: a part's overview or its lines, every character, one character's page or its
 * audition, or the project's uncommitted changes.
 */
export type Route =
  | { view: 'part'; part: string | null; language?: string }
  | { view: 'lines'; part: string; language?: string }
  | { view: 'characters' }
  | { view: 'changes' }
  | { view: 'setup' }
  | { view: 'character'; character: string }
  | { view: 'audition'; character: string }

/**
 * The route in a location hash: `#/parts/act1`, `#/parts/act1/lines` (either with `?language=sv`), `#/characters`,
 * `#/characters/mira`, `#/characters/mira/audition`, `#/changes`, `#/setup`; anything else is the
 * default part.
 */
export function parseRoute(hash: string): Route {
  const [path = '', query] = hash.replace(/^#/, '').split('?')
  const language = new URLSearchParams(query).get('language') ?? undefined
  const [, first, second, third] = path.split('/')
  if (first === 'changes') return { view: 'changes' }
  if (first === 'setup') return { view: 'setup' }
  if (first === 'characters') {
    if (!second) return { view: 'characters' }
    const character = decodeURIComponent(second)
    return third === 'audition' ? { view: 'audition', character } : { view: 'character', character }
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
  if (route.view === 'characters') return '#/characters'
  if (route.view === 'changes') return '#/changes'
  if (route.view === 'setup') return '#/setup'
  if (route.view === 'character') return `#/characters/${encodeURIComponent(route.character)}`
  if (route.view === 'audition')
    return `#/characters/${encodeURIComponent(route.character)}/audition`
  const part = encodeURIComponent(route.part ?? '')
  const query = route.language ? `?language=${encodeURIComponent(route.language)}` : ''
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
