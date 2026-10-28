import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { elevenLabsApiKey, fishApiKey, forgetLoadedKeys, parseEnv } from './env'

describe('parseEnv', () => {
  it('reads KEY=value lines, without quotes, comments or export', () => {
    expect(
      parseEnv('# comment\nA=1\nexport B="two words"\nC = \'3\'\n\nnot a line\nD=x=y\n'),
    ).toEqual({ A: '1', B: 'two words', C: '3', D: 'x=y' })
  })

  it('leaves out a comment after an unquoted value, as Bun does, and keeps a # in quotes', () => {
    expect(parseEnv('A=abc  # my key\nB="x # y" # note\nC=a#b\n')).toEqual({
      A: 'abc',
      B: 'x # y',
      C: 'a#b',
    })
  })
})

describe('fishApiKey', () => {
  it('prefers the environment', async () => {
    const root = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=from-file' })
    expect(await fishApiKey(root, '.env', { FISH_AUDIO_API_KEY: 'from-env' })).toBe('from-env')
  })

  it('falls back to the project’s env file', async () => {
    const root = tempRepo({
      '.env': 'FISH_AUDIO_API_KEY=from-file\n',
      'audio-studio.json': projectJson(),
    })
    expect(await fishApiKey(root, '.env', {})).toBe('from-file')
  })

  it('is null when neither has it', async () => {
    expect(await fishApiKey(tempRepo({}), '.env', {})).toBeNull()
  })
})

describe('elevenLabsApiKey', () => {
  it('reads ELEVENLABS_API_KEY as the Fish key is read: the environment, else the env file', async () => {
    const root = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=fish\nELEVENLABS_API_KEY=from-file\n' })
    expect(await elevenLabsApiKey(root, '.env', { ELEVENLABS_API_KEY: 'from-env' })).toBe(
      'from-env',
    )
    expect(await elevenLabsApiKey(root, '.env', {})).toBe('from-file')
    expect(
      await elevenLabsApiKey(tempRepo({ '.env': 'FISH_AUDIO_API_KEY=fish\n' }), '.env', {}),
    ).toBeNull()
  })
})

describe('forgetLoadedKeys', () => {
  /** A project in a folder, its env file and the folder's other env files as given. */
  const project = (files: Record<string, unknown>, env?: string) =>
    tempRepo({ 'audio-studio.json': projectJson(env ? { env } : {}), ...files })

  it('forgets the keys Bun loaded from the project’s env file in the start folder, so it is read live', () => {
    const dir = project({
      '.env': 'FISH_AUDIO_API_KEY=from-file  # mine\nELEVENLABS_API_KEY="eleven-file"\n',
      '.env.local': 'ELEVENLABS_API_KEY=eleven-local\n',
    })
    const environment: Record<string, string | undefined> = {
      FISH_AUDIO_API_KEY: 'from-file',
      ELEVENLABS_API_KEY: 'eleven-local',
      OTHER: 'kept',
    }
    forgetLoadedKeys(dir, join(dir, 'audio-studio.json'), environment)
    expect(environment).toEqual({ OTHER: 'kept' })
  })

  it('keeps a key exported with another value', () => {
    const dir = project({ '.env': 'FISH_AUDIO_API_KEY=from-file\n' })
    const environment: Record<string, string | undefined> = { FISH_AUDIO_API_KEY: 'exported' }
    forgetLoadedKeys(dir, join(dir, 'audio-studio.json'), environment)
    expect(environment).toEqual({ FISH_AUDIO_API_KEY: 'exported' })
  })

  it('keeps the keys of a start folder that is not the project’s, or whose .env is not its env file', () => {
    const parent = tempRepo({ '.env': 'FISH_AUDIO_API_KEY=parent\n' })
    const game = project({})
    const fromParent: Record<string, string | undefined> = { FISH_AUDIO_API_KEY: 'parent' }
    forgetLoadedKeys(parent, join(game, 'audio-studio.json'), fromParent)
    expect(fromParent).toEqual({ FISH_AUDIO_API_KEY: 'parent' })
    const other = project({ '.env': 'FISH_AUDIO_API_KEY=root\n' }, 'config/keys.env')
    const fromRoot: Record<string, string | undefined> = { FISH_AUDIO_API_KEY: 'root' }
    forgetLoadedKeys(other, join(other, 'audio-studio.json'), fromRoot)
    expect(fromRoot).toEqual({ FISH_AUDIO_API_KEY: 'root' })
  })
})
