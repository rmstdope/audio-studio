import { languageName } from './languages'
import { partPathFor, phraseProblem, soundAlikeOf, type Problem, type Project } from './project'
import type { Pronunciation } from './pronounce'
import { pronounceOf, voiceOf, type Cast, type Line } from './resources'

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

/** A character in one language: its casting there, and where it speaks in that language's dialog. */
export interface CharacterLanguage {
  voice: string | null
  voiceName: string | null
  /** The character's own speed in the language, or null for the project's. */
  speed: number | null
  /** The character's own audition phrase in the language, or null. */
  phrase: string | null
  appearances: Appearance[]
  totalLines: number
  /** The character's longest line in the language (first on a tie); null without lines. */
  longest: string | null
}

/**
 * A character as the UI shows it: its cast entry and where it speaks across the project. The
 * fields on its own are the source language's; `languages` has every declared language.
 */
export interface CharacterSummary {
  id: string
  name: string
  voice: string | null
  voiceName: string | null
  style: string
  /** The character's own speaking speed, or null for the project's. */
  speed: number | null
  keywords: string[]
  appearances: Appearance[]
  totalLines: number
  /** The character in each declared language, by code. */
  languages: Record<string, CharacterLanguage>
}

/**
 * The other characters cast with the same voice as `characterId` in `language` (the source
 * language's when none is named): two characters in one voice are hard to tell apart in a scene,
 * so the UI points it out (it may be meant: a narrator and a character in a prologue). One
 * character with the same voice in two languages is not a note. Empty for an uncast or unknown
 * character.
 */
export function sharesVoiceWith(
  characters: CharacterSummary[],
  characterId: string,
  language?: string,
): CharacterSummary[] {
  const voiceIn = (c: CharacterSummary) => (language ? c.languages[language]?.voice : c.voice)
  const self = characters.find((c) => c.id === characterId)
  const voice = self && voiceIn(self)
  if (!voice) return []
  return characters.filter((c) => c.id !== characterId && voiceIn(c) === voice)
}

/** Everything the overview needs about the project, from the project file and its resources. */
export interface ProjectSummary {
  name: string
  description: string
  root: string
  partLabel: string
  /** The declared languages, source language first. */
  languages: { id: string; name: string }[]
  charactersPath: string
  parts: PartSummary[]
  characters: CharacterSummary[]
  /** Whether the project file names a `refreshDialog` command. */
  canRefresh: boolean
  /** The pronunciation table in file order; null when the cast cannot be read. */
  pronounce: Pronunciation[] | null
  /** The project's own words that sound the same, a group each (`quality.soundAlike`). */
  soundAlike: string[][]
  /**
   * What is kept per language, by code: its pronunciations (null when the cast cannot be read)
   * and its words that sound the same. The source language's are the two fields above.
   */
  perLanguage: Record<string, { pronounce: Pronunciation[] | null; soundAlike: string[][] }>
  /** The draft and final recording models (`models.draft`, `models.final`). */
  models: { draft: string; final: string }
  /** The project's speaking speed (`tts.speed`), which a character may have its own in place of. */
  speed: number
  /** The project file's name, where `soundAlike` is saved. */
  projectFile: string
  problems: Problem[]
}

/** The inputs of `summarize`: the parsed project and what was read from its resources. */
export interface SummaryInput {
  project: Project
  /** The project file's name. */
  projectFile: string
  root: string
  dialogs: Record<string, DialogState>
  /** The other languages' dialogs by language code, then part; a language left out has none. */
  languageDialogs?: Record<string, Record<string, DialogState>>
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
  projectFile,
  root,
  dialogs,
  languageDialogs = {},
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
      dialogPath: partPathFor(narration.paths.dialog, part.id, narration.languages[0]),
      dialog: dialog.status,
      lineCount: lines.length,
      characters: byLinesThenId([...counts].map(([id, count]) => ({ id, lines: count }))),
    }
  })

  const source = narration.languages[0]!
  // Where each character speaks in each language, and its longest line there.
  const spoken = new Map<
    string,
    Map<string, { appearances: Appearance[]; longest: string | null }>
  >()
  for (const language of narration.languages) {
    const byPart = language === source ? dialogs : (languageDialogs[language] ?? {})
    const found = new Map<string, { appearances: Appearance[]; longest: string | null }>()
    for (const part of narration.parts) {
      const dialog = byPart[part.id]
      if (dialog?.status !== 'ok') continue
      for (const [id, count] of countBySpeaker(dialog.lines)) {
        const entry = found.get(id) ?? { appearances: [], longest: null }
        entry.appearances.push({ part: part.id, lines: count })
        found.set(id, entry)
      }
      for (const line of dialog.lines) {
        const entry = found.get(line.speaker)!
        // Only a line that fits one take can be a phrase.
        const fits = phraseProblem(line.text, narration.quality.chunkLimit) === null
        if (
          fits &&
          line.text.trim() &&
          (entry.longest === null || [...line.text].length > [...entry.longest].length)
        )
          entry.longest = line.text
      }
    }
    spoken.set(language, found)
  }

  const speakers = cast?.speakers ?? {}
  const ids = new Set([...Object.keys(speakers), ...appearances.keys()])
  const characters = [...ids].map((id): CharacterSummary => {
    const entry = speakers[id]
    const seen = appearances.get(id) ?? []
    const languages = Object.fromEntries(
      narration.languages.map((language): [string, CharacterLanguage] => {
        const where = spoken.get(language)?.get(id)
        const lines = where?.appearances ?? []
        return [
          language,
          {
            ...voiceOf(entry, language, source),
            appearances: lines,
            totalLines: lines.reduce((sum, a) => sum + a.lines, 0),
            longest: where?.longest ?? null,
          },
        ]
      }),
    )
    return {
      id,
      name: displayName(id),
      voice: entry?.voice ?? null,
      voiceName: entry?.voiceName ?? null,
      style: entry?.style ?? '',
      speed: entry?.speed ?? null,
      keywords: entry?.audition?.keywords ?? [],
      appearances: seen,
      totalLines: seen.reduce((sum, a) => sum + a.lines, 0),
      languages,
    }
  })

  return {
    name: project.name,
    description: project.description,
    root,
    partLabel: narration.partLabel,
    languages: narration.languages.map((id) => ({ id, name: languageName(id) })),
    charactersPath: narration.characters,
    parts,
    characters: characters.sort((a, b) => b.totalLines - a.totalLines || a.id.localeCompare(b.id)),
    canRefresh: Boolean(narration.refreshDialog),
    pronounce: cast ? Object.entries(cast.pronounce) : null,
    soundAlike: narration.quality.soundAlike,
    perLanguage: Object.fromEntries(
      narration.languages.map((language) => [
        language,
        {
          pronounce: cast ? Object.entries(pronounceOf(cast, language, source)) : null,
          soundAlike: soundAlikeOf(narration, language),
        },
      ]),
    ),
    models: { draft: narration.models.draft, final: narration.models.final },
    speed: narration.tts.speed,
    projectFile,
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
