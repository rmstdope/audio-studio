import { describe, expect, it } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setFishTier } from './fishTier'

function repo(project: Record<string, unknown> = projectJson(), indent = 2, eol = '\n') {
  const root = tempRepo({})
  const projectFile = join(root, 'audio-studio.json')
  writeFileSync(projectFile, `${JSON.stringify(project, null, indent)}\n`.replace(/\n/g, eol))
  return { projectFile, read: () => readFileSync(projectFile, 'utf8') }
}

describe('setFishTier', () => {
  it('saves the tier in the project file, the rest of it as it was', async () => {
    const project = projectJson()
    ;(project.narration as { quality?: unknown }).quality = { minHeard: 0.8 }
    const { projectFile, read } = repo(project, 4)
    expect(await setFishTier(projectFile, '100')).toEqual({ ok: true })
    const quality = { minHeard: 0.8, fishTier: '100' }
    const narration = { ...(project.narration as object), quality }
    expect(read()).toBe(`${JSON.stringify({ ...project, narration }, null, 4)}\n`)
  })

  it('keeps CRLF line endings', async () => {
    const { projectFile, read } = repo(projectJson(), 2, '\r\n')
    await setFishTier(projectFile, '1000')
    expect(read()).toContain('\r\n')
    expect(read().replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('clears the tier, and quality too when nothing else is in it', async () => {
    const project = projectJson()
    const { projectFile, read } = repo(project)
    await setFishTier(projectFile, 'under-100')
    expect(await setFishTier(projectFile, null)).toEqual({ ok: true })
    expect(read()).toBe(`${JSON.stringify(project, null, 2)}\n`)
  })

  it('keeps the sound-alike groups on one line each', async () => {
    const project = projectJson()
    ;(project.narration as { quality?: unknown }).quality = { soundAlike: [['inn', 'in']] }
    const { projectFile, read } = repo(project)
    await setFishTier(projectFile, '100')
    expect(read()).toContain('["inn", "in"]')
  })

  it('refuses a project file that cannot be read, and writes nothing', async () => {
    const { projectFile, read } = repo()
    writeFileSync(projectFile, '{ broken')
    const result = await setFishTier(projectFile, '100')
    expect(result.ok).toBe(false)
    expect(read()).toBe('{ broken')
  })

  it('saves two changes made together one after the other', async () => {
    const { projectFile, read } = repo()
    await Promise.all([setFishTier(projectFile, '100'), setFishTier(projectFile, '1000')])
    expect(JSON.parse(read()).narration.quality.fishTier).toBe('1000')
  })

  it('says why the file could not be written when the disk refuses it', async () => {
    const { projectFile, read } = repo()
    const before = read()
    chmodSync(dirname(projectFile), 0o555)
    try {
      expect(await setFishTier(projectFile, '100')).toEqual({
        ok: false,
        problems: [
          {
            file: 'audio-studio.json',
            path: 'narration.quality.fishTier',
            message: 'permission denied',
          },
        ],
      })
    } finally {
      chmodSync(dirname(projectFile), 0o755)
    }
    expect(read()).toBe(before)
  })
})
