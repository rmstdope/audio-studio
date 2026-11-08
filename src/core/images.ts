import { z } from 'zod'
import { describeLook, lookChanges, lookKey, lookOf, type Look } from './imageLook'
import { problemsFrom, type Problem } from './project'

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

/** The slug rule for the ids of images and of their patches. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

/** A patch the game asks for on an image: a small change laid over it. The words are `text` in the game's list. */
const GamePatchSchema = z
  .object({
    id: z.string().regex(SLUG, 'use lower-case letters, digits and - only'),
    title: z.string().min(1),
    /** What should change, in the game's words. */
    text: z.string().min(1),
  })
  .transform(({ text, ...patch }) => ({ ...patch, description: text }))

/** A patch the game asks for on an image; its words are its description inside the studio. */
export type GamePatch = z.infer<typeof GamePatchSchema>

/** A named area the game wants placed on an image: an id and a title, never where it is. */
const GameAreaSchema = z.object({
  id: z.string().regex(SLUG, 'use lower-case letters, digits and - only'),
  title: z.string().min(1),
})

/** A named area the game declares on an image. */
export type GameArea = z.infer<typeof GameAreaSchema>

/** Refines a list of things with ids: an id may be used once, or the later use is a problem at its place. */
function uniqueIds(what: string) {
  return (items: { id: string }[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>()
    items.forEach((item, at) => {
      if (seen.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [at, 'id'],
          message: `the ${what} id "${item.id}" is used more than once in this image`,
        })
      }
      seen.add(item.id)
    })
  }
}

/** An image as the game lists it. The id names the image everywhere, so it is a slug. */
const ImageShape = z.object({
  id: z.string().regex(SLUG, 'use lower-case letters, digits and - only'),
  title: z.string().min(1),
  /** What the image shows, in the game's words. */
  text: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** The picture the game shows for it now, when it is not one the studio made. Read only. */
  file: GameFile.optional(),
  /** The patches the game asks for on it, in its order; an id may be used once. */
  patches: z.array(GamePatchSchema).default([]).superRefine(uniqueIds('patch')),
  /** The named areas the game wants placed on it, in its order; an id may be used once. */
  areas: z.array(GameAreaSchema).default([]).superRefine(uniqueIds('area')),
})

/**
 * An image of a list the game writes. The game's words (`text`) are the image's description inside
 * the studio, its pages and its API.
 */
export const ImageSchema = ImageShape.transform(({ text, ...image }) => ({
  ...image,
  description: text,
}))

/** An act's images, in the game's order (a list that is there and empty means the game asks for none). */
export const ImageListSchema = z.array(ImageSchema)

/**
 * The style every image shares, the studio's own: the look, what is kept out, the palette, and an
 * optional addition per part. It is in the images edits and edited directly.
 */
export const StyleSchema = z.object({
  look: z.string().min(1),
  keepOut: z.string().default(''),
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, 'use a colour like #1a2b3c')).default([]),
  /** How many colours the game's pictures have when no palette is listed; absent means full colour. */
  colourDepth: z.enum(['full', '16-bit', '8-bit']).optional(),
  /** How in-between shades are made when colours are reduced; absent means patterned. */
  dithering: z.enum(['flat', 'patterned', 'scattered']).optional(),
  /** A part's addition to the look, by part id. */
  parts: z.record(z.string(), z.string().min(1)).default({}),
})

/** The user's words for one patch over the game's, with the game's words they were written over. */
const PatchEditSchema = z.object({ text: z.string().min(1), gameWas: z.string() })

/** The smallest side of a box marked for a named area, in the image's pixels. */
export const MIN_AREA_SIZE = 4

/** Where a named area is on its image: a rectangle in the image's own pixels (the game's size). */
const AreaBoxSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int(),
    height: z.number().int(),
  })
  .strict()

/** A box marked for a named area. */
export type AreaBox = z.infer<typeof AreaBoxSchema>

/** Why a box cannot be kept on an image of this size (outside it, not whole pixels, too small); null when it can. */
export function checkAreaBox(box: AreaBox, size: { width: number; height: number }): string | null {
  const whole = [box.x, box.y, box.width, box.height].every(Number.isInteger)
  if (!whole) return 'a box is made of whole pixels'
  if (box.width < MIN_AREA_SIZE || box.height < MIN_AREA_SIZE) {
    return `a box is at least ${MIN_AREA_SIZE} pixels each way`
  }
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > size.width ||
    box.y + box.height > size.height
  ) {
    return 'a box lies inside the picture'
  }
  return null
}

