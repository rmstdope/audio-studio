import type { Problem } from '../core/project'

/**
 * The problems a banner lists, less those a banner above it on the same page already shows, so a
 * broken cast file is read about once: the part's own banner leaves out the project summary's,
 * and the Generation banner leaves out both.
 */
export function notShown(problems: Problem[], shown: Problem[]): Problem[] {
  const key = (p: Problem) => JSON.stringify([p.file, p.path, p.message])
  const seen = new Set(shown.map(key))
  return problems.filter((p) => !seen.has(key(p)))
}
