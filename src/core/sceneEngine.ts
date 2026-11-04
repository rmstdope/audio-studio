import type { Play } from './scenes'

/** How long a state change fades a sound in or out, in seconds: `STATE_FADE_SECONDS` of the game's `ambience.ts`. */
export const STATE_FADE_SECONDS = 0.3

/** One effect row as the engine plays it: the numbers are real numbers, `seconds` the clip's length. */
export interface EngineRow {
  id: string
  play: Play
  /** The state it plays in; null: always. */
  state: string | null
  /** The clip's length in seconds; null when there is nothing to sound (no take, not loaded). */
  seconds: number | null
}

/** What the sound layer is asked to do: start or stop a row's clip, with a fade or without. */
export interface Cue {
  kind: 'start' | 'stop'
  slot: number
  loop: boolean
  fade: boolean
}

/** What a row is doing, for the Now words (seconds are exact; the page rounds them). */
export type RowNow =
  | { kind: 'playing' }
  | { kind: 'in'; seconds: number }
  | { kind: 'next'; seconds: number }
  | { kind: 'played'; at: number }
  | { kind: 'waits'; trigger: string }
  | { kind: 'otherState' }

/** The rows, as the engine keeps them. */
interface Slot {
  row: EngineRow
  /** A loop is sounding. */
  looping: boolean
  /** A one-shot sounds until this time. */
  soundsUntil: number
  /** A random or once row starts at this time; null: not waiting. */
  startAt: number | null
  /** A once row has sounded, and when. */
  playedAt: number | null
}

/** The part of a row that makes it the same row after an edit: not its level. */
function fingerprint(row: EngineRow): string {
  return JSON.stringify([row.id, row.play, row.state])
}

/**
 * The rules of §8.11 "How the game plays a scene", with no clock and no audio: every call is given
 * the time in seconds since the scene was entered, and answers with the cues to sound. `random` is
 * 0 up to 1.
 */
