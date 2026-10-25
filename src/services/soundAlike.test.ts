import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setSoundAlike } from './soundAlike'

function repo(project: Record<string, unknown> = projectJson(), indent = 2) {
  const root = tempRepo({})
  const projectFile = join(root, 'audio-studio.json')
  writeFileSync(projectFile, `${JSON.stringify(project, null, indent)}\n`)
  return { projectFile, read: () => readFileSync(projectFile, 'utf8') }
}

describe('setSoundAlike', () => {
  it('saves the groups in the project file, the rest of it as it was', async () => {
    const project = projectJson()
    ;(project.narration as { quality?: unknown }).quality = { minHeard: 0.8 }
    const { projectFile, read } = repo(project, 4)
    const result = await setSoundAlike(projectFile, [[' Lyria ', 'Liria', ''], []], [])
    expect(result).toEqual({ ok: true })
    const quality = { minHeard: 0.8, soundAlike: ['GROUP'] }
    const narration = { ...(project.narration as object), quality }
    // The file in its own indentation, each group on one line.
    const expected = JSON.stringify({ ...project, narration }, null, 4).replace(
      '"GROUP"',
      '["Lyria", "Liria"]',
    )
    expect(read()).toBe(`${expected}\n`)
  })

  it('leaves the key out when no group is left, and quality out if nothing else is in it', async () => {
    const project = projectJson()
    const { projectFile, read } = repo(project)
    await setSoundAlike(projectFile, [['inn', 'Inne']], [])
    expect(await setSoundAlike(projectFile, [], [['inn', 'Inne']])).toEqual({ ok: true })
    expect(read()).toBe(`${JSON.stringify(project, null, 2)}\n`)
  })

  it('refuses groups that changed in the file since editing began, and writes nothing', async () => {
    const { projectFile, read } = repo()
    await setSoundAlike(projectFile, [['inn', 'Inne']], [])
    const before = read()
    const result = await setSoundAlike(projectFile, [['a', 'b']], [])
    expect(result).toMatchObject({
      ok: false,
      problems: [{ file: 'audio-studio.json', path: 'narration.quality.soundAlike' }],
    })
    expect(read()).toBe(before)
  })

  it('refuses a group of one word, or a word that could never match', async () => {
    const { projectFile, read } = repo()
    const before = read()
    expect(await setSoundAlike(projectFile, [['Lyria']], [])).toMatchObject({
      ok: false,
      problems: [
        {
          message:
            '“Lyria” is alone in its group: add another word that sounds the same, or remove it.',
        },
      ],
    })
    expect(await setSoundAlike(projectFile, [['Lyria', 'Leer !!']], [])).toMatchObject({
      ok: false,
    })
    expect(read()).toBe(before)
  })

  it('adds quality at the end of narration, and keeps a quality written empty by hand', async () => {
    const project = projectJson()
    const { projectFile, read } = repo(project)
    await setSoundAlike(projectFile, [['inn', 'Inne']], [])
    const quality =
      '"quality": {\n      "soundAlike": [\n        ["inn", "Inne"]\n      ]\n    }\n  }\n}\n'
    expect(read().endsWith(quality)).toBe(true)
    ;(project.narration as { quality?: unknown }).quality = {}
    const empty = repo(project)
    expect(await setSoundAlike(empty.projectFile, [], [])).toEqual({ ok: true })
    expect(JSON.parse(empty.read()).narration.quality).toEqual({})
  })

  it('saves a phrase, its spaces made one', async () => {
    const { projectFile, read } = repo()
    await setSoundAlike(projectFile, [['all  right', 'alright']], [])
    expect(JSON.parse(read()).narration.quality.soundAlike).toEqual([['all right', 'alright']])
  })

  it('writes words with $ in them as they are', async () => {
    const { projectFile, read } = repo()
    expect(await setSoundAlike(projectFile, [["a$'", 'b$&', 'c$$']], [])).toEqual({ ok: true })
    expect(JSON.parse(read()).narration.quality.soundAlike).toEqual([["a$'", 'b$&', 'c$$']])
  })

  it('keeps the line endings, and a missing last newline', async () => {
    const root = tempRepo({})
    const projectFile = join(root, 'audio-studio.json')
    writeFileSync(projectFile, JSON.stringify(projectJson(), null, 2).replace(/\n/g, '\r\n'))
    await setSoundAlike(projectFile, [['inn', 'Inne']], [])
    const text = readFileSync(projectFile, 'utf8')
    expect(
      text.split('\n').every((line, i, all) => i === all.length - 1 || line.endsWith('\r')),
    ).toBe(true)
    expect(text.endsWith('}')).toBe(true)
  })

  it('writes nothing to a project file that cannot be used', async () => {
    const { projectFile, read } = repo({ name: 'broken' })
    const before = read()
    expect(await setSoundAlike(projectFile, [['a', 'b']], [])).toMatchObject({ ok: false })
    expect(read()).toBe(before)
  })
})
