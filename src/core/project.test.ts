import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { narrationInLanguages, projectJson } from '../../test/helpers'
import {
  EFFECTS_EDITS_FILE,
  EFFECTS_LOCK_FILE,
  IMAGES_EDITS_FILE,
  IMAGES_LOCK_FILE,
  CAST_FILE,
  DEFAULT_PHRASE,
  MUSIC_EDITS_FILE,
  MUSIC_LOCK_FILE,
  ProjectSchema,
  narrationFile,
  noProjectMessage,
  parseProject,
  partPathFor,
  problemsFrom,
  scenesLockFile,
  soundAlikeOf,
  standardPhrase,
} from './project'

function parse(value: unknown) {
  return ProjectSchema.safeParse(value)
}

function problems(value: unknown) {
  const result = parse(value)
  if (result.success) throw new Error('expected the project to be invalid')
  return problemsFrom('content-studio.json', result.error)
}

describe('noProjectMessage', () => {
  it('names the folder searched and what to do', () => {
    expect(noProjectMessage('/games/x')).toBe(
      'No content-studio.json in /games/x or any folder above it.\n' +
        'Run content-studio from the game repository that has one, or pass --project <file>.',
    )
  })
})

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
  /** The test project with its narration section changed by `change`. */
  const withNarration = (change: Record<string, unknown>) => {
    const base = projectJson()
    return { ...base, narration: { ...(base.narration as object), ...change } }
  }
  /** The same in English and Swedish, every narration path with `{language}`. */
  const inSwedishToo = (change: Record<string, unknown>) => ({
    ...projectJson({ languages: ['en', 'sv'] }),
    narration: narrationInLanguages(change),
  })

  it('fills in defaults for everything optional', () => {
    const result = parse(projectJson())
    expect(result.success).toBe(true)
    const project = result.data!
    expect(project.env).toBe('.env')
    expect(project.narration.models).toEqual({
      fish: { audition: 's2.1-pro-free', draft: 's2.1-pro-free', final: 's2.1-pro-free' },
      elevenlabs: { audition: 'eleven_v3', draft: 'eleven_v3', final: 'eleven_v3' },
    })
    expect(project.narration.generate).toMatchObject({
      fish: { temperature: 0.7, topP: 0.7, speed: 1 },
      elevenlabs: { stability: 0.5, similarityBoost: 0.75, style: 0 },
      minHeard: 0.9,
      takes: 3,
      chunkLimit: 400,
      parallel: 4,
      transcriber: 'mlx-whisper',
      soundAlike: {},
      sceneCueSpeakers: ['narrator'],
    })
    expect(project.narration.output).toEqual({
      codec: 'mp3',
      bitrate: '64k',
      channels: 1,
      lufs: null,
    })
    expect(project.narration.audition).toEqual({
      phrase: {},
      candidatesPerRound: 5,
      searchLanguage: 'en',
    })
  })

  it('reads the dialog, clips and manifest from the narration section', () => {
    const narration = parse(projectJson()).data!.narration
    expect(narration.from).toEqual({ part: 'tts/{part}/script.json' })
    expect(narration.clips).toBe('audio/{part}')
    expect(narration.manifest).toBe('audio/{part}/manifest.json')
  })

  it('accepts a paid audition model whose price is known', () => {
    const parsed = parse(withNarration({ models: { fish: { audition: 's2.1-pro' } } }))
    expect(parsed.success && parsed.data.narration.models.fish.audition).toBe('s2.1-pro')
  })

  it('rejects an audition model without a known price, naming the stage', () => {
    const found = problems(withNarration({ models: { fish: { audition: 'mystery-9' } } }))
    expect(found).toEqual([
      {
        file: 'content-studio.json',
        path: 'narration.models.fish.audition',
        message: '"mystery-9" has no known price, so its cost cannot be shown',
      },
    ])
  })

  it('takes ElevenLabs’ stage models and voice settings', () => {
    const parsed = parse(
      withNarration({
        models: { elevenlabs: { final: 'eleven_multilingual_v2' } },
        generate: { elevenlabs: { stability: 1 } },
      }),
    ).data!
    expect(parsed.narration.models.elevenlabs.final).toBe('eleven_multilingual_v2')
    expect(parsed.narration.generate.elevenlabs.stability).toBe(1)
    expect(
      problems(withNarration({ models: { elevenlabs: { draft: 's2-pro' } } })).map((p) => p.path),
    ).toEqual(['narration.models.elevenlabs.draft'])
  })

  it('gives the source language the built-in audition phrase, and another language none', () => {
    const project = parse(inSwedishToo({})).data!
    expect(standardPhrase(project, 'en')).toBe(DEFAULT_PHRASE)
    expect(standardPhrase(project, 'sv')).toBeNull()
    const own = parse(inSwedishToo({ audition: { phrase: { en: 'Come in.', sv: 'Kom in.' } } }))
    expect(standardPhrase(own.data!, 'en')).toBe('Come in.')
    expect(standardPhrase(own.data!, 'sv')).toBe('Kom in.')
  })

  it('takes a standard audition phrase per declared language, each short enough for one take', () => {
    const withPhrases = (phrase: Record<string, string>) => inSwedishToo({ audition: { phrase } })
    expect(parse(withPhrases({ sv: 'Kom in.' })).data?.narration.audition.phrase).toEqual({
      sv: 'Kom in.',
    })
    expect(problems(withPhrases({ de: 'Komm herein.' })).map((p) => [p.path, p.message])).toEqual([
      ['narration.audition.phrase.de', '"de" is not one of the project’s languages'],
    ])
    expect(problems(withPhrases({ en: 'x'.repeat(401) })).map((p) => [p.path, p.message])).toEqual([
      [
        'narration.audition.phrase.en',
        'is 401 characters; a take is one piece of at most 400 (generate.chunkLimit)',
      ],
    ])
  })

  it('never refuses a project for the built-in phrase, whatever chunk limit it allows', () => {
    expect(parse(withNarration({ generate: { chunkLimit: 100 } })).success).toBe(true)
  })

  it('reports only the chunk limit when the limit itself is wrong', () => {
    const found = problems(
      withNarration({ generate: { chunkLimit: 10 }, audition: { phrase: { en: 'x'.repeat(50) } } }),
    )
    expect(found.map((p) => p.path)).toEqual(['narration.generate.chunkLimit'])
  })

  it('takes groups of two words or more that sound the same, by language', () => {
    const alike = (groups: unknown) => withNarration({ generate: { soundAlike: { en: groups } } })
    expect(parse(alike([['Lyria', 'Leer-ia']])).success).toBe(true)
    expect(problems(alike([['alone']])).map((p) => p.path)).toEqual([
      'narration.generate.soundAlike.en[0]',
    ])
    // Words or phrases, each word with a letter or digit: punctuation alone could never match.
    expect(parse(alike([['all right', 'alright']])).success).toBe(true)
    expect(problems(alike([['Lyria', 'Leer !!']])).map((p) => p.path)).toEqual([
      'narration.generate.soundAlike.en[0][1]',
    ])
    expect(problems(alike([['Lyria', '!!']])).map((p) => p.path)).toEqual([
      'narration.generate.soundAlike.en[0][1]',
    ])
  })

  it('takes the words that sound the same of the project’s languages, and no others', () => {
    const by = (soundAlike: unknown) => inSwedishToo({ generate: { soundAlike } })
    const project = parse(by({ en: [['inn', 'in']], sv: [['Lyria', 'Liria']] })).data!
    expect(soundAlikeOf(project, 'en')).toEqual([['inn', 'in']])
    expect(soundAlikeOf(project, 'sv')).toEqual([['Lyria', 'Liria']])
    expect(soundAlikeOf(parse(by({})).data!, 'sv')).toEqual([])
    expect(problems(by({ de: [['a', 'b']] })).map((p) => p.path)).toEqual([
      'narration.generate.soundAlike.de',
    ])
  })

  it('names the speakers that follow their scene’s cue under generate', () => {
    expect(parse(projectJson()).data!.narration.generate.sceneCueSpeakers).toEqual(['narrator'])
    const named = parse(withNarration({ generate: { sceneCueSpeakers: ['narrator', 'mira'] } }))
    expect(named.data!.narration.generate.sceneCueSpeakers).toEqual(['narrator', 'mira'])
  })

  it('holds no setting of the person’s own: those are in the cache', () => {
    const project = parse({ ...projectJson(), takeFade: 1 }).data!
    expect('takeFade' in project).toBe(false)
  })

  it('requires {part} in part paths', () => {
    const base = projectJson()
    const narration = {
      ...(base.narration as object),
      clips: 'audio',
      from: { part: 'tts/x.json' },
    }
    const found = problems({ ...base, narration })
    expect(found.map((p) => p.path)).toEqual(['narration.from.part', 'narration.clips'])
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
  const withModels = (fish: Record<string, string>) =>
    ProjectSchema.safeParse(
      projectJson({ narration: { ...(projectJson().narration as object), models: { fish } } }),
    )

  it('takes a priced model for drafts and the final recording', () => {
    const parsed = withModels({ draft: 's2-pro', final: 'drama-3' })
    expect(parsed.success && parsed.data.narration.models.fish).toEqual({
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
  function withLanguages(languages: unknown, paths: Record<string, unknown> = {}) {
    const base = projectJson()
    return { ...base, languages, narration: { ...(base.narration as object), ...paths } }
  }
  const everyPath = {
    from: { part: 'tts/{part}/{language}/script.json' },
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
        manifest: 'audio/{part}/manifest.json',
      }),
    )
    expect(found.map((p) => p.path)).toEqual(['narration.manifest'])
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
  const music = (fields: Record<string, unknown> = {}) =>
    projectJson({
      music: {
        from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
        clips: 'web/audio/music',
        manifest: 'web/audio/music/manifest.json',
        ...fields,
      },
    })

  it('is optional', () => {
    expect(parse(projectJson()).data!.music).toBeUndefined()
  })

  it('takes the loops and stingers from the game, and where the chosen takes go', () => {
    const result = parse(music({ model: 'careful' }))
    expect(result.success).toBe(true)
    expect(result.data!.music).toEqual({
      from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
      model: 'careful',
      clips: 'web/audio/music',
      manifest: 'web/audio/music/manifest.json',
    })
  })

  it('may have loops only, or stingers only', () => {
    expect(parse(music({ from: { part: 'tts/{part}/music.json' } })).success).toBe(true)
    expect(parse(music({ from: { shared: 'tts/stingers.json' } })).success).toBe(true)
  })

  it('needs at least one list', () => {
    expect(problems(music({ from: {} }))).toEqual([
      {
        file: 'content-studio.json',
        path: 'music.from',
        message: 'name the loops (part), the stingers (shared) or both',
      },
    ])
  })

  it('needs {part} in the loops path', () => {
    expect(problems(music({ from: { part: 'tts/music.json' } }))).toEqual([
      {
        file: 'content-studio.json',
        path: 'music.from.part',
        message: 'must contain {part}, or every part would share one file',
      },
    ])
  })

  it('refuses {language} in any music path, music being the same in every language', () => {
    const found = problems(
      music({ clips: 'web/{language}/music', from: { shared: '{language}/stingers.json' } }),
    )
    expect(found.map((p) => p.path).sort()).toEqual(['music.clips', 'music.from.shared'])
    expect(found[0]!.message).toContain('{language}')
  })

  it('refuses a part called shared or stingers, the names the music lock gives the stingers', () => {
    const parts = [
      { id: 'act1', title: 'Act I' },
      { id: 'shared', title: 'Shared' },
      { id: 'stingers', title: 'Stingers' },
    ]
    expect(problems({ ...music(), parts })).toEqual(
      [1, 2].map((i) => ({
        file: 'content-studio.json',
        path: `parts[${i}].id`,
        message: `"${parts[i]!.id}" names the stingers in the music lock: give the part another id`,
      })),
    )
    expect(parse(projectJson({ parts })).success).toBe(true)
  })

  it('keeps the edits and the lock at fixed places in the studio folder', () => {
    expect(MUSIC_EDITS_FILE).toBe('content-studio/music/edits.json')
    expect(MUSIC_LOCK_FILE).toBe('content-studio/music/lock.json')
  })
})

describe('the images section', () => {
  const section = (extra: Record<string, unknown> = {}) => ({
    from: { part: 'tts/{part}/images.json' },
    clips: 'web/public/images/generated',
    manifest: 'web/public/images/generated/manifest.json',
    ...extra,
  })
  const images = (extra: Record<string, unknown> = {}) => projectJson({ images: section(extra) })

  it('is optional', () => {
    expect(parse(projectJson()).data!.images).toBeUndefined()
  })

  it("names each part's images, the clips folder and the manifest", () => {
    const result = parse(images())
    expect(result.success).toBe(true)
    expect(result.data!.images!.from.part).toBe('tts/{part}/images.json')
    expect(result.data!.images!.clips).toBe('web/public/images/generated')
    expect(result.data!.images!.manifest).toBe('web/public/images/generated/manifest.json')
  })

  it('names the main image model, or none (FLUX.2 klein)', () => {
    expect(parse(images({ model: 'z-image-turbo' })).data!.images!.model).toBe('z-image-turbo')
    expect(parse(images()).data!.images!.model).toBeUndefined()
    expect(problems(images({ model: 'huge' })).map((p) => p.path)).toEqual(['images.model'])
  })

  it('needs the clips folder and the manifest, where chosen images are written', () => {
    const { clips: _clips, manifest: _manifest, ...rest } = section()
    const found = problems(projectJson({ images: rest }))
    expect(found.map((p) => p.path).sort()).toEqual(['images.clips', 'images.manifest'])
  })

  it("needs each part's list, with {part} in its path", () => {
    expect(problems(images({ from: {} })).map((p) => p.path)).toEqual(['images.from.part'])
    expect(problems(images({ from: { part: 'tts/images.json' } }))).toEqual([
      {
        file: 'content-studio.json',
        path: 'images.from.part',
        message: 'must contain {part}, or every part would share one file',
      },
    ])
  })

  it('refuses {language} in any images path', () => {
    const found = problems(images({ clips: '{language}/generated' }))
    expect(found.map((p) => p.path)).toEqual(['images.clips'])
  })

  it('keeps the edits (with the style) and the lock at fixed places in the studio folder', () => {
    expect(IMAGES_EDITS_FILE).toBe('content-studio/images/edits.json')
    expect(IMAGES_LOCK_FILE).toBe('content-studio/images/lock.json')
  })
})

describe('narrationFile', () => {
  const project = { languages: ['en', 'sv'] }

  it('names a part’s edits and lock in the source language by the part alone', () => {
    expect(narrationFile(project, 'act1', 'en', 'edits')).toBe(
      'content-studio/narration/act1.edits.json',
    )
    expect(narrationFile(project, 'act1', 'en', 'lock')).toBe(
      'content-studio/narration/act1.lock.json',
    )
  })

  it('names another language’s with its code', () => {
    expect(narrationFile(project, 'act2', 'sv', 'edits')).toBe(
      'content-studio/narration/act2.sv.edits.json',
    )
    expect(narrationFile(project, 'act2', 'sv', 'lock')).toBe(
      'content-studio/narration/act2.sv.lock.json',
    )
  })

  it('keeps the cast at one fixed place', () => {
    expect(CAST_FILE).toBe('content-studio/narration/cast.json')
  })
})

describe('problemsFrom wording', () => {
  const base = projectJson()
  const messages = (value: unknown) => problems(value).map((p) => p.message)

  const narration = base.narration as Record<string, unknown>
  const quality = (value: Record<string, unknown>) => ({
    ...base,
    narration: { ...narration, generate: value },
  })

  it('says a number that is too small in plain words', () => {
    expect(messages(quality({ parallel: 0 }))).toEqual([
      'narration.generate.parallel must be 1 or more',
    ])
  })

  it('says a wrong type in plain words', () => {
    expect(messages(quality({ minHeard: 'long' }))).toEqual([
      'narration.generate.minHeard must be a number (it is text)',
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
  const section = (extra: Record<string, unknown> = {}) => ({
    from: { shared: 'tts/effects.json' },
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
    ...extra,
  })
  const effects = (extra: Record<string, unknown> = {}) => projectJson({ effects: section(extra) })

  it('names the main effects model, Small SFX when absent', () => {
    expect(parse(effects()).data!.effects!.model).toBeUndefined()
    expect(parse(effects({ model: 'open-1' })).data!.effects!.model).toBe('open-1')
    expect(problems(effects({ model: 'other' })).map((p) => p.path)).toEqual(['effects.model'])
  })

  it('is optional', () => {
    expect(parse(projectJson()).data!.effects).toBeUndefined()
  })

  it("names the game's one list, the clips folder and the manifest", () => {
    const result = parse(effects())
    expect(result.success).toBe(true)
    expect(result.data!.effects).toEqual(section())
  })

  it('needs the shared list, the clips folder and the manifest', () => {
    expect(problems(effects({ from: {} })).map((p) => p.path)).toEqual(['effects.from.shared'])
    const { clips: _clips, manifest: _manifest, ...rest } = section()
    const found = problems(projectJson({ effects: rest }))
    expect(found.map((p) => p.path).sort()).toEqual(['effects.clips', 'effects.manifest'])
  })

  it('takes no list per part: sound effects are for the whole game', () => {
    const found = problems(effects({ from: { part: 'tts/{part}/effects.json' } }))
    expect(found.map((p) => p.path)).toEqual(['effects.from.shared'])
  })

  it('refuses {language} and {part} in any effects path', () => {
    for (const [field, value] of [
      ['from', { shared: 'tts/{part}/effects.json' }],
      ['from', { shared: '{language}/effects.json' }],
      ['clips', 'audio/{part}'],
      ['manifest', 'audio/{language}/manifest.json'],
    ] as const) {
      const found = problems(effects({ [field]: value }))
      expect(found.map((p) => p.path)).toEqual([
        field === 'from' ? 'effects.from.shared' : `effects.${field}`,
      ])
    }
  })

  it('refuses the paths of the format before version 2', () => {
    const old = projectJson({
      effects: {
        paths: { list: 'tts/effects.json', lock: 'a.json', clips: 'a', manifest: 'a/m.json' },
      },
    })
    expect(problems(old).map((p) => p.path)).toContain('effects.from')
  })

  it('keeps the edits and the lock at fixed places in the studio folder', () => {
    expect(EFFECTS_EDITS_FILE).toBe('content-studio/effects/edits.json')
    expect(EFFECTS_LOCK_FILE).toBe('content-studio/effects/lock.json')
  })
})

describe('the scenes section', () => {
  const section = (extra: Record<string, unknown> = {}) => ({
    from: { part: 'tts/{part}/scenes.json' },
    mix: 'web/scenes/{part}.mix.json',
    ...extra,
  })
  const scenes = (extra: Record<string, unknown> = {}) => projectJson({ scenes: section(extra) })

  it("is optional and names each part's scene list and mix", () => {
    expect(parse(projectJson()).data!.scenes).toBeUndefined()
    expect(parse(scenes()).data!.scenes).toEqual(section())
  })

  it('needs the list and the mix', () => {
    expect(problems(scenes({ from: {} })).map((p) => p.path)).toEqual(['scenes.from.part'])
    const { mix: _mix, ...rest } = section()
    expect(problems(projectJson({ scenes: rest })).map((p) => p.path)).toEqual(['scenes.mix'])
  })

  it('needs {part} in both paths and no {language}', () => {
    for (const [field, value] of [
      ['from', { part: 'tts/scenes.json' }],
      ['from', { part: 'tts/{part}/{language}.json' }],
      ['mix', 'web/scenes.mix.json'],
      ['mix', 'web/{part}/{language}.json'],
    ] as const) {
      const found = problems(scenes({ [field]: value }))
      expect(found.map((p) => p.path)).toEqual([
        field === 'from' ? 'scenes.from.part' : 'scenes.mix',
      ])
    }
  })

  it('refuses the paths and loudness of the format before version 2', () => {
    const old = projectJson({
      scenes: {
        paths: { declarations: 'tts/{part}/scenes.json', mix: 'web/scenes/{part}.mix.json' },
        loudness: { target: -20, tolerance: 2 },
      },
    })
    expect(problems(old).map((p) => p.path)).toEqual(['scenes.from', 'scenes.mix'])
  })

  it("keeps each part's lock at a fixed place in the studio folder", () => {
    expect(scenesLockFile('act1')).toBe('content-studio/scenes/act1.lock.json')
  })

  describe('the loudness a scene should sit at', () => {
    const withOutput = (output: unknown) => scenes({ output })

    it('is optional', () => {
      expect(parse(scenes()).data!.scenes!.output).toBeUndefined()
    })

    it('holds the loudness in LUFS and a tolerance in dB', () => {
      const read = parse(withOutput({ lufs: -20, tolerance: 2 }))
      expect(read.data!.scenes!.output).toEqual({ lufs: -20, tolerance: 2 })
    })

    it('needs both, and refuses a positive loudness or a negative tolerance', () => {
      expect(problems(withOutput({ lufs: -20 })).map((p) => p.path)).toEqual([
        'scenes.output.tolerance',
      ])
      expect(problems(withOutput({ tolerance: 2 })).map((p) => p.path)).toEqual([
        'scenes.output.lufs',
      ])
      expect(parse(withOutput({ lufs: 3, tolerance: 2 })).success).toBe(false)
      expect(parse(withOutput({ lufs: -20, tolerance: -1 })).success).toBe(false)
    })
  })
})
