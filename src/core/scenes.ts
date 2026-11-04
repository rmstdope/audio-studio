import { z } from 'zod'
import { effectName, type EffectsSummary } from './effects'
import type { MusicListSummary } from './music'
import { problemsFrom, type Problem } from './project'

/** A name the game gives an id, a state or a trigger: lower-case words joined by `-`. */
const Slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and - only')

/** A list of slugs with none twice. */
const slugs = z
  .array(Slug)
  .default([])
  .refine((list) => new Set(list).size === list.length, { error: 'a name is used twice' })

/** A scene as the game declares it (§8.11): its states, the first being the default, and its triggers. */
export const SceneDeclarationSchema = z.object({
  id: Slug,
  name: z.string().min(1),
  states: slugs,
  triggers: slugs,
})

/** A scene of the game's declarations. */
export type SceneDeclaration = z.infer<typeof SceneDeclarationSchema>

/** A level: 0 to 3, 1 being the clip as made. */
const Level = z.number().min(0).max(3)

/** How an effect plays: round and round, at random, once, or on a trigger. */
export const PlaySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('loop') }),
  z.object({
    mode: z.literal('random'),
    everySeconds: z
      .tuple([z.number(), z.number()])
      .refine(([n, m]) => n > 0 && n <= m, { error: 'must be two numbers, 0 < first <= second' }),
  }),
  z.object({ mode: z.literal('once'), afterSeconds: z.number().min(0) }),
  z.object({ mode: z.literal('trigger'), trigger: Slug }),
])

/** How an effect plays. */
export type Play = z.infer<typeof PlaySchema>

/** One scene's entry in the mix (§8.11). */
export const SceneMixSchema = z.object({
  /** The music: a track id, or `null` for none. Absent: the scene's own track, at 1. */
  music: z.object({ track: Slug.nullable(), level: Level }).optional(),
  effects: z
    .array(
      z.object({
        id: Slug,
        play: PlaySchema,
        state: Slug.optional(),
        level: Level,
      }),
    )
    .default([]),
})

/** One scene's entry in the mix. */
export type SceneMix = z.infer<typeof SceneMixSchema>

/** What reading the game's declarations gave. */
export type SceneDeclarationsRead =
  { ok: true; scenes: SceneDeclaration[]; problems: Problem[] } | { ok: false; problems: Problem[] }

/**
 * The scenes of the game's declarations, one by one: an entry with a problem is left out and
 * reported with its place (`[2].states[0]`), and an id used twice leaves out both entries. A file
 * that is not a list is unreadable as a whole.
 */
