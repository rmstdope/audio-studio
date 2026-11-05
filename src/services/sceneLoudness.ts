import {
  planStateMix,
  sceneStateNames,
  statesPlaying,
  withoutName,
  WINDOW_SECONDS,
  type MixPart,
  type PlanEffect,
  type PlanMusic,
  type SceneMeasure,
  type StateLoudness,
} from '../core/sceneLoudness'
import {
  clipsOf,
  type SceneAct,
  type SceneEffectChoice,
  type SceneMix,
  type SceneRow,
} from '../core/scenes'
import { ffmpegSceneAudio } from './sceneAudio'
import { keepMeasure, measuresBroken } from './sceneMeasures'
import { dirname } from 'node:path'
import { scenesLockFile } from '../core/project'
import { effectCurrentFile, loadProject, musicCurrentFile } from './workspace'

/** One clip in the minute that is measured, with the file it is read from. */
export type RenderPart = MixPart & { file: string }

/** What measuring needs of the audio: how long a clip is, and how loud a minute of them is. */
export interface SceneAudio {
  /** A clip's length in seconds. */
  seconds(file: string): Promise<number>
  /** The integrated loudness (LUFS) of `parts` mixed over `windowSeconds`; null when nothing sounds. */
  loudness(parts: RenderPart[], windowSeconds: number): Promise<number | null>
}

/** Where the clips of the game's sounds are. */
export interface SceneFiles {
  /** The file an effect plays now; null when there is none. */
  effect(id: string): Promise<string | null>
  /** The file a track plays now; null when there is none. */
  music(id: string): Promise<string | null>
}

/** The open scene as the page has it, unsaved changes and all. */
export interface OpenScene {
  scene: string
  entry: SceneMix
}

/** Why a sound is left out of a measure: the words after "glass-clink, ". */
const NO_TAKE = 'which has no take chosen'
const NO_FILE = 'whose file is not there'

/** What measuring a scene needs besides the scene. */
interface Around {
  act: SceneAct
  choices: Map<string, SceneEffectChoice>
  audio: SceneAudio
  files: SceneFiles
  now: () => Date
  /** What is read already, by id, so a clip is found and measured for its length once. */
  found: {
    effect: Map<string, string | null>
    music: Map<string, string | null>
    seconds: Map<string, number>
  }
}

/** A file once: asks `find` the first time. */
async function once<T>(cache: Map<string, T>, id: string, find: () => Promise<T>): Promise<T> {
  if (!cache.has(id)) cache.set(id, await find())
  return cache.get(id)!
}

/** One scene measured: a figure for each of its states, from the entry as it is (or is on the page). */
async function measureScene(
  scene: SceneRow,
  entry: SceneMix | null,
  around: Around,
): Promise<SceneMeasure> {
  const { act, choices, audio, files, found } = around
  const without: string[] = []
  const left = (name: string, why: string) => {
    const phrase = `${name}, ${why}`
    if (!without.includes(phrase)) without.push(phrase)
  }
  const chosen = entry?.music ?? (scene.music.track ? { track: scene.music.track, level: 1 } : null)
  const paths = new Map<string, string>()
  const stateNames = sceneStateNames(scene)
  // Effects with no clip that the minute would play, by id: a row for each state adds to one note.
  const silent = new Map<string, { states: Set<string | null>; why: string }>()

  let music: PlanMusic | null = null
  const track = act.tracks.find((t) => t.id === chosen?.track)
  if (chosen?.track && track) {
    const file = track.playable
      ? await once(found.music, track.id, () => files.music(track.id))
      : null
    if (file) paths.set(`music:${track.id}`, file)
    else left(track.title, track.problem?.kind === 'nothing' ? NO_TAKE : NO_FILE)
    music = { track: track.id, level: chosen.level, missing: !file }
  }

  const effects: PlanEffect[] = []
  for (const row of entry?.effects ?? []) {
    const choice = choices.get(row.id)
    if (!choice) continue
    const file = choice.playable
      ? await once(found.effect, row.id, () => files.effect(row.id))
      : null
    if (!file) {
      // Named only if the measured minute would have played it, and in which states.
      const playing = statesPlaying({ play: row.play, state: row.state ?? null }, stateNames)
      if (playing.length > 0) {
        const soFar = silent.get(row.id) ?? { states: new Set<string | null>(), why: '' }
        playing.forEach((s) => soFar.states.add(s))
        soFar.why = choice.silent ? NO_TAKE : NO_FILE
        silent.set(row.id, soFar)
      }
    } else {
      paths.set(`effect:${row.id}`, file)
    }
    effects.push({
      id: row.id,
      play: row.play,
      state: row.state ?? null,
      level: row.level,
      seconds: file ? await once(found.seconds, file, () => audio.seconds(file)) : null,
    })
  }

  for (const [id, { states, why }] of silent) {
    left(
      withoutName(
        id,
        stateNames.filter((s) => states.has(s)),
        stateNames,
      ),
      why,
    )
  }

  const states: StateLoudness[] = []
  for (const state of stateNames) {
    const parts = planStateMix({ music, effects, state }).map((part): RenderPart => ({
      ...part,
      file: paths.get(`${part.source.kind}:${part.source.id}`)!,
    }))
    states.push({
      state,
      lufs: parts.length === 0 ? null : await audio.loudness(parts, WINDOW_SECONDS),
    })
  }
  const clips = clipsOf(
    chosen?.track ?? null,
    (entry?.effects ?? []).map((e) => e.id),
    act.tracks,
    [...choices.values()],
  )
  return {
    measuredAt: around.now().toISOString(),
    entry,
    clips,
    states,
    without,
    error: null,
  }
}

