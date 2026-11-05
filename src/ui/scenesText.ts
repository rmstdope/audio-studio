import { sceneVerdict, type LoudnessTarget } from '../core/sceneLoudness'
import type { Play, SceneAct, SceneRow, ScenesSummary, TrackProblem } from '../core/scenes'
import { fileName } from './musicPlays'
import type { ScenesRoute } from './route'

/** How an effect plays, as the Scenes page words it. */
export function howItPlays(play: Play): string {
  switch (play.mode) {
    case 'loop':
      return 'Round and round'
    case 'random':
      return `Now and then, every ${play.everySeconds[0]}–${play.everySeconds[1]} s`
    case 'once':
      return `Once, ${play.afterSeconds} s after entering`
    case 'trigger':
      return `On a trigger: ${play.trigger}`
  }
}

/** A level (1 is the clip as made) as a whole percent: `0.6` is "60%". */
export function levelText(level: number): string {
  return `${Math.round(level * 100)}%`
}

/**
 * What a scene's row in the list says at the right: what the game no longer has, else the effects
 * with no take chosen, each counted in red; else, when the last measure put it off the target,
 * which way (amber); else how many effects it has.
 */
export function listCount(
  scene: SceneRow,
  target: LoudnessTarget | null = null,
): { text: string; red: boolean; warn?: true } {
  if (scene.unreadable) return { text: 'unreadable', red: true }
  if (scene.gone > 0) return { text: `${scene.gone} gone`, red: true }
  if (scene.silent > 0) return { text: `${scene.silent} silent`, red: true }
  // Off the target, from the last measure of the saved scene (else of the unsaved one), stays until measured again.
  const verdict = target && sceneVerdict(scene.loudness.saved ?? scene.loudness.draft, target)
  if (verdict) return { text: verdict, red: false, warn: true }
  const n = scene.effects.length
  return { text: n === 0 ? 'none' : n === 1 ? '1 effect' : `${n} effects`, red: false }
}

/** The line under a scene's name: its states and its triggers, or that it has none. */
export function statesLine(scene: Pick<SceneRow, 'states' | 'triggers'>): string {
  const { states, triggers } = scene
  if (states.length === 0 && triggers.length === 0) return 'No states · No triggers'
  const states_ = `States: ${states.length ? states.join(', ') : 'none'}`
  return `${states_} · Triggers: ${triggers.length ? triggers.join(', ') : 'none'}`
}

/** The act a Scenes route shows: the one it names, else the first. Undefined without acts. */
export function currentSceneAct(scenes: ScenesSummary, route: ScenesRoute): SceneAct | undefined {
  return (route.page === 'act' && scenes.acts.find((a) => a.id === route.part)) || scenes.acts[0]
}

/** The scene a Scenes route opens in `act`: the one it names, else the first. */
export function currentScene(act: SceneAct, route: ScenesRoute): SceneRow | undefined {
  return (route.page === 'act' && act.scenes.find((s) => s.id === route.scene)) || act.scenes[0]
}

/** The chip beside a scene's track that plays nothing: its words, its hover sentence and its colour. */
export function trackProblemChip(
  title: string,
  problem: TrackProblem,
): { text: string; title: string | undefined; tone: 'danger' | 'warn' } {
  switch (problem.kind) {
    case 'take':
      return {
        text: 'file not there',
        title: `Take ${problem.take} of ${title} is not there.`,
        tone: 'danger',
      }
    case 'file':
      return {
        text: 'file not there',
        title: `The game's file ${fileName(problem.file)} is not there.`,
        tone: 'danger',
      }
    case 'nothing':
      return { text: 'no take chosen', title: undefined, tone: 'warn' }
  }
}

/** The two-digit clock time of a date, as "14:02". */
function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** The month names the line under the Loudness table uses for an older day. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** When a scene was measured: "Measured today 14:02", "Measured yesterday 16:40", else "Measured 3 Nov 16:40". */
export function measuredLine(measuredAt: string, now: Date): string {
  const at = new Date(measuredAt)
  const ago = Math.round(
    (new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000,
  )
  if (ago === 0) return `Measured today ${clock(at)}`
  if (ago === 1) return `Measured yesterday ${clock(at)}`
  return `Measured ${at.getDate()} ${MONTHS[at.getMonth()]} ${clock(at)}`
}