export function readSceneDeclarations(json: unknown, file: string): SceneDeclarationsRead {
  if (!Array.isArray(json)) {
    return { ok: false, problems: [{ file, path: '', message: 'expected a list of scenes' }] }
  }
  const idOf = (item: unknown) => (item as { id?: unknown } | null)?.id
  const counts = new Map<string, number>()
  for (const item of json) {
    const id = idOf(item)
    if (typeof id === 'string') counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const scenes: SceneDeclaration[] = []
  const problems: Problem[] = []
  json.forEach((item: unknown, index) => {
    const parsed = SceneDeclarationSchema.safeParse(item)
    if (!parsed.success) {
      for (const problem of problemsFrom(file, parsed.error)) {
        problems.push({
          ...problem,
          path: `[${index}]${problem.path ? `.${problem.path}` : ''}`.replace('.[', '['),
        })
      }
      return
    }
    if (counts.get(parsed.data.id)! > 1) {
      problems.push({ file, path: `[${index}].id`, message: `"${parsed.data.id}" is used twice` })
      return
    }
    scenes.push(parsed.data)
  })
  problems.sort((a, b) => entryIndex(a.path) - entryIndex(b.path))
  return { ok: true, scenes, problems }
}

/** The entry number a problem's path starts with. */
function entryIndex(path: string): number {
  return Number(/^\[(\d+)\]/.exec(path)?.[1] ?? -1)
}

/** What reading an act's mix gave. */
export type SceneMixRead =
  | {
      ok: true
      /** The scene entries that can be used, by scene id. */
      scenes: Record<string, SceneMix>
      /** The scene ids whose entries have a problem: left out, and kept as they are on a save. */
      badIds: Set<string>
      problems: Problem[]
    }
  | { ok: false; problems: Problem[] }

/**
 * An act's mix, scene entry by scene entry: an entry with a problem is left out and reported with
 * its place (`scenes.act1-store.effects[0].level`). A file without a `scenes` object is unreadable.
 */
export function readSceneMix(json: unknown, file: string): SceneMixRead {
  const entries = (json as { scenes?: unknown } | null)?.scenes
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    return {
      ok: false,
      problems: [{ file, path: 'scenes', message: 'expected an object of scenes' }],
    }
  }
  const scenes: Record<string, SceneMix> = {}
  const badIds = new Set<string>()
  const problems: Problem[] = []
  for (const [id, entry] of Object.entries(entries)) {
    const parsed = SceneMixSchema.safeParse(entry)
    if (parsed.success) {
      scenes[id] = parsed.data
      continue
    }
    badIds.add(id)
    for (const problem of problemsFrom(file, parsed.error)) {
      problems.push({
        ...problem,
        path: `scenes.${id}${problem.path ? `.${problem.path}` : ''}`.replace('.[', '['),
      })
    }
  }
  return { ok: true, scenes, badIds, problems }
}

/** What the studio knows of an act's declarations file. */
export type DeclarationsState =
  | { status: 'missing' }
  | { status: 'invalid'; problems: Problem[] }
  | { status: 'ok'; scenes: SceneDeclaration[]; problems: Problem[] }

/** What the studio knows of an act's mix file: a missing file is an empty mix. */
export type MixState =
  { status: 'unreadable' } | { status: 'ok'; scenes: Record<string, SceneMix>; badIds: Set<string> }

/** An effect row of a scene, with what the game and the lock say about it. */
export interface SceneEffectRow {
  id: string
  name: string
  play: Play
  /** The state it plays in; null: always. */
  state: string | null
  level: number
  /** The game plays it round and round (the effects list says so). */
  loops: boolean
  /** The game no longer lists this effect. */
  goneEffect: boolean
  /** The scene no longer has this state. */
  goneState: boolean
  /** The scene no longer has this trigger. */
  goneTrigger: boolean
  /** No take is chosen: nothing plays for it. */
  silent: boolean
  /** A chosen take's clip is there to play. */
  playable: boolean
}

/** A scene's music. */
export interface SceneMusic {
  /** The track's id; null: no music. */
  track: string | null
  /** The track's title, else its id; null when there is no music. */
  name: string | null
  level: number
  /** What the track plays, a chosen take or the game's own file, is there. */
  playable: boolean
  /** The act's music list, readable, no longer has this track. */
  gone: boolean
}

/** A scene of an act as its page shows it. */
export interface SceneRow {
  id: string
  name: string
  states: string[]
  triggers: string[]
  music: SceneMusic
  effects: SceneEffectRow[]
  /** The scene's entry in the mix cannot be read: nothing of it is shown. */
  unreadable: boolean
  /** Things the game no longer has in this scene: each effect row with a gone mark, and the music. */
  gone: number
  /** Effects with no take chosen, not counting those gone. */
  silent: number
}

/** An act's scenes. */
export interface SceneAct {
  id: string
  title: string
  state: 'ok' | 'missing' | 'invalid'
  /** Whether the project names a command that refreshes the act's lists. */
  canRefresh: boolean
  /** The act's mix file, relative to the project root. */
  mixFile: string
  scenes: SceneRow[]
}

/** The Scenes workspace. */
export interface ScenesSummary {
  acts: SceneAct[]
}

/** An act with what was read of its two files. */
export interface SceneActInput {
  id: string
  title: string
  canRefresh: boolean
  mixFile: string
  declarations: DeclarationsState
  mix: MixState
}

