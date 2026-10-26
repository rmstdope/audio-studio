import { statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { soundAlikes, type SoundAlike } from '../core/align'
import { capitalisesNouns, languageName } from '../core/languages'
import { resolveInRoot } from '../core/paths'
import { NotesSchema, emptyNotes, type Notes } from '../core/notes'
import {
  adoptUntracked,
  planPart,
  withSourceScenes,
  type PartState,
  type PlanInput,
} from '../core/planner'
import {
  PROJECT_FILE,
  ProjectSchema,
  declaredLanguage,
  partCacheName,
  partPathFor,
  problemsFrom,
  soundAlikeOf,
  type Part,
  type Problem,
  type Project,
} from '../core/project'
import {
  CastSchema,
  CuesSchema,
  DialogSchema,
  LockSchema,
  ManifestSchema,
  projectCast,
  type Cast,
  type Cues,
} from '../core/resources'
import {
  recordedOf,
  summarize,
  type DialogState,
  type ProjectSummary,
  type Recorded,
} from '../core/summary'
import {
  formatEntriesPerLine,
  listFiles,
  readCached,
  readJson,
  readResource,
  writeAtomic,
} from './files'
import { gameFilePath, readMusic } from './musicLists'
import { inPartTurn } from './partFiles'

/** The project file in `start` or the nearest directory above it that has one; null if none. */
export function findProjectFile(start: string): string | null {
  let dir = start
  for (;;) {
    const candidate = join(dir, PROJECT_FILE)
    if (isFile(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Why `path` cannot be used as a project file, or null if it can. */
export function projectFileProblem(path: string): string | null {
  try {
    if (statSync(path).isDirectory()) return `${path} is a folder, not a project file.`
    return null
  } catch {
    return `${path} does not exist.`
  }
}

/** Why the project file itself could not be used. */
export interface ProjectFailure {
  ok: false
  file: string
  problems: Problem[]
}

/** The project summary, or why the project file could not be used. */
export type LoadResult = { ok: true; summary: ProjectSummary } | ProjectFailure

/**
 * Reads the project file and every resource it names, fresh from disk. Problems in a resource
 * are reported alongside the summary; only a broken project file stops the load.
 */
export async function loadProject(projectFile: string): Promise<LoadResult> {
  const loaded = await loadWorkspace(projectFile)
  return loaded.ok ? { ok: true, summary: loaded.summary } : loaded
}

/** True if the project has the character (in the cast or speaking in a part); null if not. */
export async function knownCharacter(
  projectFile: string,
  characterId: string,
): Promise<true | ProjectFailure | null> {
  const loaded = await loadWorkspace(projectFile)
  if (!loaded.ok) return loaded
  return loaded.summary.characters.some((c) => c.id === characterId) ? true : null
}

/**
 * What names a character's own files in the tool cache (its audition, its ruled-out voices) in a
 * language: the character's id for the source language, which keeps the names it always had, and
 * for a language the project does not declare; else the id with the language. The project file
 * is read to know the languages; if it cannot be, the id.
 */
export async function cacheNameFor(
  projectFile: string,
  characterId: string,
  language?: string,
): Promise<string> {
  if (language === undefined) return characterId
  const opened = await openProject(projectFile)
  if (!opened.ok) return characterId
  const resolved = declaredLanguage(opened.project.narration, language)
  return resolved === opened.project.narration.languages[0]
    ? characterId
    : `${characterId}\0${resolved}`
}

/** The parsed project file, the cast and the summary of the project, for the server's own use. */
export async function loadWorkspace(projectFile: string): Promise<
  | {
      ok: true
      project: Project
      /** The cast; null when it is broken (the summary's problems say why). */
      cast: Cast | null
      summary: ProjectSummary
    }
  | ProjectFailure
> {
  const root = dirname(projectFile)
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const problems: Problem[] = []

  const cast = await readCast(root, project, problems)
  const dialogs: Record<string, DialogState> = {}
  for (const part of project.narration.parts) {
    dialogs[part.id] = await readDialog(root, project, part, problems)
  }
  // The other languages' dialogs say where a character speaks in each; a missing one is no problem.
  const languageDialogs: Record<string, Record<string, DialogState>> = {}
  for (const language of project.narration.languages.slice(1)) {
    languageDialogs[language] = {}
    for (const part of project.narration.parts) {
      languageDialogs[language][part.id] = await readDialog(root, project, part, problems, language)
    }
  }
  const music = await readMusic(root, project, problems)
  return {
    ok: true,
    project,
    cast,
    summary: summarize({
      project,
      projectFile: basename(projectFile),
      root,
      dialogs,
      languageDialogs,
      cast,
      music,
      problems,
    }),
  }
}

/** Where the user's notes on each part's lines are kept, in the project's tool cache. */
export const NOTES_DIR = '.audio-studio/notes'

/**
 * The notes on a part's lines: none if there is no file. A file that cannot be read or does not
 * fit (a hand edit) gives none and a problem naming it, and nothing writes over it: the notes are
 * the user's own words, not something the studio can make again.
 */
export async function readNotes(
  root: string,
  /** What names the notes in the cache: the part's id, with the language besides the source. */
  name: string,
): Promise<{ notes: Notes; problem: Problem | null }> {
  const { value, broken, path } = await readCached(
    root,
    NOTES_DIR,
    name,
    NotesSchema,
    emptyNotes(name),
    (notes) => notes.part === name,
  )
  const problem = broken
    ? {
        file: path,
        path: '',
        message: 'the notes file cannot be read; fix or remove it, and until then no note is saved',
      }
    : null
  return { notes: value, problem }
}

/** How far one language of a part has come: its dialog, and its lines whose clip is up to date. */
export interface LanguageProgress {
  id: string
  name: string
  dialog: DialogState['status']
  /** What was recorded while the dialog is gone; null otherwise. */
  recorded: Recorded | null
  upToDate: number
  /** All the language's lines, those not translated included; 0 without a dialog. */
  total: number
}

/** One part with the state of every clip in it. */
export interface PartDetail extends PartState {
  id: string
  title: string
  dialog: DialogState['status']
  /** What was recorded while the dialog is gone; null otherwise. */
  recorded: Recorded | null
  dialogPath: string
  clipsPath: string
  lockPath: string
  manifestPath: string
  /** The share of words a take must be heard at to count as good (the project's `minHeard`). */
  minHeard: number
  /** The speakers whose lines follow their scene's cue (the project's `sceneCueSpeakers`). */
  sceneCueSpeakers: string[]
  /** The model everyday plans record with (the project's draft stage). */
  draftModel: string
  /** The model of the final recording; the same as the draft one when there is no final step. */
  finalModel: string
  /** The language these lines are in (the one asked for, or the source language). */
  language: string
  /** Every declared language with how far it has come, in the order the project declares them. */
  languages: LanguageProgress[]
  /** The user's notes on lines, by key (the studio's own, from the tool cache). */
  notes: Record<string, string>
  problems: Problem[]
}

/** A part's detail, why the project file could not be used, or null for an unknown part. */
export type PartResult = { ok: true; part: PartDetail } | ProjectFailure | null

/** Reads a part's dialog, cues, lock, manifest and clips folder, and plans every line. */
export async function loadPart(
  projectFile: string,
  partId: string,
  language?: string,
): Promise<PartResult> {
  const read = await readPart(projectFile, partId, language)
  if (!read || !read.ok) return read
  const { project, part, input, dialog, problems } = read
  const plan = planPart(input)
  const languages: LanguageProgress[] = []
  for (const id of project.narration.languages) {
    const other = id === read.language ? read : await readPart(projectFile, partId, id)
    if (!other?.ok) continue
    const state = id === read.language ? plan : planPart(other.input)
    const total = other.dialog.status === 'ok' ? state.lines.length : 0
    languages.push({
      id,
      name: languageName(id),
      dialog: other.dialog.status,
      recorded: recordedOf(other.dialog),
      upToDate: total ? state.counts.ok : 0,
      total,
    })
  }
  const notes = await readNotes(dirname(projectFile), read.cacheName)
  return {
    ok: true,
    part: {
      id: part.id,
      title: part.title,
      dialog: dialog.status,
      recorded: recordedOf(dialog),
      ...read.paths,
      language: read.language,
      languages,
      minHeard: project.narration.quality.minHeard,
      sceneCueSpeakers: project.narration.sceneCueSpeakers,
      draftModel: project.narration.models.draft,
      finalModel: project.narration.models.final,
      notes: onLines(notes.notes.lines, input.lines),
      problems: notes.problem ? [...problems, notes.problem] : problems,
      ...plan,
    },
  }
}

/** What adopting a part's clips did, or why it did nothing. */
export type AdoptResult =
  | { ok: true; adopted: number; lockPath: string }
  | { ok: false; problems: Problem[] }
  | ProjectFailure
  | null

/**
 * Takes every clip of a part that nothing knows the inputs of as made from today's inputs, and
 * writes the lock. Refuses while any of the part's files has a problem, since a broken cast or
 * lock would make it record the wrong inputs or drop entries.
 */
export async function adoptPart(
  projectFile: string,
  partId: string,
  now: Date = new Date(),
  language?: string,
): Promise<AdoptResult> {
  // In the part's turn, reading the part afresh: a line recorded meanwhile keeps its lock entry.
  return inPartTurn(projectFile, partId, async () => {
    const read = await readPart(projectFile, partId, language)
    if (!read || !read.ok) return read
    if (read.problems.length) return { ok: false, problems: read.problems }
    const { lock, adopted } = adoptUntracked(read.input, now.toISOString())
    const { lockPath } = read.paths
    if (adopted) await writeAtomic(dirname(projectFile), lockPath, formatEntriesPerLine(lock))
    return { ok: true, adopted, lockPath }
  })
}

/**
 * The absolute path of a clip in a part's clips folder, or null if the part is unknown or the
 * name is not a plain file there. Folders, symbolic links and hidden files are never served; the
 * planner never counts the first two as clips either.
 */
export async function clipFile(
  projectFile: string,
  partId: string,
  file: string,
  language?: string,
): Promise<string | null> {
  const opened = await openProject(projectFile)
  if (!opened.ok) return null
  const { narration } = opened.project
  if (!narration.parts.some((p) => p.id === partId) || file.startsWith('.')) return null
  const folder = resolveInRoot(
    dirname(projectFile),
    partPathFor(narration.paths.clips, partId, declaredLanguage(narration, language)),
  )
  return (await listFiles(folder)).has(file) ? join(folder, file) : null
}

/**
 * The absolute path of a clip in the music clips folder, or null if the project has no music or
 * the name is not a plain `.mp3` file there. Folders, links, hidden files and the manifest are
 * never served.
 */
export async function musicClipFile(projectFile: string, file: string): Promise<string | null> {
  const opened = await openProject(projectFile)
  if (!opened.ok || !opened.project.music) return null
  if (file.startsWith('.') || !file.endsWith('.mp3')) return null
  const folder = resolveInRoot(dirname(projectFile), opened.project.music.paths.clips)
  return (await listFiles(folder)).has(file) ? join(folder, file) : null
}

/**
 * The absolute path of the music a track plays now: its chosen take's clip, else the game's own
 * file for it. Null when there is none, it is not on disk, or the track is unknown. The game's
 * file is only read.
 */
export async function musicCurrentFile(projectFile: string, id: string): Promise<string | null> {
  const opened = await openProject(projectFile)
  if (!opened.ok || !opened.project.music) return null
  const root = dirname(projectFile)
  const music = await readMusic(root, opened.project, [])
  const row = music?.lists.flatMap((list) => list.tracks).find((track) => track.id === id)
  if (!row || row.current.kind === 'none' || !row.current.exists) return null
  return row.current.kind === 'take'
    ? musicClipFile(projectFile, `${id}.mp3`)
    : gameFilePath(root, row.current.file)
}

/** How a take is checked: the language Whisper is told, and the words counted as heard for each other. */
export interface Ears {
  /** The code of the language spoken; absent in a project with one language, where Whisper recognises it. */
  language: string | undefined
  alike: SoundAlike
  /** Whether the language capitalises its nouns, so only a known name is a name (`capitalisesNouns`). */
  capitalNouns: boolean
}

/** Everything read about a part, for planning it or acting on it. */
export interface PartRead {
  ok: true
  /** The language read: the one asked for if the project declares it, else the source language. */
  language: string
  /** What names the part's own files in the tool cache in this language (notes, what was heard). */
  cacheName: string
  /** The source language's cues a line follows until it has its own (none in the source language). */
  sourceCues: Cues
  /** How a take is checked in this language: what Whisper is told, and the words that sound the same. */
  ears: Ears
  project: Project
  part: Part
  dialog: DialogState
  input: PlanInput
  paths: {
    dialogPath: string
    cuesPath: string
    clipsPath: string
    lockPath: string
    manifestPath: string
  }
  problems: Problem[]
}

/** A part's files, read and validated, or why the project file cannot be used; null for an unknown part. */
export async function readPart(
  projectFile: string,
  partId: string,
  asked?: string,
): Promise<PartRead | ProjectFailure | null> {
  const root = dirname(projectFile)
  const opened = await openProject(projectFile)
  if (!opened.ok) return opened
  const { project } = opened
  const part = project.narration.parts.find((p) => p.id === partId)
  if (!part) return null

  const problems: Problem[] = []
  const templates = project.narration.paths
  const language = declaredLanguage(project.narration, asked)
  const at = (template: string) => partPathFor(template, part.id, language)

  const dialog = await readDialog(root, project, part, problems, language)
  // Another language is shown beside the source language's lines, so those are read too.
  const sourceLanguage = project.narration.languages[0]!
  const source =
    language !== sourceLanguage && dialog.status === 'ok'
      ? await readDialog(root, project, part, problems, sourceLanguage)
      : null
  if (source?.status === 'missing' || source?.status === 'gone') {
    problems.push({
      file: partPathFor(templates.dialog, part.id, sourceLanguage),
      path: '',
      message: `the ${languageName(sourceLanguage)} dialog is missing, so lines cannot be matched with it`,
    })
  }
  const cast = await readCast(root, project, problems)
  const ownCues = usable(await readResource(root, at(templates.cues), CuesSchema, problems)) ?? {}
  // Another language follows the source language's cue for a line until it has one of its own.
  const sourceCues =
    language === sourceLanguage
      ? {}
      : (usable(
          await readResource(
            root,
            partPathFor(templates.cues, part.id, sourceLanguage),
            CuesSchema,
            problems,
          ),
        ) ?? {})
  const cues = { ...sourceCues, ...ownCues }
  const lock = usable(await readResource(root, at(templates.lock), LockSchema, problems))
  const manifest = usable(
    await readResource(root, at(templates.manifest), ManifestSchema, problems),
  )
  const files = await listFiles(resolveInRoot(root, at(templates.clips)))

  return {
    ok: true,
    language,
    cacheName: partCacheName(project.narration, part.id, language),
    sourceCues,
    ears: {
      // Told the language only in a project with several, so a single-language project is as it was.
      language: project.narration.languages.length > 1 ? language : undefined,
      // Its numbers as words; the built-in groups are English words and apply to English only.
      alike: soundAlikes(soundAlikeOf(project.narration, language), language),
      capitalNouns: capitalisesNouns(language),
    },
    project,
    part,
    dialog,
    input: {
      lines: withSourceScenes(
        dialog.status === 'ok' ? dialog.lines : [],
        source?.status === 'ok' ? source.lines : undefined,
      ),
      ...(source?.status === 'ok' ? { source: source.lines } : {}),
      cast: projectCast(
        cast ?? { speakers: {}, pronounce: {} },
        language,
        project.narration.languages[0]!,
      ),
      cues,
      ownCues,
      sourceCues,
      lock: lock ?? {},
      manifest: manifest ?? {},
      files,
      narration: project.narration,
      held: dialog.status === 'invalid' || dialog.status === 'gone',
    },
    paths: {
      dialogPath: at(templates.dialog),
      cuesPath: at(templates.cues),
      clipsPath: at(templates.clips),
      lockPath: at(templates.lock),
      manifestPath: at(templates.manifest),
    },
    problems,
  }
}

/** A resource read's value, or null when there is no file or it is broken (already a problem). */
function usable<T>(read: T | 'missing' | 'invalid'): T | null {
  return read === 'missing' || read === 'invalid' ? null : read
}

/** The project's cast: empty if there is none yet, null (with the problem added) if it is broken. */
async function readCast(root: string, project: Project, problems: Problem[]): Promise<Cast | null> {
  const read = await readResource(root, project.narration.characters, CastSchema, problems)
  if (read === 'invalid') return null
  return read === 'missing' ? { speakers: {}, pronounce: {} } : read
}

async function readDialog(
  root: string,
  project: Project,
  part: Part,
  problems: Problem[],
  language: string = project.narration.languages[0]!,
): Promise<DialogState> {
  const path = partPathFor(project.narration.paths.dialog, part.id, language)
  const read = await readResource(root, path, DialogSchema, problems)
  if (read === 'invalid') return { status: 'invalid' }
  if (read !== 'missing') return { status: 'ok', lines: read }
  // No file: gone if recordings were made with it, so they are held and not orphaned.
  const templates = project.narration.paths
  const at = (template: string) => partPathFor(template, part.id, language)
  const quiet: Problem[] = []
  const clips = usable(await readResource(root, at(templates.manifest), ManifestSchema, quiet))
  const cues = usable(await readResource(root, at(templates.cues), CuesSchema, quiet))
  const recorded = { clips: Object.keys(clips ?? {}).length, cues: Object.keys(cues ?? {}).length }
  return recorded.clips || recorded.cues ? { status: 'gone', ...recorded } : { status: 'missing' }
}

/** The validated project file, or why it cannot be used. */
export async function openProject(
  projectFile: string,
): Promise<{ ok: true; project: Project } | ProjectFailure> {
  const root = dirname(projectFile)
  const file = basename(projectFile)
  const json = await readJson(projectFile)
  if (json.status === 'missing') {
    return { ok: false, file, problems: [{ file, path: '', message: 'the file is gone' }] }
  }
  if (json.status === 'invalid') {
    return { ok: false, file, problems: [{ file, path: '', message: json.message }] }
  }
  const parsed = ProjectSchema.safeParse(json.value)
  if (!parsed.success) return { ok: false, file, problems: problemsFrom(file, parsed.error) }

  const outside = projectPaths(parsed.data).flatMap(([path, value]) => {
    try {
      resolveInRoot(root, value)
      return []
    } catch {
      return [{ file, path, message: `${value} is outside the project folder` }]
    }
  })
  if (outside.length) return { ok: false, file, problems: outside }
  return { ok: true, project: parsed.data }
}

/** Every path the project file names, with its JSON path, for the outside-the-root check. */
function projectPaths(project: Project): [string, string][] {
  const { narration } = project
  const paths: [string, string][] = [
    ['env', project.env],
    ['narration.characters', narration.characters],
  ]
  for (const [name, template] of Object.entries(narration.paths)) {
    for (const part of narration.parts) {
      for (const language of narration.languages) {
        paths.push([`narration.paths.${name}`, partPathFor(template, part.id, language)])
      }
    }
  }
  return paths
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** The notes on lines still in the dialog: one on a line that left it is kept, but not shown. */
function onLines(notes: Record<string, string>, lines: { key: string }[]): Record<string, string> {
  const keys = new Set(lines.map((l) => l.key))
  return Object.fromEntries(Object.entries(notes).filter(([key]) => keys.has(key)))
}
