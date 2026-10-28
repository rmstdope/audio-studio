import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveInRoot } from '../core/paths'

/** The name of the variable that holds the Fish Audio API key. */
export const FISH_KEY = 'FISH_AUDIO_API_KEY'

/** The name of the variable that holds the ElevenLabs API key. */
export const ELEVENLABS_KEY = 'ELEVENLABS_API_KEY'

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
export function fishApiKey(
  root: string,
  envPath: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  return apiKey(FISH_KEY, root, envPath, environment)
}

/** The ElevenLabs API key, found as the Fish key is; null if neither place has it. */
export function elevenLabsApiKey(
  root: string,
  envPath: string,
  environment: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  return apiKey(ELEVENLABS_KEY, root, envPath, environment)
}

async function apiKey(
  name: string,
  root: string,
  envPath: string,
  environment: Record<string, string | undefined>,
): Promise<string | null> {
  if (environment[name]) return environment[name]
  try {
    return parseEnv(await readFile(resolveInRoot(root, envPath), 'utf8'))[name] || null
  } catch {
    return null
  }
}

/** The env files Bun reads from the folder it starts in, before the studio runs. */
const LOADED_FILES = ['.env', '.env.development', '.env.production', '.env.test', '.env.local']

/**
 * Forgets the API keys Bun put in the environment from the env files of `dir` (the folder it was
 * started in): Bun reads them once at start, and a key in the environment wins over the project's
 * env file, so a key changed in the file afterwards would never be seen. A key with another value
 * than the files' was exported, and is kept.
 */
export function forgetLoadedKeys(
  dir: string,
  environment: Record<string, string | undefined> = process.env,
): void {
  const loaded = LOADED_FILES.flatMap((file) => {
    try {
      return [parseEnv(readFileSync(join(dir, file), 'utf8'))]
    } catch {
      return []
    }
  })
  for (const name of [FISH_KEY, ELEVENLABS_KEY]) {
    const value = environment[name]
    if (value !== undefined && loaded.some((values) => values[name] === value)) {
      delete environment[name]
    }
  }
}
