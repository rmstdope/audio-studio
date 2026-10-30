import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { setNote } from './notes'
import { loadPart } from './workspace'

const files = {
  'content-studio.json': projectJson(),
  'tts/cast.json': { speakers: { mira: { voice: 'v-m' } } },
  'tts/act1/script.json': [
    { key: 'k1', speaker: 'mira', text: 'Welcome home.' },
    { key: 'k2', speaker: 'mira', text: 'Sit.' },
  ],
}

async function notesOf(projectFile: string) {
  const part = await loadPart(projectFile, 'act1')
  if (!part?.ok) throw new Error('expected the part')
  return part.part.notes
}

describe('setNote', () => {
  it('keeps a note on a line in the tool cache, and the part shows it', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    expect(await setNote(projectFile, 'act1', 'k1', ' too fast ')).toEqual({ ok: true })
    expect(await notesOf(projectFile)).toEqual({ k1: 'too fast' })
    expect(readdirSync(join(root, '.content-studio/notes'))).toEqual([
      expect.stringMatching(/^act1-[0-9a-f]{8}\.json$/),
    ])
  })

  it('removes a cleared note, and the file with the last one', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    await setNote(projectFile, 'act1', 'k1', 'a')
    await setNote(projectFile, 'act1', 'k2', 'b')
    await setNote(projectFile, 'act1', 'k1', '')
    expect(await notesOf(projectFile)).toEqual({ k2: 'b' })
    await setNote(projectFile, 'act1', 'k2', '')
    expect(existsSync(join(root, '.content-studio/notes'))).toBe(true)
    expect(readdirSync(join(root, '.content-studio/notes'))).toEqual([])
  })

  it('is null for an unknown part or line, writing nothing of the game’s', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    expect(await setNote(projectFile, 'act9', 'k1', 'x')).toBeNull()
    expect(await setNote(projectFile, 'act1', 'zz', 'x')).toBeNull()
    expect(existsSync(join(root, '.content-studio'))).toBe(false)
    expect(existsSync(join(root, 'tts/act1/cues.json'))).toBe(false)
  })

  it('names a notes file that does not fit, shows none, and never writes over it', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    await setNote(projectFile, 'act1', 'k1', 'kept by hand')
    const dir = join(root, '.content-studio/notes')
    const file = join(dir, readdirSync(dir)[0]!)
    writeFileSync(file, '{"version": 1, "part": "act1", "lines": {"k1": "kept by hand"},}')
    const part = await loadPart(projectFile, 'act1')
    if (!part?.ok) throw new Error('expected the part')
    expect(part.part.notes).toEqual({})
    expect(part.part.problems).toEqual([
      {
        file: `.content-studio/notes/${readdirSync(dir)[0]}`,
        path: '',
        message: expect.any(String),
      },
    ])
    const refused = await setNote(projectFile, 'act1', 'k2', 'new')
    expect(refused).toMatchObject({
      ok: false,
      problems: [{ file: expect.stringContaining('notes') }],
    })
    expect(readFileSync(file, 'utf8')).toContain('kept by hand')
  })

  it('keeps a note on a line that left the dialog, but does not show it', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'content-studio.json')
    await setNote(projectFile, 'act1', 'k2', 'gone soon')
    writeFileSync(
      join(root, 'tts/act1/script.json'),
      JSON.stringify([{ key: 'k1', speaker: 'mira', text: 'Welcome home.' }]),
    )
    expect(await notesOf(projectFile)).toEqual({})
    await setNote(projectFile, 'act1', 'k1', 'still here')
    const dir = join(root, '.content-studio/notes')
    expect(readFileSync(join(dir, readdirSync(dir)[0]!), 'utf8')).toContain('gone soon')
  })
})