/**
 * The studio's change to one image: its own words over the game's (`text`, with the game's words
 * it was written over, `gameWas`), which part's addition it uses (`partStyle`: a part id, or
 * null for none; absent is the first part that lists it), and its own words for the patches the
 * game asks for (`patches`, by patch id, kept even when the game stops asking for one), and the
 * boxes marked for its named areas (`areas`, by area id, kept likewise).
 */
const ImageEditSchema = z
  .object({
    text: z.string().min(1).optional(),
    gameWas: z.string().optional(),
    partStyle: z.string().nullable().optional(),
    patches: z.record(z.string(), PatchEditSchema).optional(),
    areas: z.record(z.string(), AreaBoxSchema).optional(),
  })
  .refine((edit) => (edit.text === undefined) === (edit.gameWas === undefined), {
    error: 'give text and gameWas together',
  })

/** `content-studio/images/edits.json`: the style every image shares, and the studio's changes to images. */
export const ImageEditsSchema = z.object({
  style: StyleSchema.optional(),
  images: z.record(z.string(), ImageEditSchema).default({}),
})

/** What reading the images edits gave: what could be used, whether the style could not, and why. */
export interface ImageEditsRead {
  edits: ImageEdits
  /** There is a style, but it cannot be read (its problems are among `problems`). */
  styleBroken: boolean
  problems: Problem[]
}

/**
 * The images edits from their JSON, the style and each image checked apart: a bad image is left
 * out with a problem at its path, and a bad style is none (with `styleBroken`), so the rest stays
 * usable. A file that is not an object holds nothing usable.
 */
export function readImageEditsValue(raw: unknown, file: string): ImageEditsRead {
  const problems: Problem[] = []
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (!isObject(raw)) {
    problems.push({ file, path: '', message: 'must be an object' })
    return { edits: { images: {} }, styleBroken: true, problems }
  }
  const style = z.object({ style: StyleSchema.optional() }).safeParse({ style: raw.style })
  if (!style.success) problems.push(...problemsFrom(file, style.error))
  const images: ImageEdits['images'] = {}
  if (raw.images !== undefined && !isObject(raw.images)) {
    problems.push({ file, path: 'images', message: 'must be an object, by image id' })
  } else {
    for (const [id, entry] of Object.entries(raw.images ?? {})) {
      const one = z.object({ images: z.record(z.string(), ImageEditSchema) })
      const read = one.safeParse({ images: { [id]: entry } })
      if (read.success) images[id] = read.data.images[id]!
      else problems.push(...problemsFrom(file, read.error))
    }
  }
  return {
    edits: { ...(style.data?.style && { style: style.data.style }), images },
    styleBroken: !style.success,
    problems,
  }
}

/**
 * The images edits as text: the style first, its keys in a fixed order and those at their default
 * left out, then the images by id, so changes make small diffs.
 */
export function formatImageEdits(edits: ImageEdits): string {
  const out: Record<string, unknown> = {}
  if (edits.style) {
    const { look, keepOut, palette, colourDepth, dithering, parts } = edits.style
    out.style = {
      look,
      ...(keepOut !== '' && { keepOut }),
      ...(palette.length && { palette }),
      ...(colourDepth && { colourDepth }),
      ...(dithering && { dithering }),
      ...(Object.keys(parts).length && { parts }),
    }
  }
  out.images = Object.fromEntries(
    Object.keys(edits.images)
      .sort()
      .map((id) => {
        const { text, gameWas, partStyle, patches, areas } = edits.images[id]!
        const sorted =
          patches &&
          Object.fromEntries(
            Object.keys(patches)
              .sort()
              .map((patch) => [patch, patches[patch]]),
          )
        const boxes =
          areas &&
          Object.fromEntries(
            Object.keys(areas)
              .sort()
              .map((area) => {
                const { x, y, width, height } = areas[area]!
                return [area, { x, y, width, height }]
              }),
          )
        return [id, { text, gameWas, partStyle, patches: sorted, areas: boxes }]
      }),
  )
  return `${JSON.stringify(out, null, 2)}\n`
}

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

/**
 * What a chosen picture was brought to, as the style's own fields, and the size it was brought to
 * when that is not the entry's own (a take made before the game's list changed its size).
 */
const LockLookSchema = z.object({
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  colourDepth: z.enum(['full', '16-bit', '8-bit']).optional(),
  dithering: z.enum(['flat', 'patterned', 'scattered']).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
})

