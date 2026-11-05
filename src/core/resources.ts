import { z } from 'zod'

/**
 * One voiced line of a part's dialog as the game lists it: its id, who says it, and the words
 * (`title` is the game's own and unused). The rest of the studio knows the id as the line's `key`.
 */
export const LineSchema = z
  .object({
    // The id names the line's clip file (`<id>.mp3`), so it may only hold safe file-name characters.
    id: z.string().regex(/^[A-Za-z0-9_-]+$/, 'a line id may only hold letters, digits, - and _'),
    title: z.string().optional(),
    speaker: z.string().min(1),
    text: z.string(),
    /** The scene the line belongs to, as the game's dialog names it; lines without one are in none. */
    scene: z.string().min(1).optional(),
  })
  .transform(({ id, title: _title, ...line }) => ({ key: id, ...line }))

/** A part's dialog list (RetroQuest: `tts/<act>/script.json`). Read only. Ids are unique. */
export const DialogSchema = z.array(LineSchema).superRefine((lines, context) => {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const { key } of lines) (seen.has(key) ? twice : seen).add(key)
  if (twice.size) {
    context.addIssue({
      code: 'custom',
      message: `line ids must be unique; used more than once: ${[...twice].join(', ')}`,
    })
  }
})

/** The speeds Fish speaks at: half to double. */
export const SPEED = { min: 0.5, max: 2 }

/** A character's casting in one language other than the source: its voice, speed and phrase there. */
export const LanguageVoiceSchema = z.looseObject({
  voice: z.string().min(1).optional(),
  voiceName: z.string().optional(),
  speed: z.number().min(SPEED.min).max(SPEED.max).optional(),
  /** The character's own audition phrase in this language. */
  phrase: z.string().optional(),
})

/**
 * One character in the project-wide cast. Unknown fields are kept, so writing the cast back
 * never drops what another tool put there.
 */
export const CharacterSchema = z.looseObject({
  voice: z.string().min(1).optional(),
  voiceName: z.string().optional(),
  style: z.string().optional(),
  /** The character's own speaking speed, in place of the project's `generate.fish.speed`. */
  speed: z.number().min(SPEED.min).max(SPEED.max).optional(),
  audition: z
    .looseObject({
      keywords: z.array(z.string()).optional(),
      phrase: z.string().nullable().optional(),
    })
    .optional(),
  /**
   * The casting in the languages other than the source language, whose voice, speed and phrase
   * are the fields above; by language code.
   */
  languages: z.record(z.string(), LanguageVoiceSchema).optional(),
})

/**
 * How words are said: written → said, applied in the order of the file. One limit: JSON objects
 * in JavaScript put integer-like keys (`"10"`) first, so such an entry is applied before the
 * others, where Python's narrate.py keeps file order. It only matters when entries chain.
 */
const PronounceSchema = z
  .unknown()
  .superRefine((raw, context) => {
    // A record drops `__proto__` when parsing: say so, rather than losing it unseen.
    if (raw && typeof raw === 'object' && Object.hasOwn(raw, '__proto__')) {
      context.addIssue({
        code: 'custom',
        message: '“__proto__” cannot be a pronunciation here; rename it',
      })
    }
  })
  .pipe(
    z.record(z.string(), z.string()).superRefine((pronounce, context) => {
      if ('' in pronounce) {
        context.addIssue({
          code: 'custom',
          message: 'a pronunciation needs the word it replaces; one has an empty word',
        })
      }
    }),
  )

/**
 * The cast (`content-studio/narration/cast.json`): every speaker by the name the dialog uses, and
 * how words are said, by language (the source language included).
 */
export const CastSchema = z.looseObject({
  speakers: z.record(z.string(), CharacterSchema).default({}),
  pronounce: z.record(z.string(), PronounceSchema).default({}),
})

/** A character's casting in one language: nulls where it has none. */
export interface LanguageCasting {
  voice: string | null
  voiceName: string | null
  speed: number | null
  phrase: string | null
}

/**
 * A character's voice, speed and own audition phrase in `language`: the source language's are the
 * entry's own fields, another language's are under `languages`.
 */
export function voiceOf(
  character: Character | undefined,
  language: string,
  source: string,
): LanguageCasting {
  const own =
    language === source
      ? {
          voice: character?.voice,
          voiceName: character?.voiceName,
          speed: character?.speed,
          phrase: character?.audition?.phrase?.trim() || undefined,
        }
      : (character?.languages?.[language] ?? {})
  return {
    voice: own.voice ?? null,
    voiceName: own.voiceName ?? null,
    speed: own.speed ?? null,
    phrase: own.phrase?.trim() || null,
  }
}

