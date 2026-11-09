import type { Look, LookSize, Rgb } from './imageLook'

/** A picture as opaque RGBA bytes, row by row. */
export interface Pixels {
  width: number
  height: number
  data: Uint8Array
}

/** The 8 × 8 ordered-dither matrix (Bayer), values 0 to 63. */
const BAYER = (() => {
  let n = 1
  let grid = [[0]]
  while (n < 8) {
    const next: number[][] = Array.from({ length: n * 2 }, () => new Array<number>(n * 2).fill(0))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = grid[y]![x]! * 4
        next[y]![x] = v
        next[y]![x + n] = v + 2
        next[y + n]![x] = v + 3
        next[y + n]![x + n] = v + 1
      }
    }
    grid = next
    n *= 2
  }
  return grid
})()

/** Whether bringing a picture of this size to `size` cuts the edges off (it is another shape). */
export function isCropped(from: LookSize, to: LookSize): boolean {
  return from.width * to.height !== from.height * to.width
}

/** The part of a picture of size `src` that bringing it to `size` keeps: the target's shape, whole pixels, the middle. */
export function cropWindow(
  src: LookSize,
  size: LookSize,
): { x: number; y: number; width: number; height: number } {
  let width = src.width
  let height = src.height
  if (src.width * size.height > src.height * size.width) {
    width = Math.max(1, Math.floor((src.height * size.width) / size.height))
  } else {
    height = Math.max(1, Math.floor((src.width * size.height) / size.width))
  }
  return {
    x: Math.floor((src.width - width) / 2),
    y: Math.floor((src.height - height) / 2),
    width,
    height,
  }
}

/** A rectangle of a picture, in pixels. */
export interface Window {
  x: number
  y: number
  width: number
  height: number
}

/** The context an edit is given around the marked area: at least this many pixels, or half the area's side. */
const EDIT_CONTEXT = 96

/**
 * The part of a picture an edit model is given for a marked area: the area with context around it,
 * inside the picture, its sides in multiples of 16 (what the model takes) except where it is the
 * picture's own whole side. A smaller picture for the model is faster and shows what is marked larger.
 */
export function editWindow(area: Window, size: LookSize): Window {
  const side = (start: number, length: number, whole: number) => {
    const pad = Math.max(EDIT_CONTEXT, Math.ceil(length / 2))
    const from = Math.max(0, start - pad)
    const to = Math.min(whole, start + length + pad)
    const wanted = Math.ceil((to - from) / 16) * 16
    if (wanted >= whole) return { at: 0, length: whole }
    // Grow towards whichever edge has room, so the area stays inside.
    const at = Math.max(0, Math.min(from, whole - wanted))
    return { at, length: wanted }
  }
  const h = side(area.x, area.width, size.width)
  const v = side(area.y, area.height, size.height)
  return { x: h.at, y: v.at, width: h.length, height: v.length }
}

/** The pixels of `window`, as a picture of its own. */
export function cropPixels(src: Pixels, window: Window): Pixels {
  const data = new Uint8Array(window.width * window.height * 4)
  for (let y = 0; y < window.height; y++) {
    const from = ((window.y + y) * src.width + window.x) * 4
    data.set(src.data.subarray(from, from + window.width * 4), y * window.width * 4)
  }
  return { width: window.width, height: window.height, data }
}

/** A copy of `base` with `part` laid in at `window`. */
export function pastePixels(base: Pixels, part: Pixels, window: Window): Pixels {
  const data = base.data.slice()
  for (let y = 0; y < window.height; y++) {
    const to = ((window.y + y) * base.width + window.x) * 4
    data.set(part.data.subarray(y * part.width * 4, (y + 1) * part.width * 4), to)
  }
  return { width: base.width, height: base.height, data }
}

/**
 * The picture cropped to the target's shape (the middle kept) and scaled to exactly `size`: each
 * new pixel is the average of the source area it covers, so the result never depends on the machine.
 */