/** One entry of `content-studio/images/lock.json`: the chosen take, and what it was made from in the clear. */
const LockEntrySchema = z.object({
  model: z.string().optional(),
  seed: z.number().optional(),
  take: z.number().int().positive().optional(),
  inputs: z.object({
    text: z.string(),
    width: z.number(),
    height: z.number(),
    /** The words the take was made with; absent for a take made without a style. */
    style: z
      .object({ look: z.string(), keepOut: z.string(), part: z.string().nullable() })
      .optional(),
    /** What the game's picture was brought to; absent for one never brought. */
    look: LockLookSchema.optional(),
  }),
  at: z.string().optional(),
})

/**
 * The images lock, keyed by image id, read as what each chosen take was made from: the style and
 * the look turned back into the stable keys staleness compares (`styleKey`, `lookKey`).
 */
export const ImageLockSchema = z.record(
  z.string(),
  LockEntrySchema.transform(({ inputs, model, seed, take, at }): ChosenEntry => {
    const { text, width, height, style, look } = inputs
    const lookFields = look && { palette: look.palette ?? [], ...look }
    const lookSize = { width: look?.width ?? width, height: look?.height ?? height }
    return {
      words: text,
      style: style ? JSON.stringify([style.look, style.keepOut, style.part]) : '',
      width,
      height,
      ...(take !== undefined && { take }),
      ...(seed !== undefined && { seed }),
      ...(model !== undefined && { model }),
      ...(lookFields && { look: lookKey(lookOf(lookFields), lookSize) }),
      ...(at !== undefined && { at }),
    }
  }),
)

/** The images lock as the studio reads it: the chosen take of each image. */
export type ImageLock = z.infer<typeof ImageLockSchema>

/**
 * A look key (`lookKey`) as the style's own fields, with its size when it is not `size` (the
 * entry's); null for one that is not a key of ours.
 */
function lookFields(
  key: string,
  size: { width: number; height: number },
): z.infer<typeof LockLookSchema> | null {
  try {
    const { w, h, c, d } = JSON.parse(key) as { w: unknown; h: unknown; c: unknown; d: unknown }
    const dithering = LockLookSchema.shape.dithering.safeParse(d).data
    const other =
      typeof w === 'number' && typeof h === 'number' && (w !== size.width || h !== size.height)
        ? { width: w, height: h }
        : {}
    if (Array.isArray(c)) {
      const hex = (rgb: unknown) =>
        `#${String(rgb)
          .split(',')
          .map((n) => Number(n).toString(16).padStart(2, '0'))
          .join('')}`
      return { palette: c.map(hex), ...(dithering && { dithering }), ...other }
    }
    if (c === 8 || c === 16) {
      return { colourDepth: `${c}-bit`, ...(dithering && { dithering }), ...other }
    }
    if (c === 'full') return { colourDepth: 'full', ...other }
  } catch {
    // not a key of ours
  }
  return null
}

/**
 * The images lock as text: one entry per line in id order, each `{ model, seed, take, inputs, at }`
 * with what the take was made from in the clear, so choosing a take is a one-line change.
 */
export function formatImageLock(lock: ImageLock): string {
  const ids = Object.keys(lock).sort()
  if (!ids.length) return '{}\n'
  const lines = ids.map((id) => {
    const { words, style, width, height, take, seed, model, look, at } = lock[id]!
    const parts = style ? styleParts(withoutPalette(style)) : null
    const looked = look === undefined ? null : lookFields(look, { width, height })
    const entry = {
      model,
      seed,
      take,
      inputs: {
        text: words,
        width,
        height,
        ...(parts && {
          style: { look: parts[0], keepOut: parts[1], part: parts[2] ?? null },
        }),
        ...(looked && { look: looked }),
      },
      at,
    }
    return ` ${JSON.stringify(id)}: ${JSON.stringify(entry)}`
  })
  return `{\n${lines.join(',\n')}\n}\n`
}

/** An image of a game-written list. */
export type GameImage = z.infer<typeof ImageSchema>
/** The style every image shares. */
export type ImageStyle = z.infer<typeof StyleSchema>
/** The images edits: the style, and the studio's changes to images. */
export type ImageEdits = z.infer<typeof ImageEditsSchema>
/** The studio's change to one image. */
export type ImageEdit = ImageEdits['images'][string]
/** What a take was made from, or what a new one would be made from. */
export type MadeFrom = z.infer<typeof MadeFromSchema>
/** An image's chosen take in the lock. */
export type ChosenEntry = z.infer<typeof ChosenEntrySchema>
/** A style field the user may write over. */
export type StyleField = 'look' | 'keepOut'

