import type { LineState, SceneState } from '../core/planner'
import { displayName } from '../core/summary'
import { plural } from './format'

/** A band above a run of one scene's lines (or of the lines in no scene). */
export interface SceneBandRow {
  kind: 'band'
  /** Where the run starts: a key for the table. */
  id: string
  /** The scene's name, or null for the lines in no scene. */
  scene: string | null
  /** What the band is called: the name, "<name>, continued" for a later run, or "No scene". */
  title: string
  /** Lines of the run that are shown, after the filters. */
  shown: number
  /** Lines the scene has, in all its runs. */
  total: number
}

/** A row of the lines table: a scene's band, or a line. */
export type TableRow = SceneBandRow | { kind: 'line'; line: LineState }

/**
 * The rows of the lines table: the lines shown, with a band before each run of lines of one scene
 * (in dialog order, a scene that comes back getting a second band), and a band for the lines in no
 * scene. A band is kept only when one of its lines is shown. A dialog that names no scenes has
 * no bands.
 */
export function tableRows(all: LineState[], shown: LineState[]): TableRow[] {
  if (!all.some((line) => line.scene !== null)) {
    return shown.map((line) => ({ kind: 'line', line }))
  }
  const visible = new Set(shown.map((line) => line.key))
  const total = new Map<string | null, number>()
  for (const line of all) total.set(line.scene, (total.get(line.scene) ?? 0) + 1)
  const rows: TableRow[] = []
  const seen = new Set<string | null>()
  let run: SceneBandRow | null = null
  let current: LineState | null = null
  for (const line of all) {
    if (!current || current.scene !== line.scene) {
      current = line
      run = {
        kind: 'band',
        id: line.key,
        scene: line.scene,
        title:
          line.scene === null
            ? 'No scene'
            : seen.has(line.scene)
              ? `${line.scene}, continued`
              : line.scene,
        shown: 0,
        total: total.get(line.scene)!,
      }
      seen.add(line.scene)
    }
    if (!visible.has(line.key)) continue
    if (run!.shown === 0) rows.push(run!)
    run!.shown++
    rows.push({ kind: 'line', line })
  }
  return rows
}

/** The count in a band: "· 27 lines", or "· 1 of 22 lines shown" when a filter hides some. */
export function bandCount(band: Pick<SceneBandRow, 'shown' | 'total'>, filtered: boolean): string {
  return filtered && band.shown < band.total
    ? `· ${band.shown} of ${band.total} lines shown`
    : `· ${plural(band.total, 'line')}`
}

/** What saving a scene cue does to recorded lines, or null when none would be marked. */
export function warningText(recorded: number): string | null {
  return recorded > 0 ? `Saving marks ${plural(recorded, 'recorded line')} for re-recording.` : null
}

/** The editor's hint: whose lines follow a scene's cue, as the project names them. */
export function followersHint(speakers: string[]): string {
  if (speakers.length === 0) return 'No speaker follows scene cues in this project.'
  const rest = 'follow this cue unless they have their own.'
  if (speakers.length === 1 && speakers[0] === 'narrator') return `The narrator's lines ${rest}`
  const names = speakers.map(displayName)
  const last = names.pop()!
  return `Lines by ${names.length ? `${names.join(', ')} and ${last}` : last} ${rest}`
}

/** The band that goes before each line (by key) in the rows, for the lines that start a run. */
export function bandsBefore(rows: TableRow[]): Map<string, SceneBandRow> {
  const before = new Map<string, SceneBandRow>()
  let band: SceneBandRow | null = null
  for (const row of rows) {
    if (row.kind === 'band') band = row
    else if (band) {
      before.set(row.line.key, band)
      band = null
    }
  }
  return before
}

/**
 * The cue a line would follow if it had none of its own, when that is its scene's: the line is in
 * a scene with a cue and its speaker is one that follows scene cues. Null otherwise.
 */
export function sceneCueWithoutOwn(
  scenes: SceneState[],
  speakers: string[],
  line: Pick<LineState, 'scene' | 'speaker'>,
): string | null {
  if (line.scene === null || !speakers.includes(line.speaker)) return null
  return scenes.find((scene) => scene.name === line.scene)?.cue ?? null
}
