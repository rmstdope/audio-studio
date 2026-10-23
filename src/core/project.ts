import { z } from 'zod'

/** Fish Audio models a project may use for now. Paid models come with final generation. */
export const FREE_MODELS = ['s2.1-pro-free'] as const

/** The file name the CLI looks for, walking up from the current directory. */
export const PROJECT_FILE = 'audio-studio.json'

const freeModel = z
  .string()
  .default(FREE_MODELS[0])
  .refine((model) => (FREE_MODELS as readonly string[]).includes(model), {
    error: (issue) =>
      `"${String(issue.input)}" is not available yet: only ${FREE_MODELS.join(', ')} can be used for now`,
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

const NarrationSchema = z.object({
  partLabel: z.string().min(1).default('Part'),
  parts: z
    .array(PartSchema)
    .min(1)
    .refine((parts) => new Set(parts.map((part) => part.id)).size === parts.length, {
      error: 'part ids must be unique',
    }),
  characters: z.string().min(1),
  paths: z.object({
    dialog: partPath,
    cues: partPath,
    lock: partPath,
    clips: partPath,
    manifest: partPath,
  }),
  refreshDialog: z.string().optional(),
  models: z.object({ audition: freeModel, draft: freeModel, final: freeModel }).prefault({}),
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
    })
    .prefault({}),
  quality: z
    .object({
      minHeard: z.number().min(0).max(1).default(0.9),
      takes: z.number().int().min(1).default(3),
      chunkLimit: z.number().int().min(50).default(400),
      parallel: z.number().int().min(1).default(4),
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

/** A path template with `{part}` replaced by the part's id. */
export function partPathFor(template: string, partId: string): string {
  return template.replaceAll('{part}', partId)
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
