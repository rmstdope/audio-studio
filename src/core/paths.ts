import { isAbsolute, relative, resolve, sep } from 'node:path'

/**
 * The absolute path of `path` (relative to the project root), refusing anything that would land
 * outside the root, so a project file can never make the studio read or write elsewhere.
 */
export function resolveInRoot(root: string, path: string): string {
  const full = resolve(root, path)
  const fromRoot = relative(root, full)
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(`${path} is outside the project root ${root}`)
  }
  return full
}
