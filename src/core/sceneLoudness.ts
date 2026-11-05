import { z } from 'zod'
import { sameMix } from './sceneEdit'
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

/** A state's chip: on target, or how far off, one decimal. Null: nothing to say. */
export function chipFor(
  lufs: number | null,
  target: LoudnessTarget | null,
): { kind: 'on' | 'quiet' | 'loud'; text: string } | null {
  if (lufs === null || !target) return null
  const off = lufs - target.target
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
