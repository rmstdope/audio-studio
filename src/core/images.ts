import { z } from 'zod'
import type { Problem } from './project'

/** An image as the game lists it. The id names the image everywhere, so it is a slug. */
export const ImageSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and - only'),
  title: z.string().min(1),
  description: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

/** An act's images, in the game's order (a list that is there and empty means the game asks for none). */
export const ImageListSchema = z.array(ImageSchema)

/** The game's style file: the look, what is kept out, the palette and an optional addition per act. */
export const StyleSchema = z.object({
  look: z.string().min(1),
  keepOut: z.string().default(''),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a colour like #1a2b3c')).default([]),
  acts: z.record(z.string(), z.string().min(1)).default({}),
})

/** One of the user's own words, with the game's words they were written over. */
const OwnWords = z.object({ words: z.string().min(1), gameWas: z.string() })

/** The studio's own words for images and for the style, over the game's. */
export const PromptsSchema = z.object({
  images: z.record(z.string(), OwnWords).default({}),
  style: z.object({ look: OwnWords.optional(), keepOut: OwnWords.optional() }).default({}),
})

/** What a chosen take was made from; the lock records it, and staleness compares it. */
const MadeFromSchema = z.object({
  words: z.string(),
  style: z.string(),
  width: z.number(),
  height: z.number(),
})

/** The lock: the chosen take of each image. Take-making writes more here; only this is read. */
export const ChosenSchema = z.object({
  images: z.record(z.string(), z.object({ chosen: MadeFromSchema.optional() })).default({}),
})

/** An image of a game-written list. */
export type GameImage = z.infer<typeof ImageSchema>
/** The game's style. */
export type GameStyle = z.infer<typeof StyleSchema>
/** The studio's own words. */
export type Prompts = z.infer<typeof PromptsSchema>
/** What a take was made from, or what a new one would be made from. */
export type MadeFrom = z.infer<typeof MadeFromSchema>
/** A style field the user may write over. */
export type StyleField = 'look' | 'keepOut'

/** The style as an image of one act uses it: the user's words over the game's, plus the act's addition. */
export interface EffectiveStyle {
  look: string
  keepOut: string
  palette: string[]
  addition: string | null
}

/** The style an act's images are made with; null when the game has no style file. */
export function effectiveStyle(
  game: GameStyle | null,
  prompts: Prompts,
  partId: string,
): EffectiveStyle | null {
  if (!game) return null
  return {
    look: prompts.style.look?.words ?? game.look,
    keepOut: prompts.style.keepOut?.words ?? game.keepOut,
    palette: game.palette,
    addition: game.acts[partId] ?? null,
  }
}

/** The whole prompt: the words, the act's addition, the look, then what is kept out (empty parts left out). */
export function assemblePrompt(words: string, style: EffectiveStyle | null): string {
  if (!style) return words
  return [words, style.addition, style.look, style.keepOut ? `Kept out: ${style.keepOut}` : null]
    .filter((part): part is string => Boolean(part))
    .join('\n')
}

/** The style as one stable string, to compare what an image was made with. */
function styleKey(style: EffectiveStyle | null): string {
  return style ? JSON.stringify([style.look, style.keepOut, style.palette, style.addition]) : ''
}

/** What a new take of an image would be made from. */
export function madeFromNow(
  words: string,
  image: GameImage,
  style: EffectiveStyle | null,
): MadeFrom {
  return { words, style: styleKey(style), width: image.width, height: image.height }
}

/** What differs between what an image would be made from and what its chosen take was. */
export function outOfDateReasons(
  now: MadeFrom,
  chosen: MadeFrom,
): ('the words' | 'the size' | 'the style')[] {
  const reasons: ('the words' | 'the size' | 'the style')[] = []
  if (now.words !== chosen.words) reasons.push('the words')
  if (now.width !== chosen.width || now.height !== chosen.height) reasons.push('the size')
  if (now.style !== chosen.style) reasons.push('the style')
  return reasons
}

