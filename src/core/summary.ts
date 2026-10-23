import { partPathFor, type Problem, type Project } from './project'
import type { Pronunciation } from './pronounce'
import type { Cast, Line } from './resources'

/** What reading a part's dialog gave: its lines, no file yet, or a file that failed validation. */
export type DialogState =
  { status: 'ok'; lines: Line[] } | { status: 'missing' } | { status: 'invalid' }

/** How many lines a character has in one part. */
export interface Appearance {
  part: string
  lines: number
}

/** A part as the UI shows it. */
export interface PartSummary {
  id: string
  title: string
  dialogPath: string
  dialog: DialogState['status']
  lineCount: number
  /** The characters speaking in this part, most lines first. */
  characters: { id: string; lines: number }[]
}

/** A character as the UI shows it: its cast entry and where it speaks across the project. */
export interface CharacterSummary {
  id: string
  name: string
  voice: string | null
  voiceName: string | null
  style: string
  keywords: string[]
  appearances: Appearance[]
  totalLines: number
}

/** Everything the overview needs about the project, from the project file and its resources. */
export interface ProjectSummary {
  name: string
  description: string
  root: string
  partLabel: string
  charactersPath: string
  parts: PartSummary[]
  characters: CharacterSummary[]
  /** The pronunciation table in file order; null when the cast cannot be read. */
  pronounce: Pronunciation[] | null
  problems: Problem[]
}

/** The inputs of `summarize`: the parsed project and what was read from its resources. */
export interface SummaryInput {
  project: Project
  root: string
  dialogs: Record<string, DialogState>
  cast: Cast | null
  problems: Problem[]
}

/** A character's id as a name: its first letter upper-cased (`narrator-act2` → `Narrator-act2`). */
export function displayName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1)
}

/**
 * The project as the UI shows it. Characters are identified by name across the project: one entry
 * per name, whether it is only in the cast, only in dialog, or both.
 */
export function summarize({
  project,
  root,
  dialogs,
  cast,
  problems,
}: SummaryInput): ProjectSummary {
  const { narration } = project
  const appearances = new Map<string, Appearance[]>()

  const parts = narration.parts.map((part): PartSummary => {
    const dialog = dialogs[part.id] ?? { status: 'missing' }
    const lines = dialog.status === 'ok' ? dialog.lines : []
    const counts = countBySpeaker(lines)
    for (const [id, count] of counts) {
      const list = appearances.get(id) ?? []
      list.push({ part: part.id, lines: count })
      appearances.set(id, list)
    }
    return {
      id: part.id,
      title: part.title,
      dialogPath: partPathFor(narration.paths.dialog, part.id),
      dialog: dialog.status,
      lineCount: lines.length,
      characters: byLinesThenId([...counts].map(([id, count]) => ({ id, lines: count }))),
    }
  })

  const speakers = cast?.speakers ?? {}
  const ids = new Set([...Object.keys(speakers), ...appearances.keys()])
  const characters = [...ids].map((id): CharacterSummary => {
    const entry = speakers[id]
    const seen = appearances.get(id) ?? []
    return {
      id,
      name: displayName(id),
      voice: entry?.voice ?? null,
      voiceName: entry?.voiceName ?? null,
      style: entry?.style ?? '',
      keywords: entry?.audition?.keywords ?? [],
      appearances: seen,
      totalLines: seen.reduce((sum, a) => sum + a.lines, 0),
    }
  })

  return {
    name: project.name,
    description: project.description,
    root,
    partLabel: narration.partLabel,
    charactersPath: narration.characters,
    parts,
    characters: characters.sort((a, b) => b.totalLines - a.totalLines || a.id.localeCompare(b.id)),
    pronounce: cast ? Object.entries(cast.pronounce) : null,
    problems,
  }
}

function countBySpeaker(lines: Line[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1)
  return counts
}

function byLinesThenId<T extends { id: string; lines: number }>(items: T[]): T[] {
  return items.sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id))
}
