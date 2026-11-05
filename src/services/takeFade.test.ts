import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setTakeFade } from './takeFade'

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

describe('setTakeFade', () => {
  it('saves the length in the settings in the cache, never in the project file', async () => {
    const { projectFile, project, settings } = repo()
    const before = project()
    expect(await setTakeFade(projectFile, 1)).toEqual({ ok: true })
    expect(JSON.parse(settings())).toEqual({ takeFade: 1 })
    expect(project()).toBe(before)
  })

  it('saves no fade as 0, and keeps the other settings', async () => {
    const { projectFile, settings } = repo({ [SETTINGS]: { fishTier: '100', takeFade: 0.3 } })
    await setTakeFade(projectFile, 0)
    expect(JSON.parse(settings())).toEqual({ fishTier: '100', takeFade: 0 })
  })

  it('refuses a length that cannot be one, and writes nothing', async () => {
    const { root, projectFile } = repo()
    const result = await setTakeFade(projectFile, -1)
    expect(result).toMatchObject({ ok: false, problems: [{ file: SETTINGS, path: 'takeFade' }] })
    expect(existsSync(join(root, SETTINGS))).toBe(false)
  })

  it('refuses a project file that cannot be read, and writes nothing', async () => {
    const { root, projectFile } = repo()
    writeFileSync(projectFile, '{ broken')
    expect((await setTakeFade(projectFile, 1)).ok).toBe(false)
    expect(existsSync(join(root, SETTINGS))).toBe(false)
  })

  it('saves two changes made together one after the other', async () => {
    const { projectFile, settings } = repo()
    await Promise.all([setTakeFade(projectFile, 0.1), setTakeFade(projectFile, 2)])
    expect(JSON.parse(settings()).takeFade).toBe(2)
  })
})