/** How words are said in `language`: its own table, none when it has none. */
export function pronounceOf(cast: Cast, language: string): Record<string, string> {
  return Object.hasOwn(cast.pronounce, language) ? cast.pronounce[language]! : {}
}

/**
 * The cast as one language speaks it: every character with that language's voice, speed and
 * phrase, and the language's pronunciations, in the fields the planner and the takes read.
 */
export interface SpokenCast {
  speakers: Record<string, Character>
  pronounce: Record<string, string>
}

/**
 * The cast as `language` sees it (see `SpokenCast`). The source language's characters are as they
 * are; another language's have its casting in the source language's places.
 */
export function projectCast(cast: Cast, language: string, source: string): SpokenCast {
  const pronounce = pronounceOf(cast, language)
  if (language === source) return { speakers: cast.speakers, pronounce }
  const speakers = Object.fromEntries(
    Object.entries(cast.speakers).map(([id, entry]) => {
      const { voice, voiceName, speed, phrase } = voiceOf(entry, language, source)
      const { voice: _v, voiceName: _n, speed: _s, languages: _l, audition, ...rest } = entry
      const projected: Character = { ...rest }
      if (voice) projected.voice = voice
      if (voiceName) projected.voiceName = voiceName
      if (speed !== null) projected.speed = speed
      const own = { ...audition, phrase }
      if (audition || phrase) projected.audition = own
      return [id, projected]
    }),
  )
  return { speakers, pronounce }
}

/**
 * The settings a character is spoken with: the project's, with the character's own speed when it
 * has one. Used wherever Fish is asked to speak, and in the fingerprint, so a changed speed makes
 * the character's lines stale.
 */
export function ttsFor(
  tts: { temperature: number; topP: number; speed: number },
  character: Pick<Character, 'speed'> | undefined,
): { temperature: number; topP: number; speed: number } {
  return character?.speed === undefined ? tts : { ...tts, speed: character.speed }
}

/** A part's delivery cues: line key → a cue that replaces the character's style for that line. */
export const CuesSchema = z.record(z.string(), z.string())

/** A line's own cue, if it has one (only the file's own keys: never `toString` and the like). */
export function cueFor(cues: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(cues, key) ? cues[key] : undefined
}

/**
 * What a scene's cue is kept under in the cues file: a line key never holds a colon, so it cannot
 * be one, and the game, which looks up its lines' keys, never reads it.
 */
const SCENE_PREFIX = 'scene:'

/** The cues file's key for a scene's cue. */
export function sceneKey(scene: string): string {
  return `${SCENE_PREFIX}${scene}`
}

/** The scene a cues file key names, or null for a line's key. */
export function sceneOfKey(key: string): string | null {
  return key.startsWith(SCENE_PREFIX) ? key.slice(SCENE_PREFIX.length) : null
}

/** One clip in the game's manifest. Only what the studio needs is checked; the rest is kept. */
export const ManifestEntrySchema = z.looseObject({
  file: z.string().min(1),
  speaker: z.string().optional(),
  duration: z.number().optional(),
})

/** The game's clip manifest (RetroQuest: `web/public/audio/narration/<act>/manifest.json`). */
export const ManifestSchema = z.record(z.string(), ManifestEntrySchema)

/**
 * What a clip was made from: its fingerprint, voice and model, and short hashes of the rest.
 * Unknown fields are kept, so rewriting the lock never drops what a newer version put there.
 */
export const LockEntrySchema = z.looseObject({
  fp: z.string(),
  voice: z.string(),
  model: z.string(),
  parts: z.object({ cue: z.string(), text: z.string(), said: z.string(), settings: z.string() }),
  /** Share of the words Whisper heard in the kept take; absent for adopted clips. */
  heard: z.number().min(0).max(1).optional(),
  takes: z.number().int().min(1).optional(),
  /** True when the clip was made before the studio, and taken as it was. */
  adopted: z.boolean().optional(),
  /** True when the user accepted the clip as it is, though heard below the bar: not weak. */
  accepted: z.boolean().optional(),
  at: z.string(),
})

/** A part's lock (`narration.lock.json`): line key → what its clip was made from. */
export const LockSchema = z.record(z.string(), LockEntrySchema)

/** A voiced line of dialog. */
export type Line = z.output<typeof LineSchema>

/** A character's entry in the cast. */
export type Character = z.infer<typeof CharacterSchema>

/** The project-wide cast. */
export type Cast = z.infer<typeof CastSchema>

/** A part's delivery cues. */
export type Cues = z.infer<typeof CuesSchema>

/** The game's clip manifest. */
export type Manifest = z.infer<typeof ManifestSchema>

/** What one clip was made from. */
export type LockEntry = z.infer<typeof LockEntrySchema>

/** A part's lock. */
export type Lock = z.infer<typeof LockSchema>
