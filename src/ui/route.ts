import { useEffect, useState } from 'react'

/**
 * Where the UI is: a part's overview or its lines, every character, one character's audition, or
 * the project's uncommitted changes.
 */
export type Route =
  | { view: 'part'; part: string | null }
  | { view: 'lines'; part: string }
  | { view: 'characters' }
  | { view: 'changes' }
  | { view: 'audition'; character: string }

/**
 * The route in a location hash: `#/parts/act1`, `#/parts/act1/lines`, `#/characters`,
 * `#/characters/mira/audition`, `#/changes`; anything else is the default part.
 */
export function parseRoute(hash: string): Route {
  const [, first, second, third] = hash.replace(/^#/, '').split('/')
  if (first === 'changes') return { view: 'changes' }
  if (first === 'characters') {
    return second && third === 'audition'
      ? { view: 'audition', character: decodeURIComponent(second) }
      : { view: 'characters' }
  }
  if (first === 'parts' && second) {
    const part = decodeURIComponent(second)
    return third === 'lines' ? { view: 'lines', part } : { view: 'part', part }
  }
  return { view: 'part', part: null }
}

/** The hash for a route. */
export function routeHref(route: Route): string {
  if (route.view === 'characters') return '#/characters'
  if (route.view === 'changes') return '#/changes'
  if (route.view === 'audition')
    return `#/characters/${encodeURIComponent(route.character)}/audition`
  const part = encodeURIComponent(route.part ?? '')
  return route.view === 'lines' ? `#/parts/${part}/lines` : `#/parts/${part}`
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
