import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { projectJson } from '../../test/helpers'
import { ProjectSchema, parseProject, partPathFor, problemsFrom } from './project'

function parse(value: unknown) {
  return ProjectSchema.safeParse(value)
}

function problems(value: unknown) {
  const result = parse(value)
  if (result.success) throw new Error('expected the project to be invalid')
  return problemsFrom('content-studio.json', result.error)
}

describe('the format version', () => {
  const refusal = {
    file: 'content-studio.json',
    path: 'version',
    message:
      'This project file is in the format before version 2. Add "version": 2 and move its fields as docs/project-files.md describes.',
  }

  it('reads a project file of version 2', () => {
    const read = parseProject('content-studio.json', projectJson())
    expect(read.ok && read.project.version).toBe(2)
  })

  it('refuses an unversioned file with one problem, whatever else is wrong in it', () => {
    const { version: _version, ...old } = projectJson()
    expect(parseProject('content-studio.json', { ...old, narration: 'x' })).toEqual({
      ok: false,
      problems: [refusal],
    })
  })

  it('refuses another version, or a file that is not an object', () => {
    for (const raw of [projectJson({ version: 1 }), projectJson({ version: '2' }), [], null]) {
      expect(parseProject('content-studio.json', raw)).toEqual({ ok: false, problems: [refusal] })
    }
  })

  it('says what else is wrong in a file of version 2', () => {
    const read = parseProject('content-studio.json', projectJson({ name: '' }))
    expect(!read.ok && read.problems.map((p) => p.path)).toEqual(['name'])
  })
})

