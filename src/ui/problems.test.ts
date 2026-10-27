import { describe, expect, it } from 'bun:test'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRepo } from '../../test/helpers'
import { loadPart, loadProject } from '../services/workspace'
import { notShown } from './problems'

describe('the problems on a part’s page', () => {
  it('lists each cast-file problem once, across the top banner and the part’s own', async () => {
    const root = tempRepo({})
    cpSync(join(import.meta.dir, '../../test/fixtures/sample'), root, { recursive: true })
    // The cast broken as when the bug was seen: a voice that is a number.
    const castFile = join(root, 'tts/cast.json')
    const cast = JSON.parse(readFileSync(castFile, 'utf8')) as {
      speakers: Record<string, Record<string, unknown>>
    }
    cast.speakers.narrator!.voice = 42
    writeFileSync(castFile, JSON.stringify(cast, null, 2))
    const file = join(root, 'audio-studio.json')
    const project = await loadProject(file)
    const part = await loadPart(file, 'act1')
    if (!project.ok || !part?.ok) throw new Error('the sample did not load')

    const top = project.summary.problems
    const own = notShown(part.part.problems, top)
    const castProblems = [...top, ...own].filter((p) => p.file === 'tts/cast.json')
    expect(castProblems.length).toBeGreaterThan(0)
    const said = castProblems.map((p) => `${p.path}: ${p.message}`)
    expect(said).toEqual([...new Set(said)])
  })

  it('keeps a problem only the part has', () => {
    const shown = [{ file: 'tts/cast.json', path: 'speakers', message: 'is wrong' }]
    const notes = { file: 'tts/act1/notes.json', path: '', message: 'is not JSON' }
    expect(notShown([...shown, notes], shown)).toEqual([notes])
  })
})
