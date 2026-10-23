import { describe, expect, it } from 'bun:test'
import { projectJson, tempRepo } from '../../test/helpers'
import { fishApiKey, parseEnv } from './env'

describe('parseEnv', () => {
  it('reads KEY=value lines, without quotes, comments or export', () => {
    expect(
      parseEnv('# comment\nA=1\nexport B="two words"\nC = \'3\'\n\nnot a line\nD=x=y\n'),
    ).toEqual({ A: '1', B: 'two words', C: '3', D: 'x=y' })
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