describe('ProjectSchema', () => {
  it('fills in defaults for everything optional', () => {
    const result = parse(projectJson())
    expect(result.success).toBe(true)
    const project = result.data!
    expect(project.env).toBe('.env')
    expect(project.narration.models).toEqual({
      audition: 's2.1-pro-free',
      draft: 's2.1-pro-free',
      final: 's2.1-pro-free',
    })
    expect(project.narration.quality.minHeard).toBe(0.9)
    expect(project.narration.quality.soundAlike).toEqual([])
    expect(project.narration.output).toEqual({
      codec: 'mp3',
      bitrate: '64k',
      channels: 1,
      lufs: null,
    })
    expect(project.narration.audition.candidatesPerRound).toBe(5)
  })

  it('accepts a paid audition model whose price is known', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const parsed = parse({ ...base, narration: { ...narration, models: { audition: 's2.1-pro' } } })
    expect(parsed.success && parsed.data.narration.models.audition).toBe('s2.1-pro')
  })

  it('rejects an audition model without a known price, naming the stage', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({
      ...base,
      narration: { ...narration, models: { audition: 'mystery-9' } },
    })
    expect(found).toEqual([
      {
        file: 'content-studio.json',
        path: 'narration.models.audition',
        message: '"mystery-9" has no known price, so its cost cannot be shown',
      },
    ])
  })

  it('refuses a standard audition phrase too long for one take', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({
      ...base,
      narration: { ...narration, audition: { phrase: 'x'.repeat(401) } },
    })
    expect(found.map((p) => [p.path, p.message])).toEqual([
      [
        'narration.audition.phrase',
        'is 401 characters; a take is one piece of at most 400 (quality.chunkLimit)',
      ],
    ])
  })

  it('takes a standard audition phrase per declared language, each short enough for one take', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const withPhrases = (phrases: Record<string, string>) => ({
      ...base,
      languages: ['en', 'sv'],
      narration: {
        ...narration,
        paths: {
          dialog: 'tts/{part}/{language}/script.json',
          cues: 'tts/{part}/{language}/cues.json',
          lock: 'tts/{part}/{language}/narration.lock.json',
          clips: 'audio/{part}/{language}',
          manifest: 'audio/{part}/{language}/manifest.json',
        },
        audition: { phrases },
      },
    })
    const ok = parse(withPhrases({ sv: 'Kom in.' }))
    expect(ok.data?.narration.audition.phrases).toEqual({ sv: 'Kom in.' })
    expect(problems(withPhrases({ de: 'Komm herein.' })).map((p) => [p.path, p.message])).toEqual([
      ['narration.audition.phrases.de', '"de" is not one of the project’s languages'],
    ])
    expect(problems(withPhrases({ sv: 'x'.repeat(401) }))[0]?.path).toBe(
      'narration.audition.phrases.sv',
    )
  })

  it('never refuses a project for the built-in phrase, whatever chunk limit it allows', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    expect(
      parse({ ...base, narration: { ...narration, quality: { chunkLimit: 100 } } }).success,
    ).toBe(true)
  })

  it('reports only the chunk limit when the limit itself is wrong', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const found = problems({ ...base, narration: { ...narration, quality: { chunkLimit: 10 } } })
    expect(found.map((p) => p.path)).toEqual(['narration.quality.chunkLimit'])
  })

  it('takes groups of two words or more that sound the same', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const alike = (soundAlike: unknown) => ({
      ...base,
      narration: { ...narration, quality: { soundAlike } },
    })
    expect(parse(alike([['Lyria', 'Leer-ia']])).success).toBe(true)
    expect(problems(alike([['alone']])).map((p) => p.path)).toEqual([
      'narration.quality.soundAlike[0]',
    ])
    // Words or phrases, each word with a letter or digit: punctuation alone could never match.
    expect(parse(alike([['all right', 'alright']])).success).toBe(true)
    expect(problems(alike([['Lyria', 'Leer !!']])).map((p) => p.path)).toEqual([
      'narration.quality.soundAlike[0][1]',
    ])
    expect(problems(alike([['Lyria', '!!']])).map((p) => p.path)).toEqual([
      'narration.quality.soundAlike[0][1]',
    ])
  })

  it('takes the words that sound the same of the languages besides the source, and no others', () => {
    const base = projectJson()
    const narration = base.narration as Record<string, unknown>
    const paths = {
      dialog: 'tts/{part}/{language}/script.json',
      cues: 'tts/{part}/{language}/cues.json',
      lock: 'tts/{part}/{language}/lock.json',
      clips: 'audio/{part}/{language}',
      manifest: 'audio/{part}/{language}/manifest.json',
    }
    const by = (soundAlikeByLanguage: unknown) => ({
      ...base,
      languages: ['en', 'sv'],
      narration: { ...narration, paths, quality: { soundAlikeByLanguage } },
    })
    expect(parse(by({ sv: [['Lyria', 'Liria']] })).success).toBe(true)
    expect(problems(by({ sv: [['alone']] })).map((p) => p.path)).toEqual([
      'narration.quality.soundAlikeByLanguage.sv[0]',
    ])
    expect(problems(by({ de: [['a', 'b']] })).map((p) => p.path)).toEqual([
      'narration.quality.soundAlikeByLanguage.de',
    ])
    // The source language's own groups are `soundAlike`.
    expect(problems(by({ en: [['a', 'b']] })).map((p) => p.path)).toEqual([
      'narration.quality.soundAlikeByLanguage.en',
    ])
  })

  it('holds no setting of the person’s own: those are in the cache', () => {
    const project = parse({ ...projectJson(), takeFade: 1 }).data!
    expect('takeFade' in project).toBe(false)
  })

  it('requires {part} in part paths', () => {
    const base = projectJson()
    const narration = base.narration as { paths: Record<string, string> }
    const found = problems({
      ...base,
      narration: { ...narration, paths: { ...narration.paths, clips: 'audio' } },
    })
    expect(found.map((p) => p.path)).toEqual(['narration.paths.clips'])
  })

  it('takes the parts and what the game calls them at the top level', () => {
    const project = parse(projectJson({ partLabel: 'Chapter' })).data!
    expect(project.parts.map((part) => part.id)).toEqual(['act1', 'act2'])
    expect(project.partLabel).toBe('Chapter')
    const { partLabel: _label, ...unlabelled } = projectJson()
    expect(parse(unlabelled).data!.partLabel).toBe('Part')
  })

  it('needs the parts', () => {
    const { parts: _parts, ...rest } = projectJson()
    expect(problems(rest).map((p) => p.path)).toEqual(['parts'])
  })

  it('rejects duplicate part ids', () => {
    const parts = [
      { id: 'act1', title: 'A' },
      { id: 'act1', title: 'B' },
    ]
    expect(problems(projectJson({ parts }))[0]!.message).toBe('part ids must be unique')
  })

  it('writes array indexes in problem paths', () => {
    const parts = [{ id: 'act 1', title: 'A' }]
    expect(problems(projectJson({ parts }))[0]!.path).toBe('parts[0].id')
  })
})

describe('refresh', () => {
  it('is optional, and so is each of its commands', () => {
    expect(parse(projectJson()).data!.refresh).toBeUndefined()
    expect(parse(projectJson({ refresh: {} })).data!.refresh).toEqual({})
  })

  it('names the command for a part and the one for every shared list', () => {
    const refresh = { part: 'sh tools/refresh.sh {part}', shared: 'sh tools/refresh-shared.sh' }
    expect(parse(projectJson({ refresh })).data!.refresh).toEqual(refresh)
  })

  it('needs {part} in the part command, which is run for one part', () => {
    expect(problems(projectJson({ refresh: { part: 'sh tools/refresh.sh' } }))).toEqual([
      {
        file: 'content-studio.json',
        path: 'refresh.part',
        message: 'must contain {part}: the command is run for one part, given its id',
      },
    ])
  })

  it('refuses an empty command', () => {
    expect(problems(projectJson({ refresh: { shared: '' } })).map((p) => p.path)).toEqual([
      'refresh.shared',
    ])
  })
})

