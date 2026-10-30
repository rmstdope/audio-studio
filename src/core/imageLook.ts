import type { GameStyle } from './images'

/** A colour as red, green and blue, 0 to 255. */
export type Rgb = readonly [number, number, number]

/** How in-between shades are made when colours are reduced. */
export type Dithering = 'flat' | 'patterned' | 'scattered'

/** The game's look: which colours its pictures may use, and how shades between them are made. */
export interface Look {
  colours: { kind: 'palette'; palette: Rgb[] } | { kind: 'depth'; bits: 8 | 16 } | { kind: 'full' }
  dithering: Dithering
}

/** The size a game's picture has. */
export interface LookSize {
  width: number
  height: number
}

/** A colour like `#1a2b3c` as red, green and blue. */
export function parseColour(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** The look a style file asks for: a listed palette wins, then the colour depth, else full colour. */
export function lookOf(style: Pick<GameStyle, 'palette' | 'colourDepth' | 'dithering'>): Look {
  const dithering = style.dithering ?? 'patterned'
  if (style.palette.length) {
    return { colours: { kind: 'palette', palette: style.palette.map(parseColour) }, dithering }
  }
  if (style.colourDepth === '8-bit') return { colours: { kind: 'depth', bits: 8 }, dithering }
  if (style.colourDepth === '16-bit') return { colours: { kind: 'depth', bits: 16 }, dithering }
  return { colours: { kind: 'full' }, dithering }
}

/** The words for how shades are made. */
const DITHERING_WORDS: Record<Dithering, string> = {
  flat: 'flat colour',
  patterned: 'patterned dithering',
  scattered: 'scattered dithering',
}

/** The look line under an image's title; `null` is a style that cannot be used. */
export function describeLook(look: Look | null, size: LookSize): string {
  const shape = `${size.width} × ${size.height}`
  if (!look) return `${shape} · the game's palette — can't be read`
  const { colours } = look
  if (colours.kind === 'full') return `${shape} · full colour`
  const what =
    colours.kind === 'palette'
      ? `the game's palette, ${colours.palette.length} ${colours.palette.length === 1 ? 'colour' : 'colours'}`
      : `${colours.bits}-bit colour`
  return `${shape} · ${what} · ${DITHERING_WORDS[look.dithering]}`
}

/** What a game's version was brought to, as one stable string: the size, the colours and the dithering. */
export function lookKey(look: Look, size: LookSize): string {
  const colours =
    look.colours.kind === 'palette'
      ? look.colours.palette.map((c) => c.join(','))
      : look.colours.kind === 'depth'
        ? look.colours.bits
        : 'full'
  return JSON.stringify({
    w: size.width,
    h: size.height,
    c: colours,
    d: look.colours.kind === 'full' ? 'none' : look.dithering,
  })
}

/** What differs between two looks, named for the notice; `null` is a picture never brought to one. */
export function lookChanges(then: string | null, now: string): string[] {
  if (then === null) return ['its look']
  let a: { w: number; h: number; c: unknown; d: string }
  let b: typeof a
  try {
    a = JSON.parse(then)
    b = JSON.parse(now)
  } catch {
    return ['its look']
  }
  const changes: string[] = []
  const kind = (c: unknown) =>
    Array.isArray(c) ? 'palette' : typeof c === 'number' ? 'depth' : 'full'
  if (JSON.stringify(a.c) !== JSON.stringify(b.c)) {
    changes.push(
      kind(a.c) === 'palette' || kind(b.c) === 'palette' ? 'its palette' : 'its colour depth',
    )
  }
  if (a.d !== b.d) changes.push('its dithering')
  if (a.w !== b.w || a.h !== b.h) changes.push("an image's size")
  return changes
}

/** The sentence saying why a style file can't be used, from what was read of it and where it is. */
export function explainStyleProblem(raw: unknown, styleFile: string): string {
  const start = "Can't bring this take to the game's look:"
  const palette = (raw as { palette?: unknown } | null)?.palette
  if (Array.isArray(palette)) {
    const at = palette.findIndex((c) => typeof c !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c))
    if (at !== -1) {
      return `${start} the style file's palette has a colour that isn't one: palette ${at + 1}, “${String(palette[at])}”.`
    }
  }
  return `${start} ${styleFile} cannot be read as the game's style.`
}
