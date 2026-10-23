import { readFile } from 'node:fs/promises'
import { resolveInRoot } from '../core/paths'

/** The name of the variable that holds the Fish Audio API key. */
export const FISH_KEY = 'FISH_AUDIO_API_KEY'

/** The variables of a `.env` file: `KEY=value` lines, quotes and `export` removed, comments skipped. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) values[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

/**
 * The Fish Audio API key: from the environment, else from the project's env file (`envPath`,
 * relative to the project root); null if neither has it.
 */
export async function fishApiKey(
  root: string,
  envPath: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (environment[FISH_KEY]) return environment[FISH_KEY]
  try {
    return parseEnv(await readFile(resolveInRoot(root, envPath), 'utf8'))[FISH_KEY] || null
  } catch {
    return null
  }
}