/** Prompts with the user's words for an image changed; empty text, or the game's own, removes them. */
export function applyWordsChange(
  prompts: Prompts,
  id: string,
  text: string | null,
  gameWords: string,
): Prompts {
  const words = (text ?? '').trim()
  const { [id]: _removed, ...rest } = prompts.images
  return {
    ...prompts,
    images:
      words === '' || words === gameWords.trim()
        ? rest
        : { ...rest, [id]: { words, gameWas: prompts.images[id]?.gameWas ?? gameWords } },
  }
}

/** Prompts with the user's words for a style field changed, as for an image. */
export function applyStyleChange(
  prompts: Prompts,
  field: StyleField,
  text: string | null,
  gameValue: string,
): Prompts {
  const words = (text ?? '').trim()
  const { [field]: _removed, ...rest } = prompts.style
  return {
    ...prompts,
    style:
      words === '' || words === gameValue.trim()
        ? rest
        : { ...rest, [field]: { words, gameWas: gameValue } },
  }
}

/** Settles an image whose game description changed: keep the user's words (new baseline) or take the game's. */
export function resolveCompare(
  prompts: Prompts,
  id: string,
  choice: 'keep' | 'game',
  gameWords: string,
): Prompts {
  const own = prompts.images[id]
  if (choice === 'game' || !own) return applyWordsChange(prompts, id, null, gameWords)
  return { ...prompts, images: { ...prompts.images, [id]: { ...own, gameWas: gameWords } } }
}

/** What differs between the style the user last saw and the game's now, named for the notice. */
export function styleChanges(
  seen: GameStyle,
  now: GameStyle,
  parts: { id: string; title: string }[],
): string[] {
  const changes: string[] = []
  if (seen.look !== now.look) changes.push('the look')
  if (seen.keepOut !== now.keepOut) changes.push('what is kept out')
  if (JSON.stringify(seen.palette) !== JSON.stringify(now.palette)) changes.push('the palette')
  for (const part of parts) {
    if ((seen.acts[part.id] ?? null) !== (now.acts[part.id] ?? null)) {
      changes.push(`the addition for ${part.title}`)
    }
  }
  return changes
}

/** The status chip of an image. */
export type ImageStatus = 'none yet' | 'chosen' | 'out of date'

/** One image as a page shows it. */
export interface ImageRow {
  id: string
  title: string
  partId: string
  description: string
  width: number
  height: number
  /** The words that will be used: the user's, else the game's. */
  words: string
  /** The user's own words are in use. */
  changed: boolean
  /** The game's description changed since the user wrote their own. */
  gameChanged: boolean
  /** The game's description when the user's words were written. */
  gameWas: string | null
  /** The whole prompt. */
  prompt: string
  /** What a new take would be made from. */
  madeFrom: MadeFrom
  status: ImageStatus
  reasons: ('the words' | 'the size' | 'the style')[]
}

/** What reading one act's list gave. */
export type ImageListState =
  { status: 'ok'; images: GameImage[] } | { status: 'missing' } | { status: 'invalid' }

/** An act's page. */
export interface ImagesAct {
  id: string
  title: string
  file: string
  state: 'ok' | 'missing' | 'invalid'
  addition: string | null
  rows: ImageRow[]
  chosen: number
  canRefresh: boolean
}

/** A style field as the Style page shows it. */
export interface StyleFieldView {
  words: string
  changed: boolean
  game: string
}

/** The Style page. */
export interface StyleView {
  present: boolean
  /** The game's style file is there but cannot be read. */
  invalid: boolean
  look: StyleFieldView
  keepOut: StyleFieldView
  palette: string[]
  acts: { id: string; title: string; addition: string | null }[]
}

/** The Images pages of a project. */
export interface ImagesSummary {
  acts: ImagesAct[]
  style: StyleView
  /** One notice for a change of the game's style; null when none is due. */
  styleNotice: { count: number; changed: string[] } | null
}

