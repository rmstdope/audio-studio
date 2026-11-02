import { z } from 'zod'
import { describeLook, lookChanges, lookKey, type Look } from './imageLook'
import type { Problem } from './project'

/** The path of the picture the game shows for an image now: inside the project root, and a picture. */
const GameFile = z
  .string()
  .min(1)
  .refine((file) => !/^([/\\]|[a-z]:)/i.test(file) && !file.split(/[/\\]/).includes('..'), {
    error: 'use a path inside the project (no leading / and no ..)',
  })
  .refine((file) => /\.(png|jpe?g|gif|webp)$/i.test(file), {
    error: 'use a picture (.png, .jpg, .gif or .webp)',
  })

/** An image as the game lists it. The id names the image everywhere, so it is a slug. */
export const ImageSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'use lower-case letters, digits and - only'),
  title: z.string().min(1),
  description: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The picture the game shows for it now, when it is not one the studio made. Read only. */
  file: GameFile.optional(),
})

/** An act's images, in the game's order (a list that is there and empty means the game asks for none). */
export const ImageListSchema = z.array(ImageSchema)

/** The game's style file: the look, what is kept out, the palette and an optional addition per act. */
export const StyleSchema = z.object({
  look: z.string().min(1),
  keepOut: z.string().default(''),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a colour like #1a2b3c')).default([]),
  /** How many colours the game's pictures have when no palette is listed; absent means full colour. */
  colourDepth: z.enum(['full', '16-bit', '8-bit']).optional(),
  /** How in-between shades are made when colours are reduced; absent means patterned. */
  dithering: z.enum(['flat', 'patterned', 'scattered']).optional(),
  acts: z.record(z.string(), z.string().min(1)).default({}),
})

/** One of the user's own words, with the game's words they were written over. */
const OwnWords = z.object({ words: z.string().min(1), gameWas: z.string() })

/** The studio's own words for images and for the style, over the game's. */
export const PromptsSchema = z.object({
  images: z.record(z.string(), OwnWords).default({}),
  style: z.object({ look: OwnWords.optional(), keepOut: OwnWords.optional() }).default({}),
  /** Ids of the images that leave their act's style addition out of the prompt (kept while the act has none). */
  actStyleOff: z.array(z.string()).optional(),
  /** For an image several acts list: the act whose style addition it uses (absent: the first act that lists it). */
  actStyleFrom: z.record(z.string(), z.string()).optional(),
})

/** What a chosen take was made from; the lock records it, and staleness compares it. */
const MadeFromSchema = z.object({
  words: z.string(),
  style: z.string(),
  width: z.number(),
  height: z.number(),
})

/** What the lock keeps of the chosen take: what it was made from, and which take it is. */
export const ChosenEntrySchema = MadeFromSchema.extend({
  /** The number of the take on the image's board. */
  take: z.number().int().positive().optional(),
  seed: z.number().optional(),
  model: z.string().optional(),
  /** What the game's picture was brought to (`lookKey`); absent for one chosen before looks. */
  look: z.string().optional(),
  /** When it was chosen (ISO time). */
  at: z.string().optional(),
})

/** The lock: the chosen take of each image. Other keys are ignored here, and kept when it is written. */
export const ChosenSchema = z.object({
  images: z.record(z.string(), z.object({ chosen: ChosenEntrySchema.optional() })).default({}),
})

/** An image of a game-written list. */
export type GameImage = z.infer<typeof ImageSchema>
/** The game's style. */
export type GameStyle = z.infer<typeof StyleSchema>
/** The studio's own words. */
export type Prompts = z.infer<typeof PromptsSchema>
/** What a take was made from, or what a new one would be made from. */
export type MadeFrom = z.infer<typeof MadeFromSchema>
/** An image's chosen take in the lock. */
export type ChosenEntry = z.infer<typeof ChosenEntrySchema>
/** A style field the user may write over. */
export type StyleField = 'look' | 'keepOut'

/** The style as an image of one act uses it: the user's words over the game's, plus the act's addition. */
export interface EffectiveStyle {
  look: string
  keepOut: string
  palette: string[]
  addition: string | null
}

/** The style an image of an act is made with (the act's own without an image); null when the game has no style file. */
export function effectiveStyle(
  game: GameStyle | null,
  prompts: Prompts,
  partId: string,
  imageId?: string,
): EffectiveStyle | null {
  if (!game) return null
  const left = imageId !== undefined && Boolean(prompts.actStyleOff?.includes(imageId))
  return {
    look: prompts.style.look?.words ?? game.look,
    keepOut: prompts.style.keepOut?.words ?? game.keepOut,
    palette: game.palette,
    addition: left ? null : (game.acts[partId] ?? null),
  }
}

