import { describe, expect, it } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setStageModel, switchRetiredModels } from './models'
import { setSoundAlike } from './soundAlike'

function projectWith(models: Record<string, string>) {
  const project = projectJson()
  ;(project.narration as { models?: unknown }).models = models
  return project
}

function repo(project: Record<string, unknown>, indent: number | string = 2) {
  const root = tempRepo({})
  const projectFile = join(root, 'audio-studio.json')
  writeFileSync(projectFile, `${JSON.stringify(project, null, indent)}\n`)
  return { projectFile, read: () => readFileSync(projectFile, 'utf8') }
}

describe('switchRetiredModels', () => {
  it('rewrites both models and nothing else, in the file’s own indentation', async () => {
    const project = projectWith({ audition: 's2.1-pro-free', draft: 's1', final: 's1' })
    const { projectFile, read } = repo(project, 4)
    expect(await switchRetiredModels(projectFile, ['draft', 'final'])).toEqual({ ok: true })
    const switched = projectWith({
      audition: 's2.1-pro-free',
      draft: 's2.1-pro',
      final: 's2.1-pro',
    })
    expect(read()).toBe(`${JSON.stringify(switched, null, 4)}\n`)
  })

  it('keeps each sound-alike group on its line, so only the model lines change', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's1' }))
    await setSoundAlike(projectFile, [['inn', 'in']], [])
    const before = read()
    expect(before).toContain('["inn", "in"]')
    await switchRetiredModels(projectFile, ['draft', 'final'])
    expect(read()).toBe(before.replaceAll('"s1"', '"s2.1-pro"'))
  })

  it('leaves a model that is not s1 alone', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's2-pro' }))
    expect(await switchRetiredModels(projectFile, ['draft'])).toEqual({ ok: true })
    expect(JSON.parse(read()).narration.models).toEqual({ draft: 's2.1-pro', final: 's2-pro' })
  })

  it('keeps the line endings and a missing last newline', async () => {
    const root = tempRepo({})
    const projectFile = join(root, 'audio-studio.json')
    const project = projectWith({ final: 's1' })
    writeFileSync(projectFile, JSON.stringify(project, null, 2).replace(/\n/g, '\r\n'))
    expect(await switchRetiredModels(projectFile, ['final'])).toEqual({ ok: true })
    const text = readFileSync(projectFile, 'utf8')
    expect(text.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(
      true,
    )
    expect(text.endsWith('}')).toBe(true)
    expect(JSON.parse(text).narration.models.final).toBe('s2.1-pro')
  })

  it('refuses when the models on s1 in the file are not the ones agreed to, writing nothing', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's1' }))
    const before = read()
    for (const takes of [['draft'], ['final'], []] as const) {
      expect(await switchRetiredModels(projectFile, [...takes])).toMatchObject({
        ok: false,
        problems: [{ file: 'audio-studio.json', path: 'narration.models' }],
      })
    }
    expect(read()).toBe(before)
  })

  it('refuses when nothing is on s1 any more', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's2.1-pro', final: 's2.1-pro' }))
    const before = read()
    expect(await switchRetiredModels(projectFile, ['draft'])).toMatchObject({ ok: false })
    expect(read()).toBe(before)
  })

  it('writes nothing to a project file that cannot be used', async () => {
    const { projectFile, read } = repo({ name: 'broken' })
    const before = read()
    expect(await switchRetiredModels(projectFile, ['draft'])).toMatchObject({ ok: false })
    expect(read()).toBe(before)
  })

  it('does not lose either of two saves made together', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's1' }))
    const results = await Promise.all([
      switchRetiredModels(projectFile, ['draft', 'final']),
      setSoundAlike(projectFile, [['inn', 'Inne']], []),
    ])
    expect(results).toEqual([{ ok: true }, { ok: true }])
    const narration = JSON.parse(read()).narration
    expect(narration.models).toEqual({ draft: 's2.1-pro', final: 's2.1-pro' })
    expect(narration.quality.soundAlike).toEqual([['inn', 'Inne']])
  })

  it('says why the file could not be written when the switch is refused by the disk', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's1' }))
    const before = read()
    chmodSync(dirname(projectFile), 0o555)
    try {
      expect(await switchRetiredModels(projectFile, ['draft', 'final'])).toEqual({
        ok: false,
        problems: [
          { file: 'audio-studio.json', path: 'narration.models', message: 'permission denied' },
        ],
      })
    } finally {
      chmodSync(dirname(projectFile), 0o755)
    }
    expect(read()).toBe(before)
  })
})

describe('setStageModel', () => {
  const models = { audition: 's2.1-pro-free', draft: 's2.1-pro-free', final: 's2.1-pro-free' }

  it('changes one stage’s model and nothing else, in the file’s own indentation', async () => {
    const { projectFile, read } = repo(projectWith(models), 4)
    expect(await setStageModel(projectFile, 'draft', 's2.1-pro', 's2.1-pro-free')).toEqual({
      ok: true,
    })
    const saved = projectWith({ ...models, draft: 's2.1-pro' })
    expect(read()).toBe(`${JSON.stringify(saved, null, 4)}\n`)
  })

  it('keeps the line endings and a missing last newline', async () => {
    const root = tempRepo({})
    const projectFile = join(root, 'audio-studio.json')
    writeFileSync(projectFile, JSON.stringify(projectWith(models), null, 2).replace(/\n/g, '\r\n'))
    await setStageModel(projectFile, 'final', 'drama-3', 's2.1-pro-free')
    const text = readFileSync(projectFile, 'utf8')
    expect(text.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(
      true,
    )
    expect(text.endsWith('}')).toBe(true)
    expect(JSON.parse(text).narration.models.final).toBe('drama-3')
  })

  it('writes all three models when the file named none', async () => {
    const { projectFile, read } = repo(projectJson())
    await setStageModel(projectFile, 'audition', 's2.1-pro', 's2.1-pro-free')
    expect(JSON.parse(read()).narration.models).toEqual({ ...models, audition: 's2.1-pro' })
  })

  it('refuses, writing nothing, when the file changed since the page read it', async () => {
    const { projectFile, read } = repo(projectWith({ ...models, draft: 's2-pro' }))
    const before = read()
    const result = await setStageModel(projectFile, 'draft', 's2.1-pro', 's2.1-pro-free')
    expect(result).toMatchObject({ ok: false, problems: [{ path: 'narration.models.draft' }] })
    expect(read()).toBe(before)
  })

  it('refuses a model with no price, and s1', async () => {
    const { projectFile, read } = repo(projectWith(models))
    const before = read()
    expect(await setStageModel(projectFile, 'draft', 'mystery', 's2.1-pro-free')).toMatchObject({
      ok: false,
    })
    expect(await setStageModel(projectFile, 'draft', 's1', 's2.1-pro-free')).toMatchObject({
      ok: false,
    })
    expect(read()).toBe(before)
  })

  it('lets a stage on s1 move to s2.1-pro', async () => {
    const { projectFile, read } = repo(projectWith({ ...models, final: 's1' }))
    expect(await setStageModel(projectFile, 'final', 's2.1-pro', 's1')).toEqual({ ok: true })
    expect(JSON.parse(read()).narration.models.final).toBe('s2.1-pro')
  })

  it('says why the file could not be written, not that something failed', async () => {
    const { projectFile, read } = repo(projectWith(models))
    const before = read()
    chmodSync(dirname(projectFile), 0o555)
    try {
      expect(await setStageModel(projectFile, 'draft', 's2.1-pro', 's2.1-pro-free')).toEqual({
        ok: false,
        problems: [
          {
            file: 'audio-studio.json',
            path: 'narration.models.draft',
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
