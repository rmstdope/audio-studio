import { z } from 'zod'
import { VoiceSchema, type Voice } from './voiceSearch'

/**
 * The voices Fish designed for one character and not cast: kept between auditions, with the
 * description sent last (the box opens with it) and how many designs were ever made (their numbers
 * go on from it). Saved files are checked against this schema when read back.
 */
export const DesignsSchema = z.object({
  version: z.literal(1),
  character: z.string(),
  /** The description sent last, or null before any. */
  description: z.string().nullable(),
  /** How many designs were made for the character in all. */
  made: z.number().int().nonnegative(),
  voices: z.record(z.string(), VoiceSchema),
})

/** The designs kept for one character. */
export type Designs = z.infer<typeof DesignsSchema>

/** No design made for the character yet. */
export function emptyDesigns(character: string): Designs {
  return { version: 1, character, description: null, made: 0, voices: {} }
}

/**
 * With the designs `ids` made from `description` at `at` kept, numbered on from the ones made
 * before ("Design n"), and the description remembered.
 */
export function addDesigns(
  designs: Designs,
  description: string,
  at: string,
  ids: string[],
): Designs {
  const voices: Record<string, Voice> = { ...designs.voices }
  ids.forEach((id, index) => {
    const n = designs.made + index + 1
    voices[id] = {
      id,
      title: `Design ${n}`,
      description: '',
      tags: [],
      languages: [],
      uses: 0,
      likes: 0,
      author: '',
      sample: null,
      design: { n, description, at },
    }
  })
  return { ...designs, description, made: designs.made + ids.length, voices }
}

/** Without the design `id` (it was cast); the others keep their numbers. */
export function removeDesign(designs: Designs, id: string): Designs {
  const { [id]: _removed, ...voices } = designs.voices
  return { ...designs, voices }
}

/** The kept designs, in the order made. */
export function listDesigns(designs: Designs): Voice[] {
  return Object.values(designs.voices).sort((a, b) => (a.design?.n ?? 0) - (b.design?.n ?? 0))
}
