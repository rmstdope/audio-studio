import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { resolveInRoot } from '../core/paths'

/** The name of the variable that holds the Fish Audio API key. */
export const FISH_KEY = 'FISH_AUDIO_API_KEY'

/** The name of the variable that holds the ElevenLabs API key. */
export const ELEVENLABS_KEY = 'ELEVENLABS_API_KEY'

/**
 * The variables of a `.env` file: `KEY=value` lines, quotes and `export` removed, comments
 * skipped, also one after an unquoted or quoted value (`KEY=abc # mine`), as Bun reads them.
 */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!match) continue
    const raw = match[2]!
    const quoted = /^(['"])(.*)\1(?:\s+#.*)?$/.exec(raw)
    values[match[1]!] = quoted ? quoted[2]! : raw.replace(/\s+#.*$/, '')
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
 * started in), when one of them is the project's own env file: Bun reads them once at start, and
 * a key in the environment wins over the project's env file, so a key changed in the file
 * afterwards would never be seen. A key with another value than the files' was exported, and is
 * kept; so are the keys of a folder whose env files are not the project's.
 */
export function forgetLoadedKeys(
  dir: string,
  projectFile: string,
  environment: Record<string, string | undefined> = process.env,
): void {
  const envPath = projectEnvPath(projectFile)
  if (!LOADED_FILES.some((file) => resolve(dir, file) === envPath)) return
  const loaded: Record<string, string>[] = []
  for (const file of LOADED_FILES) {
    try {
      loaded.push(parseEnv(readFileSync(join(dir, file), 'utf8')))
    } catch {
      // Not there: Bun loaded nothing from it.
    }
  }
  for (const name of [FISH_KEY, ELEVENLABS_KEY]) {
    const value = environment[name]
    if (value !== undefined && loaded.some((values) => values[name] === value)) {
      delete environment[name]
    }
  }
}

/** Where the project's env file is (its `env`, `.env` when it names none), or null if unreadable. */
function projectEnvPath(projectFile: string): string | null {
  try {
    const project = JSON.parse(readFileSync(projectFile, 'utf8')) as { env?: unknown }
    return resolve(dirname(projectFile), typeof project.env === 'string' ? project.env : '.env')
  } catch {
    return null
  }
}
