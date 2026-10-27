import { hasFinalStep, modelForStage, readsCues } from './elevenSpeech'
import {
  clipInputs,
  cueInputs,
  sceneCueFor,
  fingerprint,
  fingerprintMatches,
  staleReasons,
  type StaleReason,
} from './fingerprint'
import { sameModel } from './retirement'
import type { Project } from './project'
import { openingFor, parseCued, type InsideCue } from './cued'
import {
  cueFor,
  sceneKey,
  sceneOfKey,
  type Cast,
  type Cues,
  type Line,
  type Lock,
  type Manifest,
} from './resources'

/**
 * Where a line's clip stands:
 * - `ok`: the clip matches the line and its settings
 * - `weak`: it matches, but its best take was heard below the quality bar (and the user has not
 *   accepted it as it is)
 * - `stale`: it was made from other inputs (`reasons` says which)
 * - `missing`: there is no clip
 * - `untracked`: there is a clip, but nothing says what it was made from (made before the studio)
 * - `uncast`: the speaker has no voice, so nothing can be recorded
 * - `untranslated`: the line is in the source language but has no text in this one
 */
export type LineStatus =
  'ok' | 'weak' | 'stale' | 'missing' | 'untracked' | 'uncast' | 'untranslated'

/** Every status, in the order the UI lists them. */
export const LINE_STATUSES: LineStatus[] = [
  'ok',
  'weak',
  'stale',
  'missing',
  'untracked',
  'uncast',
  'untranslated',
]

/** One line of a part with the state of its clip. */
export interface LineState {
  key: string
  speaker: string
  text: string
  /**
   * The source language's text of the line, when this is another language and the source has the
   * line; null otherwise.
   */
  english: string | null
  /** The cue the line is (or would be) delivered with. */
  cue: string
  /**
   * Where that cue comes from: the line's own cue in this language, the source language's cue for
   * the line (another language follows it), its scene's cue (written in this language, or the
   * source language's), or its character's style.
   */
  cueFrom: 'own' | 'source' | 'scene' | 'sceneSource' | 'style'
  /** The cues placed inside the line's words, as they are recorded. */
  inside: InsideCue[]
  /** The line's previous cued text when its words changed and its cues inside were set aside. */
  insideStale: string | null
  /** The cues inside the source language's line, shown with it; not recorded in this language. */
  sourceInside: InsideCue[]
  /** The scene the line is in (the source language's name for it when it has one), or null. */
  scene: string | null
  /**
   * Whether the line takes its scene's cue when the scene has one: its speaker is one the project
   * names and it has no cue of its own.
   */
  followsScene: boolean
  /** The source language's own cue for the line, when this is another language and it has one. */
  sourceCue: string | null
  /** Whether the clip was made with the final model (when it differs from the draft one). */
  final: boolean
  /** Whether the line's draft model reads its cues as directions; one that would speak them is sent none. */
  readsCues: boolean
  status: LineStatus
  reasons: StaleReason[]
  heard: number | null
  /** Whether the user accepted the clip though it was heard below the bar. */
  accepted: boolean
  duration: number | null
  file: string | null
}

/** A clip in the manifest whose line is no longer in the dialog. */
export interface Orphan {
  key: string
  speaker: string | null
  file: string
}

/** A scene of a part's dialog and its cue. */
export interface SceneState {
  name: string
  /** The cue the scene's following lines are spoken with, or null when it has none. */
  cue: string | null
  /** Where it comes from: written in this language, or the source language's; null without one. */
  cueFrom: 'own' | 'source' | null
  /** The source language's own cue for the scene, when this is another language and it has one. */
  sourceCue: string | null
  /** Lines in the scene, in all its runs. */
  lines: number
  /** Lines that follow the scene's cue (when it has one): recordable ones of the named speakers. */
  following: number
  /** Of those, the lines with a clip made from today's inputs: what a change newly marks stale. */
  recordedFollowing: number
  /** The first line that follows the scene's cue, which Hear it says; null when none does. */
  firstFollowing: string | null
}

/** The state of every clip in a part. */
export interface PartState {
  lines: LineState[]
  /** The scenes the dialog names, in the order they first appear. */
  scenes: SceneState[]
  orphans: Orphan[]
  /**
   * Cue keys whose line is no longer in the dialog (its wording changed, so its key did), and the
   * `scene:` keys of scenes that are no longer in it.
   */
  orphanCues: { key: string; cue: string }[]
  counts: Record<LineStatus, number>
}