/** The style as an image of one part uses it: the look, what is kept out, the palette, plus the part's addition. */
export interface EffectiveStyle {
  look: string
  keepOut: string
  palette: string[]
  addition: string | null
}

/** The style an image of a part is made with; `leaveOut` leaves the part's addition out. Null without a style. */
export function effectiveStyle(
  style: ImageStyle | null,
  partId: string,
  leaveOut = false,
): EffectiveStyle | null {
  if (!style) return null
  return {
    look: style.look,
    keepOut: style.keepOut,
    palette: style.palette,
    addition: leaveOut ? null : (style.parts[partId] ?? null),
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

/** The edits with one image's edit replaced; an edit left with nothing in it is removed. */
function withImage(edits: ImageEdits, id: string, edit: ImageEdit): ImageEdits {
  const { [id]: _removed, ...rest } = edits.images
  const kept = Object.values(edit).some((value) => value !== undefined)
  return { ...edits, images: kept ? { ...rest, [id]: edit } : rest }
}

/** The edits with an image's use of its part's style addition changed: off is `partStyle: null`, ticked again removes it. */
export function applyActStyleChange(edits: ImageEdits, id: string, on: boolean): ImageEdits {
  const { partStyle: _old, ...edit } = edits.images[id] ?? {}
  return withImage(edits, id, on ? edit : { ...edit, partStyle: null })
}

/** The edits with the part whose style a shared image uses changed: null leaves the style out, a part takes it from that part. */
export function applyActStylePick(edits: ImageEdits, id: string, from: string | null): ImageEdits {
  return withImage(edits, id, { ...edits.images[id], partStyle: from })
}

/** The edits with the user's words for an image changed; empty text, or the game's own, removes them. */
export function applyWordsChange(
  edits: ImageEdits,
  id: string,
  text: string | null,
  gameWords: string,
): ImageEdits {
  const words = (text ?? '').trim()
  const { text: _text, gameWas, ...rest } = edits.images[id] ?? {}
  return withImage(
    edits,
    id,
    words === '' || words === gameWords.trim()
      ? rest
      : { text: words, gameWas: gameWas ?? gameWords, ...rest },
  )
}

/**
 * The edits with the style's look or what is kept out set; an empty kept-out is none. Refused,
 * with why, without a style (`no style`) and for an empty look (`empty look`).
 */
export function applyStyleChange(
  edits: ImageEdits,
  field: StyleField,
  text: string | null,
): ImageEdits | 'no style' | 'empty look' {
  const words = (text ?? '').trim()
  if (!edits.style) return 'no style'
  if (field === 'look' && words === '') return 'empty look'
  return { ...edits, style: { ...edits.style, [field]: words } }
}

/** The edits with the box of one named area of an image set, replaced or (null) taken away. */
export function applyAreaBox(
  edits: ImageEdits,
  id: string,
  area: string,
  box: AreaBox | null,
): ImageEdits {
  const { areas, ...rest } = edits.images[id] ?? {}
  const { [area]: _old, ...others } = areas ?? {}
  const next = box ? { ...others, [area]: box } : others
  return withImage(edits, id, Object.keys(next).length ? { ...rest, areas: next } : rest)
}

/** The edits with the user's words for one patch of an image set, or taken back (`words` undefined). */
function withPatch(
  edits: ImageEdits,
  id: string,
  patch: string,
  words: z.infer<typeof PatchEditSchema> | undefined,
): ImageEdits {
  const { patches, ...rest } = edits.images[id] ?? {}
  const { [patch]: _old, ...others } = patches ?? {}
  const next = words ? { ...others, [patch]: words } : others
  return withImage(edits, id, Object.keys(next).length ? { ...rest, patches: next } : rest)
}

/** The edits with the user's words for one patch of an image changed; empty text, or the game's own, takes them back. */
export function applyPatchWordsChange(
  edits: ImageEdits,
  id: string,
  patch: string,
  text: string | null,
  gameWords: string,
): ImageEdits {
  const words = (text ?? '').trim()
  const was = edits.images[id]?.patches?.[patch]?.gameWas
  return withPatch(
    edits,
    id,
    patch,
    words === '' || words === gameWords.trim()
      ? undefined
      : { text: words, gameWas: was ?? gameWords },
  )
}

/** Settles a patch whose game words changed: keep the user's words (new baseline) or take the game's. */
export function resolvePatchCompare(
  edits: ImageEdits,
  id: string,
  patch: string,
  choice: 'keep' | 'game',
  gameWords: string,
): ImageEdits {
  const own = edits.images[id]?.patches?.[patch]
  if (choice === 'game' || own === undefined) {
    return applyPatchWordsChange(edits, id, patch, null, gameWords)
  }
  return withPatch(edits, id, patch, { ...own, gameWas: gameWords })
}

/** Settles an image whose game description changed: keep the user's words (new baseline) or take the game's. */
export function resolveCompare(
  edits: ImageEdits,
  id: string,
  choice: 'keep' | 'game',
  gameWords: string,
): ImageEdits {
  const own = edits.images[id]
  if (choice === 'game' || own?.text === undefined) {
    return applyWordsChange(edits, id, null, gameWords)
  }
  return withImage(edits, id, { ...own, gameWas: gameWords })
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
  patches: 'other patches',
  'named areas': 'other named areas',
  sizes: 'another size',
  names: 'another name',
}

/** An image's patches as one string, by id, so the same patches in another order are the same. */
function patchesKey(image: GameImage): string {
  return JSON.stringify(
    image.patches
      .map(({ id, title, description }) => [id, title, description])
      .sort(([a], [b]) => (a! < b! ? -1 : 1)),
  )
}

/** An image's named areas as one string, by id, so the same areas in another order are the same. */
function areasKey(image: GameImage): string {
  return JSON.stringify(
    image.areas.map(({ id, title }) => [id, title]).sort(([a], [b]) => (a! < b! ? -1 : 1)),
  )
}

/** What differs between the listings of one image, in the order words, sizes, names, patches, named areas. */
function differences(images: GameImage[]): ConflictKind[] {
  const [first, ...rest] = images
  const kinds: ConflictKind[] = []
  if (rest.some((i) => i.description !== first!.description)) kinds.push('words')
  if (rest.some((i) => i.width !== first!.width || i.height !== first!.height)) kinds.push('sizes')
  if (rest.some((i) => i.title !== first!.title)) kinds.push('names')
  if (rest.some((i) => patchesKey(i) !== patchesKey(first!))) kinds.push('patches')
  if (rest.some((i) => areasKey(i) !== areasKey(first!))) kinds.push('named areas')
  return kinds
}

/**
 * Whether what changed since an image's take was chosen can be accepted (the picture kept as it
 * is): changed words or styles; a changed size needs a new take.
 */
export function acceptableReasons(reasons: ImageReason[]): boolean {
  return reasons.length > 0 && !reasons.includes('the size')
}

/**
 * How far an act's images are: those chosen and up to date (`done`) out of all, the ones the
 * game's lists disagree on among them, and the ids of the rest, which need attention.
 */
export function imagesDone(act: {
  rows: readonly { id: string; status: ImageStatus }[]
  conflicts: readonly { id: string }[]
}): { done: number; total: number; needs: string[] } {
  const needs = [
    ...act.rows.filter((r) => r.status !== 'chosen').map((r) => r.id),
    ...act.conflicts.map((c) => c.id),
  ]
  const total = act.rows.length + act.conflicts.length
  return { done: total - needs.length, total, needs }
}

/** One patch of an image as its page shows it. */
export interface PatchRow {
  id: string
  title: string
  /** The game's words. */
  description: string
  /** The words that will be used: the user's, else the game's. */
  words: string
  /** The user's own words are in use. */
  changed: boolean
  /** The game's words changed since the user wrote their own. */
  gameChanged: boolean
  /** The game's words when the user's were written. */
  gameWas: string | null
}

/** One named area of an image as its page shows it. */
export interface AreaRow {
  id: string
  title: string
  /** The area has been placed on the picture. */
  placed: boolean
  /** Where it is, in the image's pixels; null while it is still to place. */
  box: AreaBox | null
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
  /** The patches the game asks for on it, in the game's order (the first act's, for a shared image). */
  patches: PatchRow[]
  /** The named areas the game wants placed on it, in the game's order (the first act's, for a shared image). */
  areas: AreaRow[]
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
export type ConflictKind = 'words' | 'sizes' | 'names' | 'patches' | 'named areas'

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

/** The Style page. */
export interface StyleView {
  /** The images edits hold a style. */
  present: boolean
  /** The images edits are there but cannot be read. */
  invalid: boolean
  look: string
  keepOut: string
  palette: string[]
  acts: { id: string; title: string; addition: string | null }[]
}

/** The Images pages of a project. */
export interface ImagesSummary {
  acts: ImagesAct[]
  style: StyleView
  /** One notice for a change of the game's look; null when every picture is up to date. */
  lookNotice: { count: number; changed: string[] } | null
}

/** What `summarizeImages` is given. */
export interface ImagesInput {
  parts: { id: string; title: string }[]
  lists: { id: string; title: string; file: string; state: ImageListState; canRefresh: boolean }[]
  /** The images edits, which hold the style, for problems. */
  editsFile: string
  /** The images edits are there but cannot be read. */
  editsInvalid?: boolean
  /** The style; null when the edits hold none. */
  style: ImageStyle | null
  /** The studio's changes to images, by image id. */
  edits: ImageEdits['images']
  /** What each image's chosen take was made from, and which take it is. */
  chosen: Record<string, ChosenEntry>
  /** Whether the file each image names as the game's own is there, by image id. */
  gameFiles?: Record<string, boolean>
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
  const { parts, lists, style, edits, chosen } = input
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
  for (const part of Object.keys(style?.parts ?? {})) {
    if (parts.some((known) => known.id === part)) continue
    problems.push({
      file: input.editsFile,
      path: `style.parts.${part}`,
      message: `"${part}" is not one of the project's parts`,
    })
  }

  const oldIds = new Set<string>()
  const lookPairs: [string | null, string][] = []
  /** An image's row as first met; a shared image reuses it in every act. */
  const bases = new Map<string, ImageRow>()
  const baseRow = (list: ImagesInput['lists'][number], image: GameImage): ImageRow => {
    const known = bases.get(image.id)
    if (known) return known
    const group = (listed.get(image.id) ?? []).map((place) => place.list)
    const choices: ActStyleChoice[] = group.flatMap((g) => {
      const text = style?.parts[g.id]
      return text ? [{ id: g.id, title: g.title, text }] : []
    })
    const shared = group.length > 1
    const own = edits[image.id]
    const off = own?.partStyle === null
    const wanted = own?.partStyle ?? undefined
    const first = group[0]!.id
    const pick = off
      ? null
      : (choices.find((c) => c.id === wanted)?.id ??
        (choices.some((c) => c.id === first) ? first : null))
    const styleAct = shared ? (pick ?? first) : list.id
    const actEff = effectiveStyle(style, styleAct)
    const eff = effectiveStyle(style, styleAct, off)
    const words = own?.text ?? image.description
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
    const wasText = made ? styleParts(withoutPalette(made.style))?.[2] : null
    const row: ImageRow = {
      id: image.id,
      title: image.title,
      partId: list.id,
      description: image.description,
      width: image.width,
      height: image.height,
      words,
      changed: own?.text !== undefined,
      gameChanged: own?.text !== undefined && own.gameWas !== image.description,
      gameWas: own?.gameWas ?? null,
      patches: image.patches.map((patch) => {
        const mine = own?.patches?.[patch.id]
        return {
          ...patch,
          words: mine?.text ?? patch.description,
          changed: mine !== undefined,
          gameChanged: mine !== undefined && mine.gameWas !== patch.description,
          gameWas: mine?.gameWas ?? null,
        }
      }),
      areas: image.areas.map((area) => {
        const box = own?.areas?.[area.id] ?? null
        return { ...area, placed: box !== null, box }
      }),
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
    const actEff = effectiveStyle(style, list.id)
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
  return {
    images: {
      acts,
      style: {
        present: style !== null,
        invalid: input.editsInvalid ?? false,
        look: style?.look ?? '',
        keepOut: style?.keepOut ?? '',
        palette: style?.palette ?? [],
        acts: parts.map((part) => ({
          id: part.id,
          title: part.title,
          addition: style?.parts[part.id] ?? null,
        })),
      },
      lookNotice:
        oldIds.size > 0 ? { count: oldIds.size, changed: lookChangeNames(lookPairs) } : null,
    },
    problems,
  }
}

/** The body of a change to an image's own words; null takes them back. */
export const WordsBody = z.object({ words: z.string().nullable() }).strict()

/** The body of a change to the style's look or what is kept out; null or empty is none (refused for the look). */
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