describe('partPathFor', () => {
  it('replaces every {part}', () => {
    expect(partPathFor('tts/{part}/x-{part}.json', 'act2')).toBe('tts/act2/x-act2.json')
  })
})

describe('ProjectSchema, loudness', () => {
  it('levels nothing unless the project names a target loudness', () => {
    expect(ProjectSchema.parse(projectJson()).narration.output.lufs).toBeNull()
    const levelled = projectJson({
      narration: { ...(projectJson().narration as object), output: { lufs: -16 } },
    })
    expect(ProjectSchema.parse(levelled).narration.output.lufs).toBe(-16)
  })
})

describe('ProjectSchema, paid models', () => {
  const withModels = (models: Record<string, string>) =>
    ProjectSchema.safeParse(
      projectJson({ narration: { ...(projectJson().narration as object), models } }),
    )

  it('takes a priced model for drafts and the final recording', () => {
    const parsed = withModels({ draft: 's2-pro', final: 'drama-3' })
    expect(parsed.success && parsed.data.narration.models).toEqual({
      audition: 's2.1-pro-free',
      draft: 's2-pro',
      final: 'drama-3',
    })
  })

  it('refuses a model without a known price', () => {
    expect(withModels({ draft: 'brand-new' }).success).toBe(false)
    expect(withModels({ audition: 'brand-new' }).success).toBe(false)
  })
})

describe('languages', () => {
  function withLanguages(languages: unknown, paths: Record<string, string> = {}) {
    const base = projectJson()
    const narration = base.narration as { paths: Record<string, string> }
    return {
      ...base,
      languages,
      narration: { ...narration, paths: { ...narration.paths, ...paths } },
    }
  }
  const everyPath = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }

  it('is English alone by default', () => {
    expect(parse(projectJson()).data!.languages).toEqual(['en'])
  })

  it('takes several languages when every path has {language}', () => {
    const result = parse(withLanguages(['en', 'sv', 'de'], everyPath))
    expect(result.data!.languages).toEqual(['en', 'sv', 'de'])
  })

  it('accepts {language} with one language', () => {
    expect(parse(withLanguages(['en'], everyPath)).success).toBe(true)
  })

  it('names each path that would be shared between languages', () => {
    const found = problems(
      withLanguages(['en', 'sv'], {
        ...everyPath,
        lock: 'tts/{part}/narration.lock.json',
      }),
    )
    expect(found.map((p) => p.path)).toEqual(['narration.paths.lock'])
    expect(found[0]!.message).toContain('{language}')
  })

  it('rejects an empty list, repeats and unknown codes', () => {
    expect(problems(withLanguages([])).length).toBeGreaterThan(0)
    expect(problems(withLanguages(['en', 'en'], everyPath))[0]!.message).toContain('unique')
    expect(problems(withLanguages(['en', 'Swedish'], everyPath))[0]!.path).toBe('languages[1]')
  })
})

describe('partPathFor with a language', () => {
  it('replaces {language} too', () => {
    expect(partPathFor('tts/{part}/{language}.json', 'act2', 'sv')).toBe('tts/act2/sv.json')
  })

  it('leaves {language} alone when none is given', () => {
    expect(partPathFor('tts/{part}/{language}.json', 'act2')).toBe('tts/act2/{language}.json')
  })
})

