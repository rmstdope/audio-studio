import { useEffect, useState } from 'react'

/**
 * The Music pages: none chosen (the first list), an act's loops, the stingers (either only those
 * that need attention, with `show`), or one track.
 */
export type MusicRoute =
  | { view: 'music'; page: null }
  | { view: 'music'; page: 'act'; part: string; show?: 'attention' }
  | { view: 'music'; page: 'stingers'; show?: 'attention' }
  | { view: 'music'; page: 'track'; track: string }

/**
 * The Images pages: none chosen (the first act), an act's images (only those that need attention,
 * with `show`), the Style page, or one image.
 */
export type ImagesRoute =
  | { view: 'images'; page: null }
  | { view: 'images'; page: 'act'; part: string; show?: 'attention' }
  | { view: 'images'; page: 'style' }
  | { view: 'images'; page: 'image'; image: string; from?: string }

/** The Sound effects pages: the list (only what needs attention, with `show`), or one effect. */
export type EffectsRoute =
  | { view: 'effects'; page: null; show?: 'attention' }
  | { view: 'effects'; page: 'effect'; effect: string }

/** The Scenes pages: none chosen (the first act), or an act's scenes with the open one. */
export type ScenesRoute =
  { view: 'scenes'; page: null } | { view: 'scenes'; page: 'act'; part: string; scene?: string }

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
  | EffectsRoute
  | ScenesRoute
  | { view: 'character'; character: string; language?: string }
  | { view: 'audition'; character: string; language?: string }

/**
 * The route in a location hash: `#/parts/act1`, `#/parts/act1/lines` (either with `?language=sv`), `#/characters`,
 * `#/characters/mira`, `#/characters/mira/audition` (these two too with `?language=sv`), `#/changes`, `#/spending`, `#/setup`, `#/music`, `#/music/parts/act1`, `#/music/stingers` (these two with `?show=attention`), `#/music/tracks/victory`, `#/images`, `#/images/parts/act1` (with `?show=attention`), `#/images/style`, `#/images/items/silver-stag-inn` (with `?from=act1`, the act it was opened from), `#/effects` (with `?show=attention`), `#/effects/items/door-creak`, `#/scenes`, `#/scenes/parts/act1` (with `?scene=act1-general-store`, the open scene); anything else is the
 * default part.
 */
export function parseRoute(hash: string): Route {
  const [path = '', query] = hash.replace(/^#/, '').split('?')
  const language = new URLSearchParams(query).get('language') ?? undefined
  const from = new URLSearchParams(query).get('from') ?? undefined
  // Only what needs attention, on a list page; left out of the route when the whole list is shown.
  const show =
    new URLSearchParams(query).get('show') === 'attention' ? { show: 'attention' as const } : {}
  const [, first, second, third] = path.split('/')
  if (first === 'changes') return { view: 'changes' }
  if (first === 'spending') return { view: 'spending' }
  if (first === 'setup') return { view: 'setup' }
  if (first === 'music') {
    if (second === 'parts' && third) {
      return { view: 'music', page: 'act', part: decodeURIComponent(third), ...show }
    }
    if (second === 'tracks' && third) {
      return { view: 'music', page: 'track', track: decodeURIComponent(third) }
    }
    return second === 'stingers'
      ? { view: 'music', page: 'stingers', ...show }
      : { view: 'music', page: null }
  }
  if (first === 'effects') {
    return second === 'items' && third
      ? { view: 'effects', page: 'effect', effect: decodeURIComponent(third) }
      : { view: 'effects', page: null, ...show }
  }
  if (first === 'scenes') {
    if (second !== 'parts' || !third) return { view: 'scenes', page: null }
    const scene = new URLSearchParams(query).get('scene') ?? undefined
    const part = decodeURIComponent(third)
    return scene
      ? { view: 'scenes', page: 'act', part, scene }
      : { view: 'scenes', page: 'act', part }
  }
  if (first === 'images') {
    if (second === 'parts' && third) {
      return { view: 'images', page: 'act', part: decodeURIComponent(third), ...show }
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
  const show = 'show' in route && route.show === 'attention' ? '?show=attention' : ''
  if (route.view === 'changes') return '#/changes'
  if (route.view === 'spending') return '#/spending'
  if (route.view === 'setup') return '#/setup'
  if (route.view === 'music') {
    if (route.page === 'track') return `#/music/tracks/${encodeURIComponent(route.track)}`
    return route.page === 'act'
      ? `#/music/parts/${encodeURIComponent(route.part)}${show}`
      : route.page === 'stingers'
        ? `#/music/stingers${show}`
        : '#/music'
  }
  if (route.view === 'effects') {
    return route.page === 'effect'
      ? `#/effects/items/${encodeURIComponent(route.effect)}`
      : `#/effects${show}`
  }
  if (route.view === 'scenes') {
    if (route.page === null) return '#/scenes'
    const scene = route.scene ? `?scene=${encodeURIComponent(route.scene)}` : ''
    return `#/scenes/parts/${encodeURIComponent(route.part)}${scene}`
  }
  if (route.view === 'images') {
    if (route.page === 'image') {
      const from = route.from ? `?from=${encodeURIComponent(route.from)}` : ''
      return `#/images/items/${encodeURIComponent(route.image)}${from}`
    }
    return route.page === 'act'
      ? `#/images/parts/${encodeURIComponent(route.part)}${show}`
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

/**
 * A page's check on a move of the address, `delta` entries along the session history (1 for a new
 * entry or Forward, -1 for Back, 0 when unknown): true when it has undone the move to ask first.
 */
type Hold = (delta: number) => boolean

let hold: Hold | null = null

/** The key in `history.state` that numbers each entry, so a move tells how far it went. */
const AT = 'contentStudioAt'

/** The number of the entry the router follows. */
let here = 0

/**
 * The number of the entry the browser is at. An entry without one is new, and is given `fresh`;
 * the rest keep theirs, across Back, Forward and reloads.
 */
function entryAt(fresh: number): number {
  const state: unknown = window.history.state
  const known = typeof state === 'object' && state !== null ? Reflect.get(state, AT) : undefined
  if (typeof known === 'number') return known
  const kept = typeof state === 'object' && state !== null ? state : {}
  window.history.replaceState({ ...kept, [AT]: fresh }, '')
  return fresh
}

/**
 * Lets the open page stop the route from following a move of the address (a page with unsaved
 * changes asks first). Returns what to call when the page goes away. The router asks it, so the
 * answer comes before anything of the other page is rendered, whatever the order of the browser's
 * listeners.
 */
export function holdRoute(check: Hold): () => void {
  hold = check
  return () => {
    if (hold === check) hold = null
  }
}

/** The current route, following the location hash. */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    // A fresh page load is the last entry.
    here = entryAt(window.history.length - 1)
    const update = () => {
      // A move to an entry never seen before is a new one, pushed after the one the user was at.
      const at = entryAt(here + 1)
      if (hold?.(at - here)) return
      here = at
      setRoute(parseRoute(window.location.hash))
    }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
