import type { Play, SceneEffectChoice, SceneMix, SceneRow } from './scenes'

/** The longest wait or delay the Scenes page accepts, in seconds. */
export const MAX_SECONDS = 600

/** How an effect plays. */
export type PlayMode = Play['mode']

/**
 * One effect row as the page edits it. The seconds are kept as typed, for every mode, so
 * switching How it plays back and forth keeps what was typed on the row.
 */
export interface EffectDraft {
  id: string
  mode: PlayMode
  /** Now and then: the first and second number, as typed. */
  every: [string, string]
  /** Once: the seconds after entering, as typed. */
  after: string
  /** On a trigger: the trigger's name. */
  trigger: string | null
  /** The state it plays in; null: always. */
  state: string | null
  level: number
}

/** A scene as the page edits it, saved or not. */
export interface SceneDraft {
  music: { track: string | null; level: number }
  effects: EffectDraft[]
}

/** The seconds a new Now and then row starts with. */
const DEFAULT_EVERY: [string, string] = ['10', '20']

/** The seconds a new Once row starts with. */
const DEFAULT_AFTER = '0'

/** The page's draft of a saved scene: what the row shows, as editable text. */
export function draftOf(scene: SceneRow): SceneDraft {
  return {
    music: { track: scene.music.track, level: scene.music.level },
    effects: scene.effects.map((e) => ({
      id: e.id,
      mode: e.play.mode,
      every:
        e.play.mode === 'random'
          ? [String(e.play.everySeconds[0]), String(e.play.everySeconds[1])]
          : [...DEFAULT_EVERY],
      after: e.play.mode === 'once' ? String(e.play.afterSeconds) : DEFAULT_AFTER,
      trigger: e.play.mode === 'trigger' ? e.play.trigger : null,
      state: e.state,
      level: e.level,
    })),
  }
}

/** The draft with one of the game's effects added: Round and round for a loop, else Now and then. */
export function addEffect(draft: SceneDraft, choice: SceneEffectChoice): SceneDraft {
  const added: EffectDraft = {
    id: choice.id,
    mode: choice.loops ? 'loop' : 'random',
    every: [...DEFAULT_EVERY],
    after: DEFAULT_AFTER,
    trigger: null,
    state: null,
    level: 1,
  }
  return { ...draft, effects: [...draft.effects, added] }
}

/** The row set to another way of playing; On a trigger starts at the scene's first trigger. */
export function switchMode(effect: EffectDraft, mode: PlayMode, triggers: string[]): EffectDraft {
  return {
    ...effect,
    mode,
    trigger: mode === 'trigger' ? (effect.trigger ?? triggers[0] ?? null) : effect.trigger,
  }
}

/** A box of seconds read as a number, or why it cannot be one. */
function seconds(text: string): { ok: true; value: number } | { ok: false; line: string } {
  const value = text.trim() === '' ? NaN : Number(text)
  if (!Number.isFinite(value) || value < 0) return { ok: false, line: 'Type a number of seconds.' }
  if (value > MAX_SECONDS) return { ok: false, line: `At most ${MAX_SECONDS} seconds.` }
  return { ok: true, value }
}

/** Which boxes of a row are red, and the red lines beneath them (each said once). */
export interface RowProblems {
  first: boolean
  second: boolean
  after: boolean
  lines: string[]
}

/** What is wrong with the seconds of a row, for the mode it is in. */
export function rowProblems(effect: EffectDraft): RowProblems {
  const none: RowProblems = { first: false, second: false, after: false, lines: [] }
  if (effect.mode === 'once') {
    const after = seconds(effect.after)
    return after.ok ? none : { ...none, after: true, lines: [after.line] }
  }
  if (effect.mode !== 'random') return none
  const a = seconds(effect.every[0])
  const b = seconds(effect.every[1])
  const lines = [a, b].flatMap((r) => (r.ok ? [] : [r.line]))
  if (a.ok && b.ok && !(a.value < b.value)) {
    return {
      ...none,
      first: true,
      second: true,
      lines: ['The first number must be smaller than the second.'],
    }
  }
  return { ...none, first: !a.ok, second: !b.ok, lines: [...new Set(lines)] }
}

/** How many rows of the draft have a red box. */
export function redRows(draft: SceneDraft): number {
  return draft.effects.filter((e) => rowProblems(e).lines.length > 0).length
}

/** The heading while rows are red: "Fix the 1 red row to save". */
export function fixHeading(count: number): string {
  return `Fix the ${count} red ${count === 1 ? 'row' : 'rows'} to save`
}

/** The mix entry of a draft with no red rows. */
export function toMix(draft: SceneDraft): SceneMix {
  return {
    music: { track: draft.music.track, level: draft.music.level },
    effects: draft.effects.map((e) => {
      const play: Play =
        e.mode === 'loop'
          ? { mode: 'loop' }
          : e.mode === 'random'
            ? { mode: 'random', everySeconds: [Number(e.every[0]), Number(e.every[1])] }
            : e.mode === 'once'
              ? { mode: 'once', afterSeconds: Number(e.after) }
              : { mode: 'trigger', trigger: e.trigger ?? '' }
      return { id: e.id, play, ...(e.state === null ? {} : { state: e.state }), level: e.level }
    }),
  }
}

/** A mix entry with its keys in one order, to compare. */
function normal(mix: SceneMix | null): unknown {
  if (!mix) return null
  return {
    music: mix.music && { track: mix.music.track, level: mix.music.level },
    effects: mix.effects.map((e) => ({
      id: e.id,
      play: e.play,
      state: e.state ?? null,
      level: e.level,
    })),
  }
}

/** Whether two entries say the same (null: no entry at all). Key order does not matter. */
export function sameMix(a: SceneMix | null, b: SceneMix | null): boolean {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b))
}

/** Whether two drafts are the same, typed text included. */
export function sameDraft(a: SceneDraft, b: SceneDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
