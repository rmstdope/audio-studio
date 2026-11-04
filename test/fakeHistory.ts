/** One entry of the fake session history: the address's hash and the state stored with it. */
interface Entry {
  hash: string
  state: unknown
}

/** The fake history a test drives, and what it can see of it. */
export interface FakeHistory {
  /** A link clicked or a hash typed: a new entry after this one, dropping any ahead. */
  click: (hash: string) => void
  /** The browser's Back button. */
  back: () => void
  /** The hashes of every entry, in order. */
  hashes: () => string[]
  /** Which entry the browser is at. */
  at: () => number
  /** Puts the real `window.history` back. */
  restore: () => void
}

/**
 * Stands in for the browser's session history the way a browser keeps it, which happy-dom does not:
 * a hash move pushes an entry with no state, Back and `go` land a moment later, and `hashchange`
 * fires only when the hash actually differs. Installed as `window.history`, starting with one entry
 * at `start`; the address bar follows through the real history's `replaceState`, whose own
 * hashchange is swallowed.
 */
export function fakeHistory(start: string): FakeHistory {
  const real = window.history
  const replaceReal = real.replaceState.bind(real)
  const entries: Entry[] = [{ hash: start, state: null }]
  let at = 0
  const show = () => replaceReal(null, '', entries[at]!.hash || '#')
  // happy-dom also fires hashchange when `replaceState` changes the hash, which a browser never
  // does: only the fake's own events get through.
  const ours = new WeakSet<Event>()
  const fire = () => {
    const event = new HashChangeEvent('hashchange')
    ours.add(event)
    window.dispatchEvent(event)
  }
  const swallow = (event: Event) => {
    if (!ours.has(event)) event.stopImmediatePropagation()
  }
  window.addEventListener('hashchange', swallow, true)
  const hashOf = (url: string | URL | null | undefined) =>
    url === undefined || url === null ? entries[at]!.hash : new URL(url, window.location.href).hash
  const fake = {
    get length() {
      return entries.length
    },
    get state() {
      return entries[at]!.state
    },
    replaceState(state: unknown, _title: string, url?: string | URL | null) {
      entries[at] = { hash: hashOf(url), state }
      show()
    },
    pushState(state: unknown, _title: string, url?: string | URL | null) {
      entries.splice(at + 1, entries.length, { hash: hashOf(url), state })
      at += 1
      show()
    },
    go(delta = 0) {
      const to = at + delta
      if (delta === 0 || to < 0 || to >= entries.length) return
      setTimeout(() => {
        const before = entries[at]!.hash
        at = to
        show()
        if (entries[at]!.hash !== before) fire()
      }, 0)
    },
    back() {
      fake.go(-1)
    },
    forward() {
      fake.go(1)
    },
  }
  show()
  Object.defineProperty(window, 'history', { value: fake, configurable: true })
  return {
    click: (hash) => {
      entries.splice(at + 1, entries.length, { hash, state: null })
      at += 1
      show()
      fire()
    },
    back: () => fake.go(-1),
    hashes: () => entries.map((e) => e.hash),
    at: () => at,
    restore: () => {
      window.removeEventListener('hashchange', swallow, true)
      Object.defineProperty(window, 'history', { value: real, configurable: true })
    },
  }
}