/** What the planner reads about a part. */
export interface PlanInput {
  lines: Line[]
  /**
   * The source language's dialog, when `lines` is another language's: lines are matched by key, a
   * source line missing from `lines` (or blank there) is listed as untranslated.
   */
  source?: Line[]
  cast: Cast
  /**
   * The cues the lines are spoken with. In a language besides the source, the source's cues under
   * the language's own, so a line follows the source's cue until it has one of its own.
   */
  cues: Cues
  /** The cues written in this language itself; absent: all of `cues`. */
  ownCues?: Cues
  /** The source language's cues, in a language besides the source; absent: none. */
  sourceCues?: Cues
  /** The cues inside the source language's lines, by key; absent: none. */
  sourceInside?: Record<string, InsideCue[]>
  lock: Lock
  manifest: Manifest
  /** File names present in the part's clips folder. */
  files: Set<string>
  narration: Project['narration']
  /**
   * The dialog says nothing about which lines left it (the file cannot be read, or is gone while
   * recordings exist): no clip or cue is listed as an orphan.
   */
  held?: boolean
}

/** The state of every line's clip in a part, its orphaned clips and cues, and counts per status. */
export function planPart(input: PlanInput): PartState {
  const { cast, cues, lock, manifest, files, narration } = input
  const own = input.ownCues ?? cues
  const lines = withSource(input.lines, input.source)
  const counts = Object.fromEntries(LINE_STATUSES.map((s) => [s, 0])) as Record<LineStatus, number>

  const states = lines.map(({ line, english }): LineState => {
    const scene = line.scene ?? null
    const followsScene =
      scene !== null &&
      narration.sceneCueSpeakers.includes(line.speaker) &&
      openingFor(cues, line.key, line.text) === undefined
    if (line.text.trim() === '' && english !== null) {
      counts.untranslated++
      return {
        key: line.key,
        speaker: line.speaker,
        text: '',
        english,
        cue: '',
        cueFrom: 'style',
        scene,
        followsScene,
        sourceCue: null,
        inside: [],
        insideStale: null,
        sourceInside: [],
        final: false,
        readsCues: true,
        status: 'untranslated',
        reasons: [],
        heard: null,
        accepted: false,
        duration: null,
        file: null,
      }
    }
    const character = cast.speakers[line.speaker]
    const inputs = clipInputs(line, character, cues, cast.pronounce, narration)
    const clip = manifest[line.key]
    const file = clip && files.has(clip.file) ? clip.file : null
    const entry = lock[line.key]
    // A clip made with the final model is up to date too: draft plans leave it alone. The stages
    // are the voice's provider's.
    const voice = character?.voice ?? ''
    const draft = modelForStage(narration, voice, 'draft')
    const finalModel = modelForStage(narration, voice, 'final')
    const finalInputs =
      finalModel !== draft
        ? clipInputs(line, character, cues, cast.pronounce, narration, finalModel)
        : null
    // A voice whose own provider's stages are one, while the project has a final step (the
    // other provider's stages differ): an up-to-date clip is as final as it gets, so a final
    // recording leaves it alone.
    const noFinalStep = finalModel === draft && hasFinalStep(narration)
    const final = Boolean(
      entry &&
      file &&
      (finalInputs
        ? fingerprintMatches(entry, finalInputs)
        : noFinalStep && inputs && fingerprintMatches(entry, inputs)),
    )
    let status: LineStatus
    let reasons: StaleReason[] = []
    if (!inputs) status = 'uncast'
    else if (!file) status = 'missing'
    else if (!entry) status = 'untracked'
    else if (!final && !fingerprintMatches(entry, inputs)) {
      status = 'stale'
      // Made with the final model: stale for what changed besides the model it may be made with.
      reasons = staleReasons(
        entry,
        finalInputs && sameModel(entry.model, finalModel) ? finalInputs : inputs,
      )
    } else if (
      entry.heard !== undefined &&
      entry.heard < narration.quality.minHeard &&
      !entry.accepted
    )
      status = 'weak'
    else status = 'ok'
    counts[status]++
    return {
      key: line.key,
      speaker: line.speaker,
      text: line.text,
      english,
      // What the line is delivered with, shown whatever model speaks it (one may be sent none).
      ...cueInputs(line, character ?? {}, cues, narration),
      readsCues: readsCues(draft),
      insideStale: parseCued(cueFor(own, line.key) ?? '', line.text).stale,
      sourceInside: Object.hasOwn(input.sourceInside ?? {}, line.key)
        ? input.sourceInside![line.key]!
        : [],
      scene,
      followsScene,
      sourceCue: (input.sourceCues && cueFor(input.sourceCues, line.key)) ?? null,
      cueFrom: cueFrom(line, cues, own, narration),
      final,
      status,
      reasons,
      heard: file ? (entry?.heard ?? null) : null,
      accepted: status === 'ok' && Boolean(entry?.accepted),
      duration: file ? (clip?.duration ?? null) : null,
      file,
    }
  })

  const keys = new Set(lines.map(({ line }) => line.key))
  const scenes = sceneStates(states, cues, own, input.sourceCues)
  const sceneNames = new Set(scenes.map((scene) => scene.name))
  const orphans = Object.entries(manifest)
    .filter(([key]) => !input.held && !keys.has(key))
    .map(([key, clip]) => ({ key, speaker: clip.speaker ?? null, file: clip.file }))
    .sort((a, b) => a.key.localeCompare(b.key))
  const orphanCues = Object.entries(own)
    .filter(([key]) => {
      const scene = sceneOfKey(key)
      return !input.held && !(scene === null ? keys.has(key) : sceneNames.has(scene))
    })
    .map(([key, cue]) => ({ key, cue }))

  return { lines: states, scenes, orphans, orphanCues, counts }
}

