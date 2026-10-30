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

/**
 * The picture cropped to the target's shape (the middle kept) and scaled to exactly `size`: each
 * new pixel is the average of the source area it covers, so the result never depends on the machine.
 */
export function fitToSize(src: Pixels, size: LookSize): Pixels {
  // The source window with the target's shape: whole pixels, the middle kept.
  let cw = src.width
  let ch = src.height
  if (src.width * size.height > src.height * size.width) {
    cw = Math.max(1, Math.floor((src.height * size.width) / size.height))
  } else {
    ch = Math.max(1, Math.floor((src.width * size.height) / size.width))
  }
  const x0 = Math.floor((src.width - cw) / 2)
  const y0 = Math.floor((src.height - ch) / 2)
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