/** The whole prompt: the words, the act's addition, the look, then what is kept out (empty parts left out). */
export function assemblePrompt(words: string, style: EffectiveStyle | null): string {
  if (!style) return words
  return [words, style.addition, style.look, style.keepOut ? `Kept out: ${style.keepOut}` : null]
    .filter((part): part is string => Boolean(part))
    .join('\n')
}

/**
 * The style as one stable string, to compare what an image was made with. The palette, colour depth
 * and dithering are not in it: they decide how a take is brought to the game's look, not what the
 * model is asked for, so a change of them never needs a take made again.
 */
function styleKey(style: EffectiveStyle | null): string {
  return style ? JSON.stringify([style.look, style.keepOut, style.addition]) : ''
}

/** What a new take of an image would be made from. */
export function madeFromNow(
  words: string,
  image: GameImage,
  style: EffectiveStyle | null,
): MadeFrom {
  return { words, style: styleKey(style), width: image.width, height: image.height }
}

/**
 * A style key without the palette: keys written before the palette left the prompt's style held
 * it as a third entry, which must not make a picture chosen then look out of date.
 */
function withoutPalette(key: string): string {
  try {
    const parts: unknown = JSON.parse(key)
    if (Array.isArray(parts) && parts.length === 4) {
      return JSON.stringify([parts[0], parts[1], parts[3]])
    }
  } catch {
    // not a key of ours: compared as it is
  }
  return key
}

/** What differs between what an image would be made from and what its chosen take was. */
export function outOfDateReasons(now: MadeFrom, chosen: MadeFrom): ImageReason[] {
  const reasons: ImageReason[] = []
  if (now.words !== chosen.words) reasons.push('the words')
  if (now.width !== chosen.width || now.height !== chosen.height) reasons.push('the size')
  const [a, b] = [withoutPalette(now.style), withoutPalette(chosen.style)]
  if (a !== b) {
    const [pa, pb] = [styleParts(a), styleParts(b)]
    if (!pa || !pb) reasons.push('the style')
    else {
      if (pa[0] !== pb[0] || pa[1] !== pb[1]) reasons.push('the style')
      if (pa[2] !== pb[2]) reasons.push('the act style')
    }
  }
  return reasons
}

/** What makes an image out of date; 'the act style' is the act's addition, which the page names with the act. */
export type ImageReason = 'the words' | 'the size' | 'the style' | 'the act style'

/** A style key as its look, kept-out and addition; null for a key that is not one of ours. */
function styleParts(key: string): unknown[] | null {
  try {
    const parts: unknown = JSON.parse(key)
    return Array.isArray(parts) && parts.length === 3 ? parts : null
  } catch {
    return null
  }
}

/** Prompts with an image's use of its act's style addition changed; ticked again removes the id. */
export function applyActStyleChange(prompts: Prompts, id: string, on: boolean): Prompts {
  const others = (prompts.actStyleOff ?? []).filter((other) => other !== id)
  const off = (on ? others : [...others, id]).sort()
  const { actStyleOff: _removed, ...rest } = prompts
  return off.length ? { ...rest, actStyleOff: off } : rest
}

/** Prompts with the act whose style a shared image uses changed: null leaves the style out, an act takes it from that act. */
export function applyActStylePick(prompts: Prompts, id: string, from: string | null): Prompts {
  const base = applyActStyleChange(prompts, id, from !== null)
  const { [id]: _removed, ...others } = base.actStyleFrom ?? {}
  const { actStyleFrom: _old, ...rest } = base
  const kept = from === null ? others : { ...others, [id]: from }
  return Object.keys(kept).length ? { ...rest, actStyleFrom: kept } : rest
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
  for (const part of parts) {
    if ((seen.acts[part.id] ?? null) !== (now.acts[part.id] ?? null)) {
      changes.push(`the addition for ${part.title}`)
    }
  }
  return changes
}

/** What differs in the looks the pictures were brought to and the look now, each named once, in a fixed order. */
function lookChangeNames(pairs: [string | null, string][]): string[] {
  const names = new Set(pairs.flatMap(([then, now]) => lookChanges(then, now)))
  const order = ['its palette', 'its colour depth', 'its dithering', "an image's size", 'its look']
  return order.filter((name) => names.has(name))
}

/** How a problem names each thing the lists can disagree about. */
const KIND_PHRASE: Record<ConflictKind, string> = {
  words: 'other words',
  sizes: 'another size',
  names: 'another name',
}

