import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setFishTier } from './fishTier'

const SETTINGS = 'content-studio/cache/settings.json'

function repo(files: Record<string, unknown> = {}) {
  const root = tempRepo({ 'content-studio.json': projectJson(), ...files })
  const projectFile = join(root, 'content-studio.json')
  return {
    root,
    projectFile,
    project: () => readFileSync(projectFile, 'utf8'),
    settings: () => readFileSync(join(root, SETTINGS), 'utf8'),
  }
}

describe('setFishTier', () => {
  it('saves the tier in the settings in the cache, never in the project file', async () => {
    const { projectFile, project, settings } = repo()
    const before = project()
    expect(await setFishTier(projectFile, '100')).toEqual({ ok: true })
    expect(JSON.parse(settings())).toEqual({ fishTier: '100' })
    expect(project()).toBe(before)
  })

  it('keeps the other settings', async () => {
    const { projectFile, settings } = repo({ [SETTINGS]: { takeFade: 0.5 } })
    await setFishTier(projectFile, '1000')
    expect(JSON.parse(settings())).toEqual({ takeFade: 0.5, fishTier: '1000' })
  })

  it('clears the tier', async () => {
    const { projectFile, settings } = repo({ [SETTINGS]: { fishTier: '100', takeFade: 0 } })
    expect(await setFishTier(projectFile, null)).toEqual({ ok: true })
    expect(JSON.parse(settings())).toEqual({ takeFade: 0 })
  })

  it('refuses a settings file that cannot be read, and writes nothing', async () => {
    const { projectFile, settings } = repo({ [SETTINGS]: '{ broken' })
    const result = await setFishTier(projectFile, '100')
    expect(result).toMatchObject({ ok: false, problems: [{ file: SETTINGS, path: '' }] })
    expect(settings()).toBe('{ broken')
  })

  it('refuses a project file that cannot be read, and writes nothing', async () => {
    const { root, projectFile } = repo()
    writeFileSync(projectFile, '{ broken')
    expect((await setFishTier(projectFile, '100')).ok).toBe(false)
    expect(existsSync(join(root, SETTINGS))).toBe(false)
  })

  it('saves two changes made together one after the other', async () => {
    const { projectFile, settings } = repo()
    await Promise.all([setFishTier(projectFile, '100'), setFishTier(projectFile, '1000')])
    expect(JSON.parse(settings()).fishTier).toBe('1000')
  })

  it('says why the file could not be written when the disk refuses it', async () => {
    const { root, projectFile } = repo()
    const cache = join(root, 'content-studio/cache')
    mkdirSync(cache, { recursive: true })
    chmodSync(cache, 0o555)
    try {
      expect(await setFishTier(projectFile, '100')).toEqual({
        ok: false,
        problems: [{ file: SETTINGS, path: 'fishTier', message: 'permission denied' }],
      })
    } finally {
      chmodSync(cache, 0o755)
    }
  })
})
