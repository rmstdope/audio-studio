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
    expect(view.dialog.lines).toBe(3)
    expect(view.dialog.bytes).toBeGreaterThan(3 * 'Once.'.length)
    expect(Object.keys(view.recorded)).toEqual(['s2.1-pro-free'])
    expect(view.recorded['s2.1-pro-free']!.lines).toBe(1)
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
})
