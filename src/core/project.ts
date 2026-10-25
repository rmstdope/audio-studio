import { z } from 'zod'
import { knownLanguage } from './languages'
import { isPriced } from './prices'
import { SOUND_ALIKE_WORD } from './soundAlikeEdit'

/** Fish Audio's free model: the only one for auditions, for now. */
export const FREE_MODELS = ['s2.1-pro-free'] as const

/** The smallest `quality.chunkLimit` allowed. */
const MIN_CHUNK = 100

/**
 * Why an audition phrase cannot be one take, or null if it can: a take is sent as one piece, as
 * narrate.py sends any text up to `chunkLimit` characters (counted as Python counts them).
 */
export function phraseProblem(phrase: string, chunkLimit: number): string | null {
  const length = [...phrase].length
  return length > chunkLimit
    ? `is ${length} characters; a take is one piece of at most ${chunkLimit} (quality.chunkLimit)`
    : null
}

/** The file name the CLI looks for, walking up from the current directory. */
export const PROJECT_FILE = 'audio-studio.json'

/**
 * A model for a stage: any whose price the studio knows, so a plan can say what it costs. The
 * audition stage may name a paid one too: its takes are then paid from a budget per sitting.
 */
const recordingModel = z
  .string()
  .default(FREE_MODELS[0])
  .refine(isPriced, {
    error: (issue) => `"${String(issue.input)}" has no known price, so its cost cannot be shown`,
  })

/** A path that differs per part, so it must contain `{part}`. */
const partPath = z.string().refine((path) => path.includes('{part}'), {
  error: 'must contain {part}, or every part would share one file',
})

const PartSchema = z.object({
  id: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/,
      'use letters, digits, - and _ only (it is used in paths)',
    ),
  title: z.string().min(1),
})

const NarrationSchema = z
  .object({
    partLabel: z.string().min(1).default('Part'),
    parts: z
      .array(PartSchema)
      .min(1)
      .refine((parts) => new Set(parts.map((part) => part.id)).size === parts.length, {
        error: 'part ids must be unique',
      }),
    /**
     * The languages the game is narrated in, by code. The first is the source language: the one a
     * translation is shown beside.
     */
    languages: z
      .array(
        z.string().refine(knownLanguage, {
          error: (issue) => `"${String(issue.input)}" is not a language code (such as en or sv)`,
        }),
      )
      .min(1)
      .refine((languages) => new Set(languages).size === languages.length, {
        error: 'languages must be unique',
      })
      .default(['en']),
    characters: z.string().min(1),
    paths: z.object({
      dialog: partPath,
      cues: partPath,
      lock: partPath,
      clips: partPath,
      manifest: partPath,
    }),
    refreshDialog: z.string().optional(),
    models: z
      .object({ audition: recordingModel, draft: recordingModel, final: recordingModel })
      .prefault({}),
    tts: z
      .object({
        temperature: z.number().min(0).max(1).default(0.7),
        topP: z.number().min(0).max(1).default(0.7),
        speed: z.number().positive().default(1),
      })
      .prefault({}),
    output: z
      .object({
        codec: z.literal('mp3').default('mp3'),
        bitrate: z.string().default('64k'),
        channels: z.union([z.literal(1), z.literal(2)]).default(1),
        /** Loudness each new clip is levelled to (integrated LUFS, as RetroQuest's level.py). */
        lufs: z.number().min(-70).max(0).nullable().default(null),
      })
      .prefault({}),
    quality: z
      .object({
        minHeard: z.number().min(0).max(1).default(0.9),
        takes: z.number().int().min(1).default(3),
        // At least 100, so the built-in audition phrase always fits in one take.
        chunkLimit: z.number().int().min(MIN_CHUNK).default(400),
        parallel: z.number().int().min(1).default(4),
        /**
         * How takes are checked: mlx-whisper (Apple silicon, through uv), or none (one take each,
         * word timings spread evenly).
         */
        transcriber: z.enum(['mlx-whisper', 'none']).default('mlx-whisper'),
        whisperModel: z.string().min(1).default('mlx-community/whisper-large-v3-turbo'),
        /**
         * The game's own words that sound the same ("Lyria" and "Liria"), a group each, added to
         * the built-in ones: Whisper writing one for another still counts as heard.
         */
        soundAlike: z
          .array(
            z
              .array(
                z
                  .string()
                  .regex(
                    SOUND_ALIKE_WORD,
                    'expected a word or phrase: words parted by one space, no commas, a letter or digit in each',
                  ),
              )
              .min(2),
          )
          .default([]),
      })
      .prefault({}),
    audition: z
      .object({
        phrase: z
          .string()
          .min(1)
          .default(
            'Come in out of the rain, child. Sit by the fire, and I will tell you how it all began.',
          ),
        candidatesPerRound: z.number().int().min(1).default(5),
        language: z.string().default('en'),
      })
      .prefault({}),
  })
  .superRefine((narration, context) => {
    if (narration.languages.length > 1) {
      for (const [name, template] of Object.entries(narration.paths)) {
        if (template.includes('{language}')) continue
        context.addIssue({
          code: 'custom',
          path: ['paths', name],
          message:
            'must contain {language} when the project has several languages, or they would share one file',
        })
      }
    }
    const limit = narration.quality.chunkLimit
    // A wrong limit is reported on its own; measuring against it would only add noise.
    if (!Number.isInteger(limit) || limit < MIN_CHUNK) return
    const problem = phraseProblem(narration.audition.phrase, limit)
    if (problem)
      context.addIssue({ code: 'custom', path: ['audition', 'phrase'], message: problem })
  })

/** The project file, `audio-studio.json`, in the consumer repository's root. */
export const ProjectSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  description: z.string().default(''),
  env: z.string().default('.env'),
  narration: NarrationSchema,
})

/** A validated project file, with defaults filled in. */
export type Project = z.infer<typeof ProjectSchema>

/** One part of the game (RetroQuest: an act). */
export type Part = z.infer<typeof PartSchema>

/** The part-dependent paths of the narration workspace. */
export type PartPaths = Project['narration']['paths']

/** A path template with `{part}` replaced by the part's id and, if given, `{language}` by the language. */
export function partPathFor(template: string, partId: string, language?: string): string {
  const path = template.replaceAll('{part}', partId)
  return language === undefined ? path : path.replaceAll('{language}', language)
}

/** Something wrong with a file the studio reads: which file, where in it, and what. */
export interface Problem {
  file: string
  path: string
  message: string
}

/** Zod's issues as problems in `file`, each with its JSON path written out (`narration.parts[0].id`). */
export function problemsFrom(file: string, error: z.ZodError): Problem[] {
  return error.issues.map((issue) => ({
    file,
    path: formatPath(issue.path),
    message: issue.message,
  }))
}

function formatPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, index) =>
      typeof key === 'number' ? `[${key}]` : index === 0 ? String(key) : `.${String(key)}`,
    )
    .join('')
}
