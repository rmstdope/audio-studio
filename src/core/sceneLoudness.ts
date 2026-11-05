import { z } from 'zod'
import { sameMix, scaleLevel } from './sceneEdit'
import { SceneMixSchema, type Play, type SceneMix } from './scenes'

/** How much of a scene's sound is measured: a steady-state minute in each state. */
export const WINDOW_SECONDS = 60

/** The target a project file sets for its scenes, and how far one may be off it (dB). */
export interface LoudnessTarget {
  target: number
  tolerance: number
}

/** The music of a scene as it is measured; `missing` when there is no file to play. */
export interface PlanMusic {
  track: string
  level: number
  missing?: boolean
}

/** An effect row of a scene as it is measured; `seconds` null when there is no clip to play. */
export interface PlanEffect {
  id: string
  play: Play
  state: string | null
  level: number
  seconds: number | null
}

/** One clip in the minute that is measured: how loud, and when it starts (seconds from 0). */
export interface MixPart {
  source: { kind: 'music' | 'effect'; id: string }
  level: number
  /** Played round and round for the whole window; `starts` is `[0]`. */
  loop: boolean
  starts: number[]
}

/** The most starts of one effect in the window, so a wait of nothing cannot spin. */
const MAX_STARTS = WINDOW_SECONDS * 2

/**
 * What plays in one state (§8.11): the music as a loop; an effect of that state, or of none, as
 * the game plays it, taking every random wait at the middle of its range so the figure is the same
 * every time. Loops fill the minute; a random effect starts mid-range and again after each clip
 * and wait; a once effect sounds at its delay if that is inside the minute; a trigger effect is
 * left out, since the player fires it. What has no clip is left out.
 */
export function planStateMix(input: {
  music: PlanMusic | null
  effects: PlanEffect[]
  state: string | null
}): MixPart[] {
  const parts: MixPart[] = []
  const { music } = input
  if (music && !music.missing) {
    parts.push({
      source: { kind: 'music', id: music.track },
      level: music.level,
      loop: true,
      starts: [0],
    })
  }
  for (const row of input.effects) {
    if (row.seconds === null) continue
    if (row.state !== null && row.state !== input.state) continue
    const source = { kind: 'effect' as const, id: row.id }
    const { play } = row
    if (play.mode === 'loop') {
      parts.push({ source, level: row.level, loop: true, starts: [0] })
    } else if (play.mode === 'random') {
      const wait = (play.everySeconds[0] + play.everySeconds[1]) / 2
      const step = Math.max(row.seconds + wait, 0.5)
      const starts: number[] = []
      for (let at = wait; at < WINDOW_SECONDS && starts.length < MAX_STARTS; at += step) {
        starts.push(at)
      }
      if (starts.length > 0) parts.push({ source, level: row.level, loop: false, starts })
    } else if (play.mode === 'once' && play.afterSeconds < WINDOW_SECONDS) {
      parts.push({ source, level: row.level, loop: false, starts: [play.afterSeconds] })
    }
  }
  return parts
}

/** The states a scene is measured in, in the game's order; `null` is a scene that has none. */
export function sceneStateNames(scene: { states: string[] }): (string | null)[] {
  return scene.states.length > 0 ? scene.states : [null]
}

/** One state's figure: integrated LUFS, or null when nothing plays in it. */
export interface StateLoudness {
  state: string | null
  lufs: number | null
}

/** What one measuring of a scene found, and what it was measured from. */
export const SceneMeasureSchema = z.object({
  /** When it was measured (ISO). */
  measuredAt: z.string(),
  /** The scene's entry in the mix as it was measured (null: none). */
  entry: SceneMixSchema.nullable(),
  /** The clip each sound came from (a take number or the game's file), to tell when one changed. */
  clips: z.record(z.string(), z.string()),
  /** Set once a scene was saved after "Make … louder / quieter": the figures are then expected ones (measured + db). */
  moved: z.object({ db: z.number() }).nullable().optional(),
  states: z.array(z.object({ state: z.string().nullable(), lufs: z.number().nullable() })),
  /** What was left out, worded "glass-clink, which has no take chosen". */
  without: z.array(z.string()),
  /** Why the scene could not be measured; null when it was. */
  error: z.string().nullable(),
})

/** What one measuring of a scene found. */
export type SceneMeasure = z.infer<typeof SceneMeasureSchema>

