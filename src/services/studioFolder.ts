import { existsSync } from 'node:fs'
import { resolveInRoot } from '../core/paths'
import { STUDIO_DIR } from '../core/project'
import { writeAtomic } from './files'

/** The studio folder's `.gitignore`, beside its committed files. */
const IGNORE_FILE = `${STUDIO_DIR}/.gitignore`

/**
 * Makes the studio folder ready at start: writes its `.gitignore`, which keeps the cache out of
 * git, when it is missing. One that is there is left as it is.
 */
export async function ensureStudioFolder(root: string): Promise<void> {
  if (existsSync(resolveInRoot(root, IGNORE_FILE))) return
  await writeAtomic(root, IGNORE_FILE, 'cache/\n')
}
