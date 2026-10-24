import { z } from 'zod'

/** One voiced line of a part's dialog: the game's stable key, who says it, and the words. */
export const LineSchema = z.object({
  // The key names the line's clip file (`<key>.mp3`), so it may only hold safe file-name characters.
  key: z.string().regex(/^[A-Za-z0-9_-]+$/, 'a line key may only hold letters, digits, - and _'),
  speaker: z.string().min(1),
  text: z.string(),
})

/** A part's dialog resource (RetroQuest: `tts/<act>/script.json`). Read only. Keys are unique. */
export const DialogSchema = z.array(LineSchema).superRefine((lines, context) => {
  const seen = new Set<string>()
  const twice = new Set<string>()
  for (const { key } of lines) (seen.has(key) ? twice : seen).add(key)
  if (twice.size) {
    context.addIssue({
      code: 'custom',
      message: `line keys must be unique; used more than once: ${[...twice].join(', ')}`,
    })
  }
})

/**
 * One character in the project-wide cast. Unknown fields are kept, so writing the cast back
 * never drops what another tool put there.
 */
export const CharacterSchema = z.looseObject({
  voice: z.string().min(1).optional(),
  voiceName: z.string().optional(),
  style: z.string().optional(),
  audition: z
    .looseObject({
      keywords: z.array(z.string()).optional(),
      phrase: z.string().nullable().optional(),
    })
    .optional(),
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

/** The character resource: every character by name, and how words are said. */
export const CastSchema = z.looseObject({
  speakers: z.record(z.string(), CharacterSchema).default({}),
  pronounce: PronounceSchema.default({}),
})

/** A part's delivery cues: line key → a cue that replaces the character's style for that line. */
export const CuesSchema = z.record(z.string(), z.string())

/** A line's own cue, if it has one (only the file's own keys: never `toString` and the like). */
export function cueFor(cues: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(cues, key) ? cues[key] : undefined
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
export type Line = z.infer<typeof LineSchema>

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