/** The kept measures of one scene: of the saved scene, and of the open scene with unsaved changes. */
export const SceneKeptSchema = z.object({
  saved: SceneMeasureSchema.nullable().default(null),
  draft: SceneMeasureSchema.nullable().default(null),
})

/** The kept measures of one scene. */
export type SceneKept = z.infer<typeof SceneKeptSchema>

/** The kept file: scene id to its measures, per act. */
export const LoudnessFileSchema = z.record(z.string(), z.record(z.string(), SceneKeptSchema))

/** The kept file. */
export type LoudnessFile = z.infer<typeof LoudnessFileSchema>

/** The `scenes.loudness` figure as the panel writes it: "−19.4 LUFS". */
export function formatLufs(lufs: number): string {
  return `${minus(lufs.toFixed(1))} LUFS`
}

/** A number as short as it can be written, with a true minus. */
function short(n: number): string {
  return minus(String(Number(n.toFixed(1))))
}

/** Writes a hyphen-minus as the minus sign. */
function minus(text: string): string {
  return text.replace('-', '−')
}

/** The panel's target line: "target −20 LUFS ± 2 dB", or "no target set". */
export function targetLine(target: LoudnessTarget | null): string {
  return target
    ? `target ${short(target.target)} LUFS ± ${short(target.tolerance)} dB`
    : 'no target set'
}

/**
 * How far a figure is from the target, judged on the figure as shown ("−22.0 LUFS", one decimal):
 * the figure, the distance and the chip then always agree. Rounded again to shed float noise.
 */
function shownOff(lufs: number, target: LoudnessTarget): number {
  return Number((Number(lufs.toFixed(1)) - target.target).toFixed(1))
}

/** A state's chip: on target, or how far off, one decimal. Null: nothing to say. */
export function chipFor(
  lufs: number | null,
  target: LoudnessTarget | null,
): { kind: 'on' | 'quiet' | 'loud'; text: string } | null {
  if (lufs === null || !target) return null
  const off = shownOff(lufs, target)
  if (Math.abs(off) <= target.tolerance) return { kind: 'on', text: 'on target' }
  const by = Math.abs(off).toFixed(1)
  return off < 0
    ? { kind: 'quiet', text: `${by} dB too quiet` }
    : { kind: 'loud', text: `${by} dB too loud` }
}

/**
 * What the scene list says of a scene from its measure: which way it is off, or "off target" when
 * its states disagree. Null when it is on target, nothing plays, it could not be measured, or
 * there is no target.
 */
export function sceneVerdict(
  measure: SceneMeasure | null,
  target: LoudnessTarget | null,
): 'too loud' | 'too quiet' | 'off target' | null {
  if (!measure || measure.error !== null) return null
  const kinds = new Set(measure.states.map((s) => chipFor(s.lufs, target)?.kind))
  const loud = kinds.has('loud')
  const quiet = kinds.has('quiet')
  return loud && quiet ? 'off target' : loud ? 'too loud' : quiet ? 'too quiet' : null
}

/** Whether the scene changed since it was measured: saved differently, or a take it plays changed. */
export function measureChanged(
  measure: SceneMeasure,
  scene: { entry: SceneMix | null; clips: Record<string, string> },
): boolean {
  // A scene that could not be measured has nothing to be out of date.
  if (measure.error !== null) return false
  if (!sameMix(measure.entry, scene.entry)) return true
  const was = Object.keys(measure.clips)
  const now = Object.keys(scene.clips)
  return was.length !== now.length || was.some((key) => measure.clips[key] !== scene.clips[key])
}

/** The highest level the mix takes. */
const MAX_LEVEL = 3

/** A number of dB to one decimal, without a negative zero. */
function oneDecimal(n: number): number {
  return Math.round(n * 10) / 10 || 0
}

/**
 * The mix with the music and every effect moved by the same `db`: each level times the factor,
 * to a whole percent, 0% staying 0% and none above 300%.
 */
export function scaleMix(mix: SceneMix, db: number): SceneMix {
  const scale = (level: number) => scaleLevel(level, db)
  return {
    ...mix,
    ...(mix.music ? { music: { ...mix.music, level: scale(mix.music.level) } } : {}),
    effects: mix.effects.map((e) => ({ ...e, level: scale(e.level) })),
  }
}

