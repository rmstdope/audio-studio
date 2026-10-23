/**
 * `x` with `digits` decimals exactly as Python's `f"{x:.{digits}f}"` writes it: the exact binary
 * value rounded to the nearest, an exact tie to the even digit. `toFixed` rounds the exact value
 * too, but sends a tie up (`0.125` → `0.13`, where Python writes `0.12`). Used where the studio
 * builds the same command a Python tool builds, so both give the same result.
 */
export function pyFixed(x: number, digits: number): string {
  if (x < 0) return `-${pyFixed(-x, digits)}`
  const scale = 10 ** digits
  const below = Math.floor(x * scale)
  // A tie is exact only if it is a binary fraction: 5^digits must divide the numerator.
  const twice = 2 * below + 1
  if (twice % 5 ** digits === 0 && twice / (2 * scale) === x) {
    const even = below % 2 === 0 ? below : below + 1
    return (even / scale).toFixed(digits)
  }
  return x.toFixed(digits)
}