export function fitToSize(src: Pixels, size: LookSize): Pixels {
  const { x: x0, y: y0, width: cw, height: ch } = cropWindow(src, size)
  const out = new Uint8Array(size.width * size.height * 4)
  for (let y = 0; y < size.height; y++) {
    const sy0 = y0 + (y * ch) / size.height
    const sy1 = y0 + ((y + 1) * ch) / size.height
    for (let x = 0; x < size.width; x++) {
      const sx0 = x0 + (x * cw) / size.width
      const sx1 = x0 + ((x + 1) * cw) / size.width
      let r = 0
      let g = 0
      let b = 0
      let weight = 0
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0)
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
          const w = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0))
          const i = (sy * src.width + sx) * 4
          r += src.data[i]! * w
          g += src.data[i + 1]! * w
          b += src.data[i + 2]! * w
          weight += w
        }
      }
      const o = (y * size.width + x) * 4
      out[o] = Math.round(r / weight)
      out[o + 1] = Math.round(g / weight)
      out[o + 2] = Math.round(b / weight)
      out[o + 3] = 255
    }
  }
  return { width: size.width, height: size.height, data: out }
}

/** The levels per channel of a reduced depth: 8-bit is 8 reds × 8 greens × 4 blues, 16-bit 32 × 64 × 32. */
function levelsOf(bits: 8 | 16): [number, number, number] {
  return bits === 8 ? [8, 8, 4] : [32, 64, 32]
}

/** The channel value nearest to `v` among `n` evenly spread levels. */
function snap(v: number, n: number): number {
  const level = Math.min(n - 1, Math.max(0, Math.round((v * (n - 1)) / 255)))
  return Math.round((level * 255) / (n - 1))
}

/** The palette colour nearest to (r, g, b); the lower index wins a tie. */
function nearest(palette: Rgb[], r: number, g: number, b: number): Rgb {
  let best = palette[0]!
  let bestDistance = Infinity
  for (const colour of palette) {
    const d = (colour[0] - r) ** 2 + (colour[1] - g) ** 2 + (colour[2] - b) ** 2
    if (d < bestDistance) {
      best = colour
      bestDistance = d
    }
  }
  return best
}

/** Reduces `pixels` (in place) to the look's colours, with its dithering. */
function reduce(pixels: Pixels, look: Look): void {
  const { colours, dithering } = look
  if (colours.kind === 'full') return
  const { width, height, data } = pixels
  const levels = colours.kind === 'depth' ? levelsOf(colours.bits) : null
  // The ordered dither moves a pixel by up to one step of the colour set before it is matched.
  const spread = levels
    ? levels.map((n) => 255 / (n - 1))
    : new Array<number>(3).fill(
        255 / Math.cbrt(colours.kind === 'palette' ? colours.palette.length : 1),
      )
  const match = (r: number, g: number, b: number): Rgb =>
    levels
      ? [snap(r, levels[0]), snap(g, levels[1]), snap(b, levels[2])]
      : nearest((colours as { palette: Rgb[] }).palette, r, g, b)
  // Error diffusion carries the rest of each pixel's rounding to the next ones (Floyd–Steinberg).
  const carry = dithering === 'scattered' ? new Float32Array(width * height * 3) : null
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let r = data[i]!
      let g = data[i + 1]!
      let b = data[i + 2]!
      if (dithering === 'patterned') {
        const t = (BAYER[y % 8]![x % 8]! + 0.5) / 64 - 0.5
        r += t * spread[0]!
        g += t * spread[1]!
        b += t * spread[2]!
      } else if (carry) {
        const c = (y * width + x) * 3
        r += carry[c]!
        g += carry[c + 1]!
        b += carry[c + 2]!
      }
      const [nr, ng, nb] = match(r, g, b)
      if (carry) {
        const er = r - nr
        const eg = g - ng
        const eb = b - nb
        const push = (dx: number, dy: number, f: number) => {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || nx >= width || ny >= height) return
          const c = (ny * width + nx) * 3
          carry[c]! += er * f
          carry[c + 1]! += eg * f
          carry[c + 2]! += eb * f
        }
        push(1, 0, 7 / 16)
        push(-1, 1, 3 / 16)
        push(0, 1, 5 / 16)
        push(1, 1, 1 / 16)
      }
      data[i] = nr
      data[i + 1] = ng
      data[i + 2] = nb
    }
  }
}

/**
 * The game's version of a picture: cropped to fill and scaled to `size`, then brought to the look's
 * colours. The same picture and look always give the same bytes.
 */
export function bringToLook(src: Pixels, look: Look, size: LookSize): Pixels {
  const fitted = fitToSize(src, size)
  reduce(fitted, look)
  return fitted
}