/** What differs between the listings of one image, in the order words, sizes, names. */
function differences(images: GameImage[]): ConflictKind[] {
  const [first, ...rest] = images
  const kinds: ConflictKind[] = []
  if (rest.some((i) => i.description !== first!.description)) kinds.push('words')
  if (rest.some((i) => i.width !== first!.width || i.height !== first!.height)) kinds.push('sizes')
  if (rest.some((i) => i.title !== first!.title)) kinds.push('names')
  return kinds
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
  /**
   * The act's style addition and whether this image uses it; null when the act adds none. For an
   * image several acts list: the addition it uses, `choices` the listing acts that add one and
   * `pick` the act it is taken from (null: none); null when no listing act adds one.
   */
  actStyle: { text: string; on: boolean; pick?: string | null; choices?: ActStyleChoice[] } | null
  /** The other acts that list this image, in the game's order; empty for an image of one act. */
  sharedWith: { id: string; title: string }[]
  /** For a shared image out of date because of its act style: the acts now and when it was chosen (null: none). */
  actStyleChange: { now: string | null; was: string | null } | null
  /** The number of the chosen take on the image's board; null when none is chosen. */
  chosenTake: number | null
  /** The picture the game itself shows for it, and whether it is on disk; null when it names none. */
  gameFile: { file: string; exists: boolean } | null
  /** What a new take would be made from. */
  madeFrom: MadeFrom
  status: ImageStatus
  reasons: ImageReason[]
  /** The game's look for this image: the line under its title, what it is brought to, or why it cannot be. */
  look: { line: string; key: string | null; error: string | null }
  /** The game's picture, or one of the takes, was brought to another look than the style asks for now. */
  looksOld: boolean
}

/** An act of a shared image that adds a style, and what it adds. */
export interface ActStyleChoice {
  id: string
  title: string
  text: string
}

/** What the acts' lists can disagree about for one image. */
export type ConflictKind = 'words' | 'sizes' | 'names'

/** An image that several acts list differently: shown in none of them, but in place in each. */
export interface ImageConflict {
  id: string
  title: string
  /** Every act that lists it, in the game's order. */
  acts: { id: string; title: string }[]
  differs: ConflictKind[]
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
  /** Images the acts' lists disagree about (not among the rows). */
  conflicts: ImageConflict[]
  /** The ids of the list in the game's order, rows and conflicts alike. */
  order: string[]
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
  /** One notice for a change of the game's look; null when every picture is up to date. */
  lookNotice: { count: number; changed: string[] } | null
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
  /** What each image's chosen take was made from, and which take it is. */
  chosen: Record<string, ChosenEntry>
  /** Whether the file each image names as the game's own is there, by image id. */
  gameFiles?: Record<string, boolean>
  /** The game's style when the user last saw it; null before the first sight. */
  seen: GameStyle | null
  /** The look the style asks for; null when it cannot be used (`lookError` says why). */
  look?: Look | null
  lookError?: string
  /** What each image's takes (whose model picture is there) were brought to, by image id; null for never. */
  takeLooks?: Record<string, (string | null)[]>
}