/**
 * Measures every readable scene of an act, one after another (§8.11): the open scene from the page
 * (`open`), the others as saved. Each measure is handed to `keep` as soon as it is made, so what
 * was done survives a stop; a scene that cannot be measured is kept with its reason and the rest
 * go on. Gives how many were measured and how many were not.
 */
export async function measureScenes(input: {
  act: SceneAct
  effects: SceneEffectChoice[]
  open: OpenScene | null
  audio: SceneAudio
  files: SceneFiles
  now: () => Date
  keep: (sceneId: string, measure: SceneMeasure, draft: boolean) => Promise<void>
  progress: (done: number, total: number) => void
}): Promise<{ measured: number; failed: number }> {
  const { act } = input
  const around: Around = {
    act,
    choices: new Map(input.effects.map((c) => [c.id, c])),
    audio: input.audio,
    files: input.files,
    now: input.now,
    found: { effect: new Map(), music: new Map(), seconds: new Map() },
  }
  const scenes = act.scenes.filter((s) => !s.unreadable)
  let measured = 0
  let failed = 0
  input.progress(0, scenes.length)
  for (const scene of scenes) {
    const draft = input.open?.scene === scene.id
    const entry = draft ? input.open!.entry : scene.entry
    let measure: SceneMeasure
    try {
      measure = await measureScene(scene, entry, around)
      measured++
    } catch (error) {
      failed++
      measure = {
        measuredAt: input.now().toISOString(),
        entry,
        clips: {},
        states: sceneStateNames(scene).map((state) => ({ state, lufs: null })),
        without: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
    await input.keep(scene.id, measure, draft)
    input.progress(measured + failed, scenes.length)
  }
  return { measured, failed }
}

/** The acts being measured, by project and act: how far each has got. */
const running = new Map<string, { done: number; total: number }>()

const keyOf = (projectFile: string, part: string) => `${projectFile}\0${part}`

/** What is being measured now in a project, by act: scenes done out of all. */
export function making(projectFile: string): Record<string, { done: number; total: number }> {
  const prefix = `${projectFile}\0`
  return Object.fromEntries(
    [...running]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, v]) => [key.slice(prefix.length), v]),
  )
}

/** What starting a measure answered: it is under way (`done` settles when it ends), or why not. */
export type MeasureStart =
  | { ok: true; done: Promise<void> }
  | { ok: false; kind: 'unknown' | 'running' | 'unreadable'; message: string }

/**
 * Starts measuring every scene of an act in the background and returns at once. A second start for
 * the act while it is being measured is refused. `deps` are for tests: the real audio is ffmpeg's.
 */
export async function startMeasure(
  projectFile: string,
  part: string,
  open: OpenScene | null,
  deps: { audio?: SceneAudio; files?: SceneFiles } = {},
): Promise<MeasureStart> {
  const key = keyOf(projectFile, part)
  if (running.has(key)) {
    return { ok: false, kind: 'running', message: `${part} is being measured already` }
  }
  const loaded = await loadProject(projectFile)
  const act = loaded.ok ? loaded.summary.scenes?.acts.find((a) => a.id === part) : undefined
  if (!loaded.ok || !act) return { ok: false, kind: 'unknown', message: `${part} has no scenes` }
  if (running.has(key)) {
    return { ok: false, kind: 'running', message: `${part} is being measured already` }
  }
  if (await measuresBroken(dirname(projectFile), part)) {
    return {
      ok: false,
      kind: 'unreadable',
      message: `${scenesLockFile(part)} cannot be read; fix or delete it, and measure again`,
    }
  }
  const progress = { done: 0, total: act.scenes.filter((s) => !s.unreadable).length }
  running.set(key, progress)
  const files: SceneFiles = deps.files ?? {
    effect: (id) => effectCurrentFile(projectFile, id),
    music: (id) => musicCurrentFile(projectFile, id),
  }
  const done = measureScenes({
    act,
    effects: loaded.summary.scenes!.effects,
    open: open && act.scenes.some((s) => s.id === open.scene) ? open : null,
    audio: deps.audio ?? ffmpegSceneAudio(dirname(projectFile)),
    files,
    now: () => new Date(),
    keep: (id, measure, draft) => keepMeasure(projectFile, part, id, measure, draft),
    progress: (d, total) => {
      progress.done = d
      progress.total = total
    },
  })
    .then(() => {})
    .catch((error) => console.error('Content Studio: measuring the scenes stopped:', error))
    .finally(() => void running.delete(key))
  return { ok: true, done }
}
