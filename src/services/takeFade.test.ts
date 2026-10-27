import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setTakeFade } from './takeFade'

function repo(project: Record<string, unknown> = projectJson(), indent = 2, eol = '\n') {
  const root = tempRepo({})
  const projectFile = join(root, 'audio-studio.json')
  writeFileSync(projectFile, `${JSON.stringify(project, null, indent)}\n`.replace(/\n/g, eol))
  return { projectFile, read: () => readFileSync(projectFile, 'utf8') }
}

describe('setTakeFade', () => {
  it('saves the length in the project file, the rest of it as it was', async () => {
    const project = projectJson()
    const { projectFile, read } = repo(project, 4)
    expect(await setTakeFade(projectFile, 1)).toEqual({ ok: true })
    expect(read()).toBe(`${JSON.stringify({ ...project, takeFade: 1 }, null, 4)}\n`)
  })

  it('saves no fade as 0, and changes a length already there in its place', async () => {
    const project = { ...projectJson(), takeFade: 0.3 }
    const { projectFile, read } = repo(project)
    await setTakeFade(projectFile, 0)
    expect(JSON.parse(read()).takeFade).toBe(0)
    expect(Object.keys(JSON.parse(read()))).toEqual(Object.keys(project))
  })

  it('keeps CRLF line endings', async () => {
    const { projectFile, read } = repo(projectJson(), 2, '\r\n')
    await setTakeFade(projectFile, 0.5)
    expect(read()).toContain('\r\n')
    expect(read().replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('refuses a length that cannot be one, and writes nothing', async () => {
    const { projectFile, read } = repo()
    const before = read()
    const result = await setTakeFade(projectFile, -1)
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ problems: [{ path: 'takeFade' }] })
    expect(read()).toBe(before)
  })

  it('refuses a project file that cannot be read, and writes nothing', async () => {
    const { projectFile, read } = repo()
    writeFileSync(projectFile, '{ broken')
    expect((await setTakeFade(projectFile, 1)).ok).toBe(false)
    expect(read()).toBe('{ broken')
  })

  it('saves two changes made together one after the other', async () => {
    const { projectFile, read } = repo()
    await Promise.all([setTakeFade(projectFile, 0.1), setTakeFade(projectFile, 2)])
    expect(JSON.parse(read()).takeFade).toBe(2)
  })
})