/** The Images pages from what was read, and the problems found in it. */
export function summarizeImages(input: ImagesInput): {
  images: ImagesSummary
  problems: Problem[]
} {
  const { parts, lists, style, prompts, chosen } = input
  const problems: Problem[] = []
  type Listing = { list: ImagesInput['lists'][number]; index: number; image: GameImage }
  const listed = new Map<string, Listing[]>()
  for (const list of lists) {
    if (list.state.status !== 'ok') continue
    list.state.images.forEach((image, index) => {
      listed.set(image.id, [...(listed.get(image.id) ?? []), { list, index, image }])
    })
  }
  /** Ids used twice in one list: a problem with every place, shown nowhere. */
  const repeated = new Set<string>()
  /** Ids the lists give differently, with what differs. */
  const conflicting = new Map<string, ConflictKind[]>()
  for (const [id, places] of listed) {
    if (places.length < 2) continue
    if (new Set(places.map((place) => place.list.id)).size < places.length) {
      repeated.add(id)
      for (const { list, index } of places) {
        problems.push({
          file: list.file,
          path: `[${index}].id`,
          message: `the image id "${id}" is used more than once in the game's lists`,
        })
      }
      continue
    }
    const differs = differences(places.map((place) => place.image))
    if (!differs.length) continue
    conflicting.set(id, differs)
    for (const place of places) {
      const other = places.find((o) => differences([place.image, o.image]).length)!
      const kinds = differences([place.image, other.image]).map((kind) => KIND_PHRASE[kind])
      problems.push({
        file: place.list.file,
        path: `[${place.index}].id`,
        message: `the image "${id}" has ${kinds.join(' and ')} in ${other.list.file}`,
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

  const changedIds = new Set<string>()
  const oldIds = new Set<string>()
  const lookPairs: [string | null, string][] = []
  const changes = style && input.seen ? styleChanges(input.seen, style, parts) : []
  /** An image's row as first met; a shared image reuses it in every act. */
  const bases = new Map<string, ImageRow>()
  const baseRow = (list: ImagesInput['lists'][number], image: GameImage): ImageRow => {
    const known = bases.get(image.id)
    if (known) return known
    const group = (listed.get(image.id) ?? []).map((place) => place.list)
    const choices: ActStyleChoice[] = group.flatMap((g) => {
      const text = style?.acts[g.id]
      return text ? [{ id: g.id, title: g.title, text }] : []
    })
    const shared = group.length > 1
    const off = Boolean(prompts.actStyleOff?.includes(image.id))
    const wanted = prompts.actStyleFrom?.[image.id]
    const first = group[0]!.id
    const pick = off
      ? null
      : (choices.find((c) => c.id === wanted)?.id ??
        (choices.some((c) => c.id === first) ? first : null))
    const styleAct = shared ? (pick ?? first) : list.id
    const actEff = effectiveStyle(style, prompts, styleAct)
    const eff = effectiveStyle(style, prompts, styleAct, image.id)
    const own = prompts.images[image.id]
    const words = own?.words ?? image.description
    const madeFrom = madeFromNow(words, image, eff)
    const made = chosen[image.id]
    const reasons = made ? outOfDateReasons(madeFrom, made) : []
    const look =
      input.look === undefined
        ? ({ colours: { kind: 'full' }, dithering: 'patterned' } as Look)
        : input.look
    const key = look ? lookKey(look, image) : null
    const thens: (string | null)[] = [
      ...(made ? [made.look ?? null] : []),
      ...(input.takeLooks?.[image.id] ?? []),
    ].filter((then, at, all) => all.indexOf(then) === at)
    const stale = key === null ? [] : thens.filter((then) => then !== key)
    for (const then of stale) lookPairs.push([then, key!])
    if (stale.length) oldIds.add(image.id)
    if (made && made.style !== madeFrom.style && changes.length) changedIds.add(image.id)
    const wasText = made ? styleParts(withoutPalette(made.style))?.[2] : null
    const row: ImageRow = {
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
      actStyle: shared
        ? choices.length
          ? { text: eff?.addition ?? '', on: pick !== null, pick, choices }
          : null
        : actEff?.addition
          ? { text: actEff.addition, on: eff?.addition != null }
          : null,
      sharedWith: [],
      actStyleChange:
        shared && reasons.includes('the act style')
          ? { now: pick, was: choices.find((c) => c.text === wasText)?.id ?? null }
          : null,
      chosenTake: made?.take ?? null,
      gameFile: image.file
        ? { file: image.file, exists: input.gameFiles?.[image.id] ?? false }
        : null,
      madeFrom,
      status: !made ? 'none yet' : reasons.length ? 'out of date' : 'chosen',
      reasons,
      look: {
        line: describeLook(look, image),
        key,
        error: look ? null : (input.lookError ?? "Can't bring this take to the game's look."),
      },
      looksOld: stale.length > 0,
    }
    bases.set(image.id, row)
    return row
  }
  const acts: ImagesAct[] = lists.map((list) => {
    const actEff = effectiveStyle(style, prompts, list.id)
    const images = list.state.status === 'ok' ? list.state.images : []
    const rows: ImageRow[] = []
    const conflicts: ImageConflict[] = []
    const order: string[] = []
    for (const image of images) {
      if (repeated.has(image.id)) continue
      order.push(image.id)
      const group = (listed.get(image.id) ?? []).map((p) => ({
        id: p.list.id,
        title: p.list.title,
      }))
      const differs = conflicting.get(image.id)
      if (differs) {
        conflicts.push({ id: image.id, title: image.title, acts: group, differs })
        continue
      }
      rows.push({
        ...baseRow(list, image),
        partId: list.id,
        sharedWith: group.filter((g) => g.id !== list.id),
      })
    }
    return {
      id: list.id,
      title: list.title,
      file: list.file,
      state: list.state.status,
      addition: actEff?.addition ?? null,
      rows,
      conflicts,
      order,
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
      styleNotice: changedIds.size > 0 ? { count: changedIds.size, changed: changes } : null,
      lookNotice:
        oldIds.size > 0 ? { count: oldIds.size, changed: lookChangeNames(lookPairs) } : null,
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

/** The body of a change to an image's use of its act's style. */
export const ActStyleBody = z.union([
  z.object({ on: z.boolean() }).strict(),
  z.object({ from: z.string().nullable() }).strict(),
])