describe('the music section', () => {
  const music = (paths: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
    projectJson({
      music: {
        paths: {
          loops: 'tts/{part}/music.json',
          stingers: 'tts/stingers.json',
          briefs: 'music/briefs.json',
          lock: 'music/music.lock.json',
          clips: 'web/audio/music',
          manifest: 'web/audio/music/manifest.json',
          ...paths,
        },
        ...extra,
      },
    })

  it('is optional', () => {
    expect(parse(projectJson()).data!.music).toBeUndefined()
  })

  it('accepts the paths', () => {
    const result = parse(music())
    expect(result.success).toBe(true)
    expect(result.data!.music!.paths.stingers).toBe('tts/stingers.json')
  })

  it('needs {part} in the loops path', () => {
    expect(problems(music({ loops: 'tts/music.json' }))).toEqual([
      {
        file: 'content-studio.json',
        path: 'music.paths.loops',
        message: 'must contain {part}, or every part would share one file',
      },
    ])
  })

  it('refuses {language} in any music path, music being the same in every language', () => {
    const found = problems(music({ clips: 'web/{language}/music', lock: '{language}/lock.json' }))
    expect(found.map((p) => p.path).sort()).toEqual(['music.paths.clips', 'music.paths.lock'])
    expect(found[0]!.message).toContain('{language}')
  })
})

describe('the images section', () => {
  const images = (paths: Record<string, string> = {}) =>
    projectJson({
      images: {
        paths: {
          list: 'tts/{part}/images.json',
          style: 'images/style.json',
          prompts: 'images/prompts.json',
          lock: 'images/images.lock.json',
          clips: 'web/public/images/generated',
          manifest: 'web/public/images/generated/manifest.json',
          ...paths,
        },
      },
    })

  it('is optional', () => {
    expect(parse(projectJson()).data!.images).toBeUndefined()
  })

  it('accepts the six paths', () => {
    const result = parse(images())
    expect(result.success).toBe(true)
    expect(result.data!.images!.paths.prompts).toBe('images/prompts.json')
    expect(result.data!.images!.paths.clips).toBe('web/public/images/generated')
    expect(result.data!.images!.paths.manifest).toBe('web/public/images/generated/manifest.json')
  })

  it('names the main image model, or none (FLUX.2 klein)', () => {
    const withModel = (model: string) => {
      const base = images().images as Record<string, unknown>
      return projectJson({ images: { ...base, model } })
    }
    expect(parse(withModel('z-image-turbo')).data!.images!.model).toBe('z-image-turbo')
    expect(parse(images()).data!.images!.model).toBeUndefined()
    expect(problems(withModel('huge')).map((p) => p.path)).toEqual(['images.model'])
  })

  it('needs the clips folder and the manifest, where chosen images are written', () => {
    const base = images().images as { paths: Record<string, string> }
    const { clips: _clips, manifest: _manifest, ...rest } = base.paths
    const found = problems(projectJson({ images: { paths: rest } }))
    expect(found.map((p) => p.path).sort()).toEqual(['images.paths.clips', 'images.paths.manifest'])
  })

  it('needs {part} in the list path', () => {
    expect(problems(images({ list: 'tts/images.json' }))).toEqual([
      {
        file: 'content-studio.json',
        path: 'images.paths.list',
        message: 'must contain {part}, or every part would share one file',
      },
    ])
  })

  it('refuses {language} in any images path', () => {
    const found = problems(images({ style: '{language}/style.json' }))
    expect(found.map((p) => p.path)).toEqual(['images.paths.style'])
  })
})

describe('narration.sceneCueSpeakers', () => {
  it('is the narrator alone unless the project names speakers', () => {
    expect(parse(projectJson()).data!.narration.sceneCueSpeakers).toEqual(['narrator'])
    const base = projectJson().narration as Record<string, unknown>
    const named = projectJson({ narration: { ...base, sceneCueSpeakers: ['narrator', 'mira'] } })
    expect(parse(named).data!.narration.sceneCueSpeakers).toEqual(['narrator', 'mira'])
  })
})

describe('problemsFrom wording', () => {
  const base = projectJson()
  const messages = (value: unknown) => problems(value).map((p) => p.message)

  const narration = base.narration as Record<string, unknown>
  const quality = (value: Record<string, unknown>) => ({
    ...base,
    narration: { ...narration, quality: value },
  })

  it('says a number that is too small in plain words', () => {
    expect(messages(quality({ parallel: 0 }))).toEqual([
      'narration.quality.parallel must be 1 or more',
    ])
  })

  it('says a wrong type in plain words', () => {
    expect(messages(quality({ minHeard: 'long' }))).toEqual([
      'narration.quality.minHeard must be a number (it is text)',
    ])
  })

  it('says a missing key in plain words', () => {
    const { narration: _omitted, ...rest } = base
    expect(messages(rest)).toEqual(['narration is missing'])
  })

  it('says a text or list that is too short in plain words', () => {
    const all = messages({ ...base, languages: [] })
    expect(all).toEqual(['languages must be 1 or more items'])
  })

  it('says too big, exclusive bounds, whole numbers and choices in plain words', () => {
    const wording = (schema: z.ZodType, value: unknown) => {
      const r = schema.safeParse(value)
      if (r.success) throw new Error('expected a problem')
      return problemsFrom('f.json', r.error).map((p) => p.message)
    }
    const at = (schema: z.ZodType) => z.object({ k: schema })
    expect(wording(at(z.number().max(2)), { k: 3 })).toEqual(['k must be 2 or less'])
    expect(wording(at(z.number().positive()), { k: 0 })).toEqual(['k must be more than 0'])
    expect(wording(at(z.string().max(2)), { k: 'abc' })).toEqual([
      'k must be 2 or fewer characters',
    ])
    expect(wording(at(z.number().int()), { k: 1.5 })).toEqual(['k must be a whole number'])
    expect(wording(at(z.enum(['x', 'y'])), { k: 'z' })).toEqual(['k must be one of "x", "y"'])
    expect(wording(at(z.literal('mp3')), { k: 'ogg' })).toEqual(['k must be "mp3"'])
  })

  it('leaves a size message the schema wrote itself alone', () => {
    const r = z.object({ k: z.number().max(2, { error: 'k is too loud' }) }).safeParse({ k: 3 })
    if (r.success) throw new Error('expected a problem')
    expect(problemsFrom('f.json', r.error).map((p) => p.message)).toEqual(['k is too loud'])
  })
})

describe('the effects section', () => {
  const effectPaths = {
    list: 'tts/effects.json',
    lock: 'audio/effects.lock.json',
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  }
  const effects = (paths: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
    projectJson({ effects: { paths: { ...effectPaths, ...paths }, ...extra } })

  it('names the main effects model, Small SFX when absent', () => {
    expect(parse(effects()).data!.effects!.model).toBeUndefined()
    expect(parse(effects({}, { model: 'open-1' })).data!.effects!.model).toBe('open-1')
    expect(parse(effects({}, { model: 'other' })).success).toBe(false)
  })

  it('is optional', () => {
    expect(parse(projectJson()).data!.effects).toBeUndefined()
  })

  it('accepts the list, lock, clips and manifest paths', () => {
    const result = parse(effects())
    expect(result.success).toBe(true)
    expect(result.data!.effects).toEqual({ paths: effectPaths })
  })

  it('needs the lock, clips and manifest paths the game reads', () => {
    const bare = projectJson({ effects: { paths: { list: 'tts/effects.json' } } })
    expect(problems(bare).map((p) => p.path)).toEqual([
      'effects.paths.lock',
      'effects.paths.clips',
      'effects.paths.manifest',
    ])
  })

  it('refuses {language} and {part} in the list path: the list is for the whole game', () => {
    expect(problems(effects({ list: 'tts/{part}/effects.json' }))[0]!.path).toBe(
      'effects.paths.list',
    )
    expect(problems(effects({ list: '{language}/effects.json' }))[0]!.path).toBe(
      'effects.paths.list',
    )
  })
})

describe('the scenes section', () => {
  const scenes = (paths: Record<string, string> = {}) =>
    projectJson({
      scenes: {
        paths: {
          declarations: 'tts/{part}/scenes.json',
          mix: 'web/scenes/{part}.mix.json',
          ...paths,
        },
      },
    })

  it('is optional and names the two files of an act', () => {
    expect(parse(projectJson()).data!.scenes).toBeUndefined()
    expect(parse(scenes()).data!.scenes!.paths.mix).toBe('web/scenes/{part}.mix.json')
  })

  it('needs {part} in both paths and no {language}', () => {
    expect(parse(scenes({ declarations: 'tts/scenes.json' })).success).toBe(false)
    expect(parse(scenes({ mix: 'web/scenes.mix.json' })).success).toBe(false)
    expect(parse(scenes({ mix: 'web/{part}/{language}.json' })).success).toBe(false)
  })

  describe('the loudness target', () => {
    const paths = {
      declarations: 'tts/{part}/scenes.json',
      mix: 'web/scenes/{part}.mix.json',
    }
    const withLoudness = (loudness: unknown) => projectJson({ scenes: { paths, loudness } })

    it('is optional', () => {
      expect(parse(scenes()).data!.scenes!.loudness).toBeUndefined()
    })

    it('holds a target and a tolerance in dB', () => {
      const read = parse(withLoudness({ target: -20, tolerance: 2 }))
      expect(read.data!.scenes!.loudness).toEqual({ target: -20, tolerance: 2 })
    })

    it('needs both, and refuses a positive target or a negative tolerance', () => {
      expect(parse(withLoudness({ target: -20 })).success).toBe(false)
      expect(parse(withLoudness({ tolerance: 2 })).success).toBe(false)
      expect(parse(withLoudness({ target: 3, tolerance: 2 })).success).toBe(false)
      expect(parse(withLoudness({ target: -20, tolerance: -1 })).success).toBe(false)
    })
  })
})
