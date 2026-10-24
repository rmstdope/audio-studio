import { describe, expect, it } from 'bun:test'
import { readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { HEARD_DIR, heardFor, keepHeard } from './heard'

const at = '2026-10-24T16:11:29.762Z'
const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': { speakers: { mira: { voice: 'v-m' } } },
  'tts/act1/script.json': [{ key: 'k1', speaker: 'mira', text: 'Welcome home.' }],
  'tts/act1/narration.lock.json': {
    k1: {
      fp: 'f',
      voice: 'v-m',
      model: 'm',
      parts: { cue: 'c', text: 't', said: 's', settings: 'x' },
      heard: 0.5,
      at,
    },
  },
}
const line = { at, words: ['Welcome'], missed: [1] }

function project() {
  return join(tempRepo(files), 'audio-studio.json')
}

describe('what Whisper heard, kept', () => {
  it('gives what was kept for the line’s take', async () => {
    const projectFile = project()
    await keepHeard(projectFile, 'act1', 'k1', line)
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({ ok: true, heard: line })
  })

  it('gives nothing for a later take, or when nothing was kept', async () => {
    const projectFile = project()
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({ ok: true, heard: null })
    await keepHeard(projectFile, 'act1', 'k1', { ...line, at: '2026-10-23T00:00:00.000Z' })
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({ ok: true, heard: null })
  })

  it('forgets a line heard in full, and the file once none is left', async () => {
    const projectFile = project()
    await keepHeard(projectFile, 'act1', 'k1', line)
    await keepHeard(projectFile, 'act1', 'k1', null)
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({ ok: true, heard: null })
    expect(readdirSync(join(projectFile, '..', HEARD_DIR))).toEqual([])
  })

  it('ignores a kept file that does not fit', async () => {
    const projectFile = project()
    await keepHeard(projectFile, 'act1', 'k1', line)
    const dir = join(projectFile, '..', HEARD_DIR)
    writeFileSync(join(dir, readdirSync(dir)[0]!), '{"version": 2}')
    expect(await heardFor(projectFile, 'act1', 'k1')).toEqual({ ok: true, heard: null })
  })

  it('is null for an unknown part or line', async () => {
    const projectFile = project()
    expect(await heardFor(projectFile, 'act9', 'k1')).toBeNull()
    expect(await heardFor(projectFile, 'act1', 'k9')).toBeNull()
  })
})
