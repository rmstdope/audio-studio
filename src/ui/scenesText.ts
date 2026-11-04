import type { Play, SceneRow } from '../core/scenes'

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
 * with no take chosen, each counted in red; else how many effects it has.
 */
export function listCount(scene: SceneRow): { text: string; red: boolean } {
  if (scene.unreadable) return { text: 'unreadable', red: true }
  if (scene.gone > 0) return { text: `${scene.gone} gone`, red: true }
  if (scene.silent > 0) return { text: `${scene.silent} silent`, red: true }
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
