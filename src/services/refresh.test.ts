import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { refreshDialog } from './refresh'

const before = [
  { key: 'a', speaker: 'mira', text: 'Hello.' },
  { key: 'b', speaker: 'mira', text: 'Goodbye.' },
]
const after = JSON.stringify([
  { key: 'a', speaker: 'mira', text: 'Hello.' },
  { key: 'c', speaker: 'mira', text: 'Farewell.' },
])

function project(refreshDialog?: string) {
  const json = projectJson()
  ;(json.narration as Record<string, unknown>).refreshDialog = refreshDialog
  return {
    'audio-studio.json': json,
    'tts/cast.json': { speakers: {}, pronounce: {} },
    'tts/act1/script.json': before,
  }
}

describe('refreshDialog', () => {
  it('runs the command in the project root for the part, and says what changed', async () => {
    const root = tempRepo(project(`printf '%s' '${after}' > tts/{part}/script.json && echo done`))
    const result = await refreshDialog(join(root, 'audio-studio.json'), 'act1')
    expect(result).toMatchObject({
      ok: true,
      lines: 2,
      diff: { added: ['c'], removed: ['b'], changed: [] },
      output: 'done',
    })
    expect(JSON.parse(readFileSync(join(root, 'tts/act1/script.json'), 'utf8'))).toHaveLength(2)
  })

  it('reports a command that fails, with what it said', async () => {
    const root = tempRepo(project('echo "no such act" >&2; exit 3'))
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: false,
      reason: 'failed',
      output: expect.stringContaining('no such act'),
    })
  })

  it('reports a dialog the command left broken', async () => {
    const root = tempRepo(project('printf \'[{"key": 1}]\' > tts/{part}/script.json'))
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([
        expect.objectContaining({ file: 'tts/act1/script.json', path: '[0].key' }),
      ]),
    })
  })

  it('stops a command that takes too long, children included', async () => {
    const root = tempRepo(project('(sleep 30); true'))
    const started = Date.now()
    const result = await refreshDialog(join(root, 'audio-studio.json'), 'act1', { timeoutMs: 300 })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(result).toMatchObject({
      ok: false,
      reason: 'failed',
      message: expect.stringContaining('longer than'),
    })
  })

  it('runs one refresh of a part at a time', async () => {
    const root = tempRepo(project('echo start >> runs.txt; sleep 0.2; echo end >> runs.txt'))
    const projectFile = join(root, 'audio-studio.json')
    await Promise.all([refreshDialog(projectFile, 'act1'), refreshDialog(projectFile, 'act1')])
    expect(readFileSync(join(root, 'runs.txt'), 'utf8')).toBe('start\nend\nstart\nend\n')
  })

  it('keeps only the end of a long output', async () => {
    const root = tempRepo(project('seq 1 100000; exit 1'))
    const result = await refreshDialog(join(root, 'audio-studio.json'), 'act1')
    if (result?.ok !== false || !('output' in result)) throw new Error('expected a failure')
    expect(result.output.length).toBeLessThanOrEqual(4000)
    expect(result.output.endsWith('100000')).toBe(true)
  })

  it('does not guess what changed when the dialog could not be read before', async () => {
    const files = project(`printf '%s' '${after}' > tts/{part}/script.json`)
    const root = tempRepo({ ...files, 'tts/act1/script.json': '{ broken' })
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: true,
      lines: 2,
      diff: null,
    })
  })

  it('says when the project has no refresh command', async () => {
    const root = tempRepo(project())
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: false,
      reason: 'none',
    })
  })

  it('knows no unknown part', async () => {
    const root = tempRepo(project('true'))
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act9')).toBeNull()
  })
})