/** What the panel offers to bring a scene within the target. */
export type Suggestion =
  | {
      kind: 'change'
      /** dB, one decimal; positive is louder. */
      db: number
      /** How many states were measured (the wording says "both", "every" or "it"). */
      states: number
      /** No single change fits every state: how far apart they are, and how far the best one leaves each outside the tolerance. */
      closest: { apart: number; leaving: number } | null
      /** A level would pass 300%: which sound, and how far from the target (dB) each state still is. */
      ceiling: { sound: string; still: number[] } | null
    }
  /** States on both sides of the target and the best change under 0.5 dB: nothing to press. */
  | { kind: 'none'; loud: string[]; quiet: string[] }

/**
 * The one change for the whole scene that comes closest to bringing every measured state within the
 * target, aimed at putting the states' middle on the target (§8.11). Null when there is nothing to
 * say: no target, nothing off, nothing measured, or the scene could not be measured.
 */
export function suggestChange(
  measure: SceneMeasure,
  target: LoudnessTarget | null,
  mix: SceneMix,
): Suggestion | null {
  if (!target || measure.error !== null) return null
  const read = measure.states.flatMap((s) =>
    s.lufs === null ? [] : [{ name: s.state ?? 'The scene', off: shownOff(s.lufs, target) }],
  )
  if (read.length === 0 || read.every((s) => Math.abs(s.off) <= target.tolerance)) return null
  const low = Math.min(...read.map((s) => s.off))
  const high = Math.max(...read.map((s) => s.off))
  let db = oneDecimal(-(low + high) / 2)
  const loud = read.filter((s) => s.off > target.tolerance).map((s) => s.name)
  const quiet = read.filter((s) => s.off < -target.tolerance).map((s) => s.name)
  if (Math.abs(db) < 0.5 && loud.length > 0 && quiet.length > 0)
    return { kind: 'none', loud, quiet }
  if (db === 0) return null
  const apart = high - low
  const closest =
    apart > 2 * target.tolerance
      ? { apart: oneDecimal(apart), leaving: oneDecimal(apart / 2 - target.tolerance) }
      : null
  const sounds = [
    ...(mix.music?.track ? [{ id: mix.music.track, level: mix.music.level }] : []),
    ...mix.effects.map((e) => ({ id: e.id, level: e.level })),
  ]
  const top = sounds.reduce((a, b) => (b.level > a.level ? b : a), { id: '', level: 0 })
  let ceiling: { sound: string; still: number[] } | null = null
  if (db > 0 && top.level > 0) {
    const room = Math.floor(20 * Math.log10(MAX_LEVEL / top.level) * 10) / 10
    if (room < db) {
      if (room < 0.1) return null
      db = room
      const still = read
        .filter((s) => s.off + db < -target.tolerance)
        .map((s) => oneDecimal(-(s.off + db)))
      // Within the tolerance after all: an ordinary change, with nothing left to explain.
      if (still.length > 0) ceiling = { sound: top.id, still }
    }
  }
  return { kind: 'change', db, states: read.length, closest, ceiling }
}

/** The measure with every figure moved by `db`; a state that reads nothing stays so. */
export function shiftStates(measure: SceneMeasure, db: number): SceneMeasure {
  return {
    ...measure,
    states: measure.states.map((s) => ({ ...s, lufs: s.lufs === null ? null : s.lufs + db })),
  }
}

/**
 * Which figures to show for a measure: the `measured` ones, the `expected` ones (the scene is
 * exactly the measured one moved by `moved.db`), or none that can be trusted (`changed`).
 */
export function expectedFigures(
  measure: SceneMeasure,
  moved: { db: number } | null | undefined,
  now: { entry: SceneMix | null; clips: Record<string, string> },
): 'measured' | 'expected' | 'changed' {
  if (!measureChanged(measure, now)) return 'measured'
  if (
    moved &&
    now.entry &&
    measureChanged({ ...measure, entry: movedEntry(measure.entry, moved.db, now.entry) }, now) ===
      false
  ) {
    return 'expected'
  }
  return 'changed'
}

/**
 * The measured entry moved by `db`, as the page has it: a scene with no entry or no music key
 * has the page fill in its track (`like`) at 100% before the move.
 */
export function movedEntry(entry: SceneMix | null, db: number, like: SceneMix): SceneMix {
  const moved = scaleMix(entry ?? { effects: [] }, db)
  // The press leaves a music with no track alone: it has no level to move.
  if (like.music && like.music.track === null && !entry?.music?.track)
    return { ...moved, music: like.music }
  return !moved.music && like.music
    ? { ...moved, music: { track: like.music.track, level: scaleLevel(1, db) } }
    : moved
}