export function createSceneEngine(options: { random: () => number }) {
  let slots = new Map<number, Slot>()
  let order: number[] = []
  let next = 0
  let state: string | null = null

  const here = (slot: Slot) => slot.row.state === null || slot.row.state === state
  const length = (slot: Slot) => slot.row.seconds ?? 0

  /** Starts a row's clip as a one-shot at `at`. */
  const shoot = (id: number, slot: Slot, at: number): Cue[] => {
    slot.soundsUntil = at + length(slot)
    return slot.row.seconds === null ? [] : [{ kind: 'start', slot: id, loop: false, fade: false }]
  }

  /** The row is in its state at `at` (entering, a state change, an edit): begins its waiting or its loop. */
  const begin = (id: number, slot: Slot, at: number, fade: boolean): Cue[] => {
    const play = slot.row.play
    if (play.mode === 'loop') {
      slot.looping = true
      return slot.row.seconds === null ? [] : [{ kind: 'start', slot: id, loop: true, fade }]
    }
    if (play.mode === 'random') {
      const [n, m] = play.everySeconds
      slot.startAt = at + n + options.random() * (m - n)
    } else if (play.mode === 'once' && slot.playedAt === null) {
      slot.startAt = at + play.afterSeconds
    }
    return []
  }

  const add = (row: EngineRow, at: number): { id: number; cues: Cue[] } => {
    const id = next++
    const slot: Slot = { row, looping: false, soundsUntil: -1, startAt: null, playedAt: null }
    slots.set(id, slot)
    order.push(id)
    return { id, cues: here(slot) ? begin(id, slot, at, false) : [] }
  }

  /** Stops what a slot sounds, if it sounds; the cue to end it. */
  const silence = (id: number, slot: Slot, at: number): Cue[] => {
    const sounding = slot.row.seconds !== null && (slot.looping || slot.soundsUntil > at)
    slot.looping = false
    slot.startAt = null
    slot.soundsUntil = -1
    return sounding
      ? [{ kind: 'stop', slot: id, loop: slot.row.play.mode === 'loop', fade: true }]
      : []
  }

  return {
    /** Enters the scene afresh in `initial` at `at`: every row begins. Returns the cues. */
    enter(rows: EngineRow[], initial: string | null, at: number): Cue[] {
      slots = new Map()
      order = []
      state = initial
      const cues: Cue[] = []
      for (const row of rows) cues.push(...add(row, at).cues)
      return cues
    },

    /** Starts what is due by `at`. */
    advance(at: number): Cue[] {
      const cues: Cue[] = []
      for (const id of order) {
        const slot = slots.get(id)!
        if (!here(slot) || slot.startAt === null || slot.startAt > at) continue
        const play = slot.row.play
        const startedAt = slot.startAt
        cues.push(...shoot(id, slot, startedAt))
        if (play.mode === 'once') {
          slot.playedAt = startedAt
          slot.startAt = null
        } else if (play.mode === 'random') {
          const [n, m] = play.everySeconds
          slot.startAt = startedAt + length(slot) + n + options.random() * (m - n)
        }
      }
      return cues
    },

    /** The scene's state becomes `to`: old-only rows fade out, new-only rows begin and fade in. */
    setState(to: string | null, at: number): Cue[] {
      if (to === state) return []
      const cues: Cue[] = []
      const wasHere = new Set(order.filter((id) => here(slots.get(id)!)))
      state = to
      for (const id of order) {
        const slot = slots.get(id)!
        if (here(slot) === wasHere.has(id)) continue
        if (here(slot)) cues.push(...begin(id, slot, at, true))
        else cues.push(...silence(id, slot, at))
      }
      return cues
    },

    /** The game fires `trigger`: the rows bound to it sound at once, once each. */
    fire(trigger: string, at: number): Cue[] {
      const cues: Cue[] = []
      for (const id of order) {
        const slot = slots.get(id)!
        const play = slot.row.play
        if (play.mode === 'trigger' && play.trigger === trigger && here(slot)) {
          cues.push(...shoot(id, slot, at))
        }
      }
      return cues
    },

    /**
     * The rows become `rows` at `at` (an edit): a row that is unchanged carries on, a changed or
     * added one begins afresh, a removed one fades out. `slots` is the slot of each new row.
     */
    setRows(rows: EngineRow[], at: number): { cues: Cue[]; slots: number[] } {
      const cues: Cue[] = []
      const free = new Map<string, number[]>()
      for (const id of order) {
        const key = fingerprint(slots.get(id)!.row)
        free.set(key, [...(free.get(key) ?? []), id])
      }
      const kept = new Set<number>()
      const chosen = rows.map((row) => {
        const id = free.get(fingerprint(row))?.shift()
        if (id === undefined) return null
        kept.add(id)
        const slot = slots.get(id)!
        slot.row = row
        return id
      })
      for (const id of order) {
        if (!kept.has(id)) {
          cues.push(...silence(id, slots.get(id)!, at))
          slots.delete(id)
        }
      }
      order = order.filter((id) => kept.has(id))
      const ids = rows.map((row, i) => {
        const id = chosen[i]
        if (id !== null && id !== undefined) return id
        const made = add(row, at)
        cues.push(...made.cues)
        return made.id
      })
      order = ids.slice()
      return { cues, slots: ids }
    },

    /** What a row is doing at `at`. */
    now(id: number, at: number): RowNow {
      const slot = slots.get(id)!
      const play = slot.row.play
      if (!here(slot)) return { kind: 'otherState' }
      if (slot.looping || slot.soundsUntil > at) return { kind: 'playing' }
      if (play.mode === 'trigger') return { kind: 'waits', trigger: play.trigger }
      if (slot.playedAt !== null) return { kind: 'played', at: slot.playedAt }
      return {
        kind: play.mode === 'once' ? 'in' : 'next',
        seconds: Math.max(0, (slot.startAt ?? at) - at),
      }
    },
  }
}