/** Where a line's cue comes from: its own, its scene's (own or the source language's), or its style. */
function cueFrom(
  line: Line,
  cues: Cues,
  own: Cues,
  narration: Project['narration'],
): LineState['cueFrom'] {
  if (openingFor(own, line.key, line.text) !== undefined) return 'own'
  if (openingFor(cues, line.key, line.text) !== undefined) return 'source'
  if (sceneCueFor(line, cues, narration) === undefined) return 'style'
  return cueFor(own, sceneKey(line.scene!)) !== undefined ? 'scene' : 'sceneSource'
}

/** The part's scenes, in the order they first appear, with their cue and who follows it. */
function sceneStates(
  states: LineState[],
  cues: Cues,
  own: Cues,
  sourceCues: Cues | undefined,
): SceneState[] {
  const scenes = new Map<string, SceneState>()
  for (const line of states) {
    if (line.scene === null) continue
    const key = sceneKey(line.scene)
    const cue = cueFor(cues, key) ?? null
    const scene = scenes.get(line.scene) ?? {
      name: line.scene,
      cue,
      cueFrom: cue === null ? null : cueFor(own, key) !== undefined ? 'own' : 'source',
      sourceCue: (sourceCues && cueFor(sourceCues, key)) ?? null,
      lines: 0,
      following: 0,
      recordedFollowing: 0,
      firstFollowing: null,
    }
    scene.lines++
    if (line.followsScene && line.status !== 'untranslated') {
      scene.following++
      if (line.status === 'ok' || line.status === 'weak') {
        scene.recordedFollowing++
      }
      scene.firstFollowing ??= line.key
    }
    scenes.set(line.scene, scene)
  }
  return [...scenes.values()]
}

/**
 * A language's lines with the scene the source language gives them, the scene every cue rule reads
 * (a line the source does not have keeps its own).
 */
export function withSourceScenes(lines: Line[], source: Line[] | undefined): Line[] {
  if (!source) return lines
  const scenes = new Map(source.map((line) => [line.key, line.scene]))
  return lines.map((line) => {
    const scene = scenes.get(line.key) ?? line.scene
    return scene === undefined ? line : { ...line, scene }
  })
}

/**
 * The lines of a part in a language as they are planned: with a source dialog, the source's lines
 * in its order (an untranslated one with empty text), then the lines only this language has.
 */
function withSource(
  lines: Line[],
  source: Line[] | undefined,
): { line: Line; english: string | null }[] {
  if (!source) return lines.map((line) => ({ line, english: null }))
  const own = new Map(lines.map((line) => [line.key, line]))
  const inSource = new Set(source.map((line) => line.key))
  return [
    ...source
      .filter((line) => line.text.trim() !== '' || own.has(line.key))
      .map((line) => {
        const translated = own.get(line.key)
        // The source's scene names the scene, so both languages share its cue's identity.
        const scene = line.scene ?? translated?.scene
        const shown =
          translated && translated.text.trim() !== '' ? translated : { ...line, text: '' }
        return {
          line: scene === undefined ? shown : { ...shown, scene },
          english: line.text,
        }
      }),
    ...lines.filter((line) => !inSource.has(line.key)).map((line) => ({ line, english: null })),
  ]
}

/**
 * The lock with every untracked clip taken as made from today's inputs, so clips recorded before
 * the studio are not re-recorded just because nothing says what they were made from.
 */
export function adoptUntracked(input: PlanInput, now: string): { lock: Lock; adopted: number } {
  const { lines, cast, cues, narration } = input
  const untracked = new Set(
    planPart(input)
      .lines.filter((line) => line.status === 'untracked')
      .map((line) => line.key),
  )
  const lock: Lock = { ...input.lock }
  for (const line of lines) {
    if (!untracked.has(line.key)) continue
    // An untracked line has a voice, so it has inputs.
    const inputs = clipInputs(line, cast.speakers[line.speaker], cues, cast.pronounce, narration)!
    const { fp, parts } = fingerprint(inputs)
    lock[line.key] = { fp, voice: inputs.voice, model: inputs.model, parts, adopted: true, at: now }
  }
  return { lock, adopted: untracked.size }
}
