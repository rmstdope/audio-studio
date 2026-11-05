import { describe, expect, it } from 'bun:test'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import {
  setElevenModel,
  setElevenSettings,
  setEffectModel,
  setImageModel,
  setMusicModel,
  setStageModel,
  switchRetiredModels,
} from './models'
import { setSoundAlike } from './soundAlike'

function projectWith(models: Record<string, string>) {
  const project = projectJson()
  ;(project.narration as { models?: unknown }).models = { fish: models }
  return project
}

function repo(project: Record<string, unknown>, indent: number | string = 2) {
  const root = tempRepo({})
  const projectFile = join(root, 'content-studio.json')
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
    expect(JSON.parse(read()).narration.models.fish).toEqual({ draft: 's2.1-pro', final: 's2-pro' })
  })

  it('keeps the line endings and a missing last newline', async () => {
    const root = tempRepo({})
    const projectFile = join(root, 'content-studio.json')
    const project = projectWith({ final: 's1' })
    writeFileSync(projectFile, JSON.stringify(project, null, 2).replace(/\n/g, '\r\n'))
    expect(await switchRetiredModels(projectFile, ['final'])).toEqual({ ok: true })
    const text = readFileSync(projectFile, 'utf8')
    expect(text.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(
      true,
    )
    expect(text.endsWith('}')).toBe(true)
    expect(JSON.parse(text).narration.models.fish.final).toBe('s2.1-pro')
  })

  it('refuses when the models on s1 in the file are not the ones agreed to, writing nothing', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's1' }))
    const before = read()
    for (const takes of [['draft'], ['final'], []] as const) {
      expect(await switchRetiredModels(projectFile, [...takes])).toMatchObject({
        ok: false,
        problems: [{ file: 'content-studio.json', path: 'narration.models.fish' }],
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
    expect(narration.models.fish).toEqual({ draft: 's2.1-pro', final: 's2.1-pro' })
    expect(narration.generate.soundAlike).toEqual({ en: [['inn', 'Inne']] })
  })

  it('says why the file could not be written when the switch is refused by the disk', async () => {
    const { projectFile, read } = repo(projectWith({ draft: 's1', final: 's1' }))
    const before = read()
    chmodSync(dirname(projectFile), 0o555)
    try {
      expect(await switchRetiredModels(projectFile, ['draft', 'final'])).toEqual({
        ok: false,
        problems: [
          {
            file: 'content-studio.json',
            path: 'narration.models.fish',
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
    const projectFile = join(root, 'content-studio.json')
    writeFileSync(projectFile, JSON.stringify(projectWith(models), null, 2).replace(/\n/g, '\r\n'))
    await setStageModel(projectFile, 'final', 'drama-3', 's2.1-pro-free')
    const text = readFileSync(projectFile, 'utf8')
    expect(text.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(
      true,
    )
    expect(text.endsWith('}')).toBe(true)
    expect(JSON.parse(text).narration.models.fish.final).toBe('drama-3')
  })

  it('writes all three models when the file named none', async () => {
    const { projectFile, read } = repo(projectJson())
    await setStageModel(projectFile, 'audition', 's2.1-pro', 's2.1-pro-free')
    expect(JSON.parse(read()).narration.models).toEqual({
      fish: { ...models, audition: 's2.1-pro' },
    })
  })

  it('refuses, writing nothing, when the file changed since the page read it', async () => {
    const { projectFile, read } = repo(projectWith({ ...models, draft: 's2-pro' }))
    const before = read()
    const result = await setStageModel(projectFile, 'draft', 's2.1-pro', 's2.1-pro-free')
    expect(result).toMatchObject({ ok: false, problems: [{ path: 'narration.models.fish.draft' }] })
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
    expect(JSON.parse(read()).narration.models.fish.final).toBe('s2.1-pro')
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
            file: 'content-studio.json',
            path: 'narration.models.fish.draft',
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

describe('setMusicModel', () => {
  const musicPaths = {
    from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
    clips: 'audio/music',
    manifest: 'audio/music/manifest.json',
  }
  const withMusic = (extra: Record<string, unknown> = {}) =>
    projectJson({ music: { ...musicPaths, ...extra } })

  it('writes music.model and nothing else, in the file’s own indentation', async () => {
    const { projectFile, read } = repo(withMusic(), 4)
    expect(await setMusicModel(projectFile, 'careful', 'balanced')).toEqual({ ok: true })
    const saved = withMusic({ model: 'careful' })
    expect(read()).toBe(`${JSON.stringify(saved, null, 4)}\n`)
  })

  it('changes a model the file already names', async () => {
    const { projectFile, read } = repo(withMusic({ model: 'quick' }))
    await setMusicModel(projectFile, 'quickest', 'quick')
    expect(JSON.parse(read()).music.model).toBe('quickest')
  })

  it('refuses, writing nothing, when the file changed since the page read it', async () => {
    const { projectFile, read } = repo(withMusic({ model: 'quick' }))
    const before = read()
    expect(await setMusicModel(projectFile, 'careful', 'balanced')).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio.json', path: 'music.model' }],
    })
    expect(read()).toBe(before)
  })

  it('refuses a model it does not know, and a project with no music', async () => {
    const { projectFile, read } = repo(withMusic())
    expect(await setMusicModel(projectFile, 'huge', 'balanced')).toMatchObject({ ok: false })
    const plain = repo(projectJson())
    expect(await setMusicModel(plain.projectFile, 'quick', 'balanced')).toMatchObject({
      ok: false,
      problems: [{ path: 'music' }],
    })
    expect(read()).toBe(`${JSON.stringify(withMusic(), null, 2)}\n`)
  })
})

describe('setImageModel', () => {
  const imagePaths = {
    list: 'tts/{part}/images.json',
    style: 'images/style.json',
    prompts: 'images/prompts.json',
    lock: 'images/images.lock.json',
    clips: 'web/images',
    manifest: 'web/images/manifest.json',
  }
  const withImages = (extra: Record<string, unknown> = {}) =>
    projectJson({ images: { paths: imagePaths, ...extra } })

  it('writes images.model and nothing else, in the file’s own indentation', async () => {
    const { projectFile, read } = repo(withImages(), 4)
    expect(await setImageModel(projectFile, 'z-image-turbo', 'klein')).toEqual({ ok: true })
    expect(read()).toBe(`${JSON.stringify(withImages({ model: 'z-image-turbo' }), null, 4)}\n`)
  })

  it('refuses, writing nothing, when the file changed since the page read it', async () => {
    const { projectFile, read } = repo(withImages({ model: 'z-image-turbo' }))
    const before = read()
    expect(await setImageModel(projectFile, 'klein', 'klein')).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio.json', path: 'images.model' }],
    })
    expect(read()).toBe(before)
  })

  it('refuses a model it does not know, and a project with no images', async () => {
    const { projectFile, read } = repo(withImages())
    const before = read()
    expect(await setImageModel(projectFile, 'huge', 'klein')).toMatchObject({ ok: false })
    expect(read()).toBe(before)
    const plain = repo(projectJson())
    expect(await setImageModel(plain.projectFile, 'klein', 'klein')).toMatchObject({
      ok: false,
      problems: [{ path: 'images' }],
    })
  })
})

describe('setEffectModel', () => {
  const effectPaths = {
    list: 'tts/effects.json',
    lock: 'audio/effects.lock.json',
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  }
  const withEffects = (extra: Record<string, unknown> = {}) =>
    projectJson({ effects: { paths: effectPaths, ...extra } })

  it('writes effects.model and nothing else, in the file’s own indentation', async () => {
    const { projectFile, read } = repo(withEffects(), 4)
    expect(await setEffectModel(projectFile, 'open-1', 'small-sfx')).toEqual({ ok: true })
    expect(read()).toBe(`${JSON.stringify(withEffects({ model: 'open-1' }), null, 4)}\n`)
  })

  it('refuses, writing nothing, when the file changed since the page read it', async () => {
    const { projectFile, read } = repo(withEffects({ model: 'open-1' }))
    const before = read()
    expect(await setEffectModel(projectFile, 'small-sfx', 'small-sfx')).toMatchObject({
      ok: false,
      problems: [{ file: 'content-studio.json', path: 'effects.model' }],
    })
    expect(read()).toBe(before)
  })

  it('refuses a model it does not know, and a project with no effects section', async () => {
    const { projectFile, read } = repo(withEffects())
    const before = read()
    expect(await setEffectModel(projectFile, 'huge', 'small-sfx')).toMatchObject({ ok: false })
    expect(read()).toBe(before)
    const plain = repo(projectJson())
    expect(await setEffectModel(plain.projectFile, 'open-1', 'small-sfx')).toMatchObject({
      ok: false,
      problems: [{ path: 'effects' }],
    })
  })
})

describe('setElevenModel', () => {
  it('changes one ElevenLabs stage’s model and nothing else, writing the section it needs', async () => {
    const { projectFile, read } = repo(projectJson(), 4)
    expect(await setElevenModel(projectFile, 'draft', 'eleven_flash_v2_5', 'eleven_v3')).toEqual({
      ok: true,
    })
    const saved = JSON.parse(read())
    expect(saved.narration.models).toEqual({
      elevenlabs: { audition: 'eleven_v3', draft: 'eleven_flash_v2_5', final: 'eleven_v3' },
    })
    expect(read()).toBe(
      `${JSON.stringify({ ...projectJson(), narration: { ...(projectJson().narration as object), models: saved.narration.models } }, null, 4)}\n`,
    )
  })

  it('refuses, writing nothing, a model it does not know, or a file changed meanwhile', async () => {
    const { projectFile, read } = repo(projectJson())
    const before = read()
    expect(await setElevenModel(projectFile, 'draft', 's2-pro', 'eleven_v3')).toMatchObject({
      ok: false,
      problems: [{ path: 'narration.models.elevenlabs.draft' }],
    })
    expect(
      await setElevenModel(projectFile, 'final', 'eleven_flash_v2_5', 'eleven_multilingual_v2'),
    ).toMatchObject({
      ok: false,
      problems: [
        {
          path: 'narration.models.elevenlabs.final',
          message: 'the model in the file changed since the page was read; reload the studio',
        },
      ],
    })
    expect(read()).toBe(before)
  })
})

describe('setElevenModel, a file written by hand', () => {
  it('keeps a hand-written section’s other keys, and the file’s line endings', async () => {
    const root = tempRepo({})
    const projectFile = join(root, 'content-studio.json')
    const project = projectJson({
      narration: {
        ...(projectJson().narration as object),
        models: { note: 'kept', elevenlabs: { final: 'eleven_multilingual_v2' } },
      },
    })
    writeFileSync(projectFile, JSON.stringify(project, null, 2).replace(/\n/g, '\r\n'))
    expect(await setElevenModel(projectFile, 'draft', 'eleven_flash_v2_5', 'eleven_v3')).toEqual({
      ok: true,
    })
    const text = readFileSync(projectFile, 'utf8')
    expect(text.split('\n').every((l, i, all) => i === all.length - 1 || l.endsWith('\r'))).toBe(
      true,
    )
    expect(JSON.parse(text).narration.models).toEqual({
      note: 'kept',
      elevenlabs: {
        audition: 'eleven_v3',
        draft: 'eleven_flash_v2_5',
        final: 'eleven_multilingual_v2',
      },
    })
  })
})

describe('setElevenSettings', () => {
  const defaults = { stability: 0.5, similarityBoost: 0.75, style: 0 }
  const tuned = { stability: 1, similarityBoost: 0.4, style: 0.3 }

  it('writes all three voice settings beside the models, and nothing else', async () => {
    const { projectFile, read } = repo(projectJson(), 4)
    expect(await setElevenSettings(projectFile, tuned, defaults)).toEqual({ ok: true })
    const saved = JSON.parse(read())
    expect(saved.narration.generate).toEqual({ elevenlabs: tuned })
    expect(read()).toBe(
      `${JSON.stringify({ ...projectJson(), narration: { ...(projectJson().narration as object), generate: { elevenlabs: tuned } } }, null, 4)}\n`,
    )
  })

  it('writes nothing for settings the file already holds', async () => {
    const { projectFile, read } = repo(projectJson())
    const before = read()
    expect(await setElevenSettings(projectFile, defaults, defaults)).toEqual({ ok: true })
    expect(read()).toBe(before)
  })

  it('refuses, writing nothing, settings out of range, or a file changed meanwhile', async () => {
    const { projectFile, read } = repo(projectJson())
    const before = read()
    expect(
      await setElevenSettings(projectFile, { ...tuned, stability: 0.3 }, defaults),
    ).toMatchObject({ ok: false, problems: [{ path: 'narration.generate.elevenlabs.stability' }] })
    expect(await setElevenSettings(projectFile, defaults, tuned)).toMatchObject({
      ok: false,
      problems: [
        {
          path: 'narration.generate.elevenlabs',
          message: 'the settings in the file changed since the page was read; reload the studio',
        },
      ],
    })
    expect(read()).toBe(before)
  })
})