/** What `summarizeImages` is given. */
export interface ImagesInput {
  parts: { id: string; title: string }[]
  lists: { id: string; title: string; file: string; state: ImageListState; canRefresh: boolean }[]
  styleFile: string
  /** The style file is there but cannot be read. */
  styleInvalid?: boolean
  style: GameStyle | null
  prompts: Prompts
  /** What each image's chosen take was made from. */
  chosen: Record<string, MadeFrom>
  /** The game's style when the user last saw it; null before the first sight. */
  seen: GameStyle | null
}

/** The Images pages from what was read, and the problems found in it. */
export function summarizeImages(input: ImagesInput): {
  images: ImagesSummary
  problems: Problem[]
} {
  const { parts, lists, style, prompts, chosen } = input
  const problems: Problem[] = []
  const owners = new Map<string, string[]>()
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    list.state.images.forEach((image, index) => {
      owners.set(image.id, [...(owners.get(image.id) ?? []), `${list.file}\0[${index}].id`])
    })
  }
  const repeated = new Set<string>()
  for (const [id, places] of owners) {
    if (places.length < 2) continue
    repeated.add(id)
    for (const place of places) {
      const [file, path] = place.split('\0') as [string, string]
      problems.push({
        file,
        path,
        message: `the image id "${id}" is used more than once in the game's lists`,
      })
    }
  }
  for (const act of Object.keys(style?.acts ?? {})) {
    if (parts.some((part) => part.id === act)) continue
    problems.push({
      file: input.styleFile,
      path: `acts.${act}`,
      message: `"${act}" is not one of the project's parts`,
    })
  }

  let changedCount = 0
  const changes = style && input.seen ? styleChanges(input.seen, style, parts) : []
  const acts: ImagesAct[] = lists.map((list) => {
    const eff = effectiveStyle(style, prompts, list.id)
    const images =
      list.state.status === 'ok' ? list.state.images.filter((i) => !repeated.has(i.id)) : []
    const rows = images.map((image): ImageRow => {
      const own = prompts.images[image.id]
      const words = own?.words ?? image.description
      const madeFrom = madeFromNow(words, image, eff)
      const made = chosen[image.id]
      const reasons = made ? outOfDateReasons(madeFrom, made) : []
      if (made && made.style !== madeFrom.style && changes.length) changedCount++
      return {
        id: image.id,
        title: image.title,
        partId: list.id,
        description: image.description,
        width: image.width,
        height: image.height,
        words,
        changed: Boolean(own),
        gameChanged: Boolean(own) && own!.gameWas !== image.description,
        gameWas: own?.gameWas ?? null,
        prompt: assemblePrompt(words, eff),
        madeFrom,
        status: !made ? 'none yet' : reasons.length ? 'out of date' : 'chosen',
        reasons,
      }
    })
    return {
      id: list.id,
      title: list.title,
      file: list.file,
      state: list.state.status,
      addition: eff?.addition ?? null,
      rows,
      chosen: rows.filter((row) => row.status !== 'none yet').length,
      canRefresh: list.canRefresh,
    }
  })
  const field = (name: StyleField): StyleFieldView => ({
    words: prompts.style[name]?.words ?? style?.[name] ?? '',
    changed: Boolean(prompts.style[name]),
    game: style?.[name] ?? '',
  })
  return {
    images: {
      acts,
      style: {
        present: style !== null,
        invalid: input.styleInvalid ?? false,
        look: field('look'),
        keepOut: field('keepOut'),
        palette: style?.palette ?? [],
        acts: parts.map((part) => ({
          id: part.id,
          title: part.title,
          addition: style?.acts[part.id] ?? null,
        })),
      },
      styleNotice: changedCount > 0 ? { count: changedCount, changed: changes } : null,
    },
    problems,
  }
}

/** The body of a change to an image's own words; null takes them back. */
export const WordsBody = z.object({ words: z.string().nullable() }).strict()

/** The body of a change to one style field; null takes the user's words back. */
export const StyleFieldBody = z.union([
  z.object({ look: z.string().nullable() }).strict(),
  z.object({ keepOut: z.string().nullable() }).strict(),
])

/** The body of settling an image whose game description changed. */
export const CompareBody = z.object({ choice: z.enum(['keep', 'game']) }).strict()
