import { describe, expect, it } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { loadPart } from './workspace'
import { setCue } from './cues'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { mira: { voice: 'v1', style: '[warm]' } }, pronounce: {} },
  'tts/act1/script.json': [
    { key: 'a', speaker: 'mira', text: 'Hello.' },
    { key: 'b', speaker: 'mira', text: 'Goodbye.' },
  ],
}

describe('setCue', () => {
  it('creates the cues file with the first cue', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setCue(projectFile, 'act1', 'a', '  [whispering]  ')).toEqual({ ok: true })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe(
      '{\n  "a": "[whispering]"\n}\n',
    )
  })

  it('keeps the file’s own order and its other cues, adding a new cue at the end', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    const cuesFile = join(root, 'tts/act1/cues.json')
    writeFileSync(cuesFile, '{\n  "zz": "[old]",\n  "b": "[sad]"\n}\n')
    await setCue(projectFile, 'act1', 'a', '[happy]')
    await setCue(projectFile, 'act1', 'b', '[sadder]')
    expect(readFileSync(cuesFile, 'utf8')).toBe(
      '{\n  "zz": "[old]",\n  "b": "[sadder]",\n  "a": "[happy]"\n}\n',
    )
  })

  it('removes a cleared cue, so the line goes back to the character’s style', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await setCue(projectFile, 'act1', 'a', '[happy]')
    await setCue(projectFile, 'act1', 'a', '')
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe('{}\n')
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'a')).toMatchObject({
      cue: '[warm]',
      ownCue: false,
    })
  })

  it('delivers the line with its own cue from then on', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    await setCue(projectFile, 'act1', 'b', '[sad]')
    const part = await loadPart(projectFile, 'act1')
    expect(part?.ok && part.part.lines.find((l) => l.key === 'b')).toMatchObject({
      cue: '[sad]',
      ownCue: true,
    })
  })

  it('refuses a broken cues file instead of overwriting it', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    writeFileSync(join(root, 'tts/act1/cues.json'), '{ broken')
    const result = await setCue(projectFile, 'act1', 'a', '[x]')
    expect(result).toMatchObject({ ok: false, problems: [{ file: 'tts/act1/cues.json' }] })
    expect(readFileSync(join(root, 'tts/act1/cues.json'), 'utf8')).toBe('{ broken')
  })

  it('knows no unknown part or line', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(await setCue(projectFile, 'act9', 'a', '[x]')).toBeNull()
    expect(await setCue(projectFile, 'act1', 'nope', '[x]')).toBeNull()
  })
})