const NO_MUSIC: SceneMusic = { track: null, name: null, level: 1, playable: false, gone: false }

/**
 * The Scenes pages from each act's declarations and mix, the effects and the acts' music lists.
 * Gone and silent are derived here on every read, never stored; what cannot be read is not gone.
 */
export function summarizeScenes(input: {
  acts: SceneActInput[]
  effects: EffectsSummary | null
  music: MusicListSummary[]
}): ScenesSummary {
  const { effects } = input
  const effectsKnown = effects?.status === 'ok' && effects.unreadable === 0
  const effectById = new Map(effects?.status === 'ok' ? effects.rows.map((r) => [r.id, r]) : [])
  return {
    acts: input.acts.map((act) => {
      const base = {
        id: act.id,
        title: act.title,
        canRefresh: act.canRefresh,
        mixFile: act.mixFile,
      }
      if (act.declarations.status !== 'ok') {
        return { ...base, state: act.declarations.status, scenes: [] }
      }
      const list = input.music.find((m) => m.kind === 'act' && m.id === act.id)
      const scenes = act.declarations.scenes.map((declared) =>
        sceneRow(declared, act.mix, { effectById, effectsKnown, list }),
      )
      return { ...base, state: 'ok' as const, scenes }
    }),
  }
}

/** What a scene is read against. */
interface Known {
  effectById: Map<string, EffectsSummary['rows'][number]>
  /** The effects list is read in full, so an id it lacks is gone. */
  effectsKnown: boolean
  /** The act's music list. */
  list: MusicListSummary | undefined
}

/** One scene from its declaration and its entry in the mix. */
function sceneRow(declared: SceneDeclaration, mix: MixState, known: Known): SceneRow {
  const { id, name, states, triggers } = declared
  const row = { id, name, states, triggers }
  const unreadable = mix.status === 'unreadable' || (mix.status === 'ok' && mix.badIds.has(id))
  if (unreadable) {
    return { ...row, music: NO_MUSIC, effects: [], unreadable: true, gone: 0, silent: 0 }
  }
  const entry = mix.status === 'ok' ? mix.scenes[id] : undefined
  const music = sceneMusic(id, entry?.music, known)
  const effects = (entry?.effects ?? []).map((e): SceneEffectRow => {
    const found = known.effectById.get(e.id)
    const goneEffect = known.effectsKnown && !found
    const silent = Boolean(found) && found!.current.kind === 'nothing'
    return {
      id: e.id,
      name: found?.name ?? effectName(e.id),
      play: e.play,
      state: e.state ?? null,
      level: e.level,
      loops: found?.loops ?? false,
      goneEffect,
      goneState: e.state !== undefined && !states.includes(e.state),
      goneTrigger: e.play.mode === 'trigger' && !triggers.includes(e.play.trigger),
      silent,
      playable: found?.current.kind === 'take' && found.current.exists,
    }
  })
  const gone =
    effects.filter((e) => e.goneEffect || e.goneState || e.goneTrigger).length +
    (music.gone ? 1 : 0)
  const silent = effects.filter((e) => e.silent).length
  return { ...row, music, effects, unreadable: false, gone, silent }
}

/** A scene's music: what the mix says, else (no `music`) the scene's own track at 1 if the act has it. */
function sceneMusic(sceneId: string, chosen: SceneMix['music'], { list }: Known): SceneMusic {
  const track = chosen ? chosen.track : list?.tracks.some((t) => t.id === sceneId) ? sceneId : null
  if (track === null) return NO_MUSIC
  const found = list?.tracks.find((t) => t.id === track)
  return {
    track,
    name: found?.title ?? track,
    level: chosen?.level ?? 1,
    playable:
      (found?.current.kind === 'take' || found?.current.kind === 'game') && found.current.exists,
    // Only the act's own list is looked in: today no shared loops are listed (§8.11).
    gone: list?.state === 'ok' && !found,
  }
}
