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
