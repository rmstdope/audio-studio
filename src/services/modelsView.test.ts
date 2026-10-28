import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { modelsView } from './modelsView'

const entry = (model: string) => ({
  fp: 'x',
  voice: 'v1',
  model,
  parts: { cue: 'a', text: 'b', said: 'c', settings: 'd' },
  at: 'then',
})

function project(models: Record<string, string>) {
  const json = projectJson()
  ;(json.narration as Record<string, unknown>).models = models
  return json
}

const models = { audition: 's2.1-pro-free', draft: 's2.1-pro-free', final: 'drama-3' }

describe('modelsView', () => {
  it('totals every line of every part, and what the recorded clips were made with', async () => {
    const root = tempRepo({
      'audio-studio.json': project(models),
      'tts/cast.json': { speakers: { narrator: { voice: 'v1', style: '[warm]' } } },
      'tts/act1/script.json': [
        { key: 'a', speaker: 'narrator', text: 'Once.' },
        { key: 'b', speaker: 'narrator', text: 'Twice.' },
      ],
      'tts/act2/script.json': [{ key: 'c', speaker: 'narrator', text: 'Thrice.' }],
      'audio/act1/a.mp3': 'x',
      'audio/act1/manifest.json': { a: { file: 'a.mp3', speaker: 'narrator', duration: 1 } },
      'tts/act1/narration.lock.json': { a: entry('s2.1-pro-free') },
    })
    const view = await modelsView(join(root, 'audio-studio.json'))
    if (!view.ok) throw new Error(JSON.stringify(view.problems))
    expect(view.file).toBe('audio-studio.json')
    expect(view.models).toEqual(models)
    expect(view.castsEleven).toBe(false)
    expect(view.dialog.lines).toBe(3)
    expect(view.dialog.bytes).toBeGreaterThan(3 * 'Once.'.length)
    expect(Object.keys(view.recorded)).toEqual(['s2.1-pro-free'])
    expect(view.recorded['s2.1-pro-free']!.lines).toBe(1)
  })

  it('counts the cues inside a line in the bytes it sends', async () => {
    const files = (cues: object) => ({
      'audio-studio.json': project(models),
      'tts/cast.json': { speakers: { narrator: { voice: 'v1', style: '[warm]' } } },
      'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once upon a time.' }],
      'tts/act1/cues.json': cues,
    })
    const bytes = async (cues: object) => {
      const view = await modelsView(join(tempRepo(files(cues)), 'audio-studio.json'))
      if (!view.ok) throw new Error(JSON.stringify(view.problems))
      return view.dialog.bytes
    }
    expect((await bytes({ a: 'Once [hushed] upon a time.' })) - (await bytes({}))).toBe(
      '[hushed] '.length,
    )
  })

  it('has no lines in a project without dialog', async () => {
    const root = tempRepo({ 'audio-studio.json': project(models) })
    const view = await modelsView(join(root, 'audio-studio.json'))
    expect(view).toMatchObject({ ok: true, dialog: { lines: 0, bytes: 0 }, recorded: {} })
  })

  it('says why the project file cannot be read', async () => {
    const root = tempRepo({ 'audio-studio.json': '{' })
    expect(await modelsView(join(root, 'audio-studio.json'))).toMatchObject({ ok: false })
  })

  it('counts every language’s lines once each', async () => {
    const json = project(models)
    const narration = json.narration as Record<string, unknown>
    narration.languages = ['en', 'sv']
    narration.paths = {
      dialog: 'tts/{part}/{language}/script.json',
      cues: 'tts/{part}/{language}/cues.json',
      lock: 'tts/{part}/{language}/narration.lock.json',
      clips: 'audio/{part}/{language}',
      manifest: 'audio/{part}/{language}/manifest.json',
    }
    const root = tempRepo({
      'audio-studio.json': json,
      'tts/cast.json': { speakers: { narrator: { voice: 'v1' } } },
      'tts/act1/en/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
      'tts/act1/sv/script.json': [{ key: 'a', speaker: 'narrator', text: 'En gång.' }],
      'audio/act1/sv/a.mp3': 'x',
      'audio/act1/sv/manifest.json': { a: { file: 'a.mp3', speaker: 'narrator', duration: 1 } },
      'tts/act1/sv/narration.lock.json': { a: entry('drama-3') },
    })
    const view = await modelsView(join(root, 'audio-studio.json'))
    expect(view).toMatchObject({
      ok: true,
      dialog: { lines: 2 },
      recorded: { 'drama-3': { lines: 1 } },
    })
  })

  it('lists the length of every loop in the project, for Setup’s line about a short model', async () => {
    const root = tempRepo({
      'audio-studio.json': projectJson({
        music: {
          paths: {
            loops: 'tts/{part}/music.json',
            stingers: 'tts/stingers.json',
            briefs: 'music/briefs.json',
            lock: 'music/music.lock.json',
            clips: 'audio/music',
            manifest: 'audio/music/manifest.json',
          },
        },
      }),
      'tts/act1/music.json': [
        { id: 'hall', title: 'Hall', brief: 'lute', seconds: 90 },
        { id: 'cave', title: 'Cave', brief: 'drone', seconds: 20 },
      ],
      'tts/stingers.json': [{ id: 'win', title: 'Win', brief: 'fanfare', seconds: 6 }],
      'music/briefs.json': { cave: { seconds: 25 } },
    })
    const view = await modelsView(join(root, 'audio-studio.json'))
    if (!view.ok) throw new Error('expected a view')
    expect(view.music).toMatchObject({ model: 'balanced', loops: [90, 25] })
  })

  it('has no music for a project without a music section', async () => {
    const view = await modelsView(
      join(tempRepo({ 'audio-studio.json': projectJson() }), 'audio-studio.json'),
    )
    expect(view).toMatchObject({ ok: true, music: null })
  })
})

describe('modelsView, with ElevenLabs', () => {
  it('gives ElevenLabs’ stage models, and the characters each model’s recorded lines were sent', async () => {
    const root = tempRepo({
      'audio-studio.json': project(models),
      'tts/cast.json': { speakers: { narrator: { voice: 'eleven:g1', style: '[warm]' } } },
      'tts/act1/script.json': [{ key: 'a', speaker: 'narrator', text: 'Once.' }],
      'audio/act1/a.mp3': 'x',
      'audio/act1/manifest.json': { a: { file: 'a.mp3', speaker: 'narrator', duration: 1 } },
      'tts/act1/narration.lock.json': { a: entry('eleven_v3') },
    })
    const view = await modelsView(join(root, 'audio-studio.json'))
    if (!view.ok) throw new Error(JSON.stringify(view.problems))
    expect(view.elevenlabs).toEqual({
      audition: 'eleven_v3',
      draft: 'eleven_v3',
      final: 'eleven_v3',
    })
    expect(view.castsEleven).toBe(true)
    expect(view.elevenTts).toEqual({ stability: 0.5, similarityBoost: 0.75, style: 0 })
    // Sent with its style, which Eleven v3 reads: "[warm] Once."
    expect(view.recorded.eleven_v3).toEqual({ lines: 1, bytes: 12, characters: 12, bare: 5 })
  })
})
