import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import {
  isRefreshing,
  isRefreshingShared,
  refreshDialog,
  refreshShared,
  stopRefreshes,
} from './refresh'

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
    const root = tempRepo(project('(sleep 1; echo late > marker.txt); true'))
    const result = await refreshDialog(join(root, 'audio-studio.json'), 'act1', { timeoutMs: 300 })
    expect(result).toMatchObject({
      ok: false,
      reason: 'failed',
      message: expect.stringContaining('longer than'),
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(existsSync(join(root, 'marker.txt'))).toBe(false)
  })

  it('names a signal from outside rather than calling it a timeout', async () => {
    const root = tempRepo(project('kill -9 $$'))
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: false,
      message: 'The command was stopped by SIGKILL.',
    })
  })

  it('judges by the command, not by what it left running in the background', async () => {
    const root = tempRepo(project(`sleep 30 & printf '%s' '${after}' > tts/{part}/script.json`))
    const started = Date.now()
    const result = await refreshDialog(join(root, 'audio-studio.json'), 'act1', {
      timeoutMs: 20_000,
    })
    expect(result).toMatchObject({ ok: true, lines: 2 })
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('leaves nothing running in the background once the command is done', async () => {
    const root = tempRepo(project('(sleep 1 && echo late > marker.txt) >/dev/null 2>&1 &'))
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(existsSync(join(root, 'marker.txt'))).toBe(false)
  })

  it('says while a part is refreshing, and stops every refresh when the studio stops', async () => {
    const root = tempRepo(project('(sleep 1; echo late > marker.txt); true'))
    const projectFile = join(root, 'audio-studio.json')
    const running = refreshDialog(projectFile, 'act1')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(isRefreshing(projectFile, 'act1')).toBe(true)
    expect(isRefreshing(projectFile, 'act2')).toBe(false)
    stopRefreshes()
    expect(await running).toMatchObject({ ok: false, reason: 'failed' })
    expect(isRefreshing(projectFile, 'act1')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(existsSync(join(root, 'marker.txt'))).toBe(false)
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

describe('refreshing the music lists', () => {
  const loop = (id: string, extra = {}) => ({
    id,
    title: id.toUpperCase(),
    brief: 'b',
    seconds: 80,
    ...extra,
  })
  const music = (refreshShared?: string) => ({
    refreshShared,
    paths: {
      loops: 'tts/{part}/music.json',
      stingers: 'tts/stingers.json',
      briefs: 'music/briefs.json',
      lock: 'music/music.lock.json',
      clips: 'audio/music',
      manifest: 'audio/music/manifest.json',
    },
  })
  const withMusic = (command: string, shared?: string, files: Record<string, unknown> = {}) => {
    const json = projectJson({ music: music(shared) })
    ;(json.narration as Record<string, unknown>).refreshDialog = command
    return {
      'audio-studio.json': json,
      'tts/cast.json': { speakers: {}, pronounce: {} },
      'tts/act1/script.json': before,
      ...files,
    }
  }
  const writeLoops = `printf '%s' '${JSON.stringify([loop('b'), loop('c')])}' > tts/{part}/music.json`

  it('names the loops an act’s refresh added and removed', async () => {
    const root = tempRepo(
      withMusic(`${writeLoops} && printf '%s' '${after}' > tts/{part}/script.json`, undefined, {
        'tts/act1/music.json': [loop('a'), loop('b')],
      }),
    )
    const result = await refreshDialog(join(root, 'audio-studio.json'), 'act1')
    expect(result).toMatchObject({
      ok: true,
      loops: { added: [{ id: 'c', title: 'C' }], removed: [{ id: 'a', title: 'A' }], total: 2 },
    })
  })

  it('counts every loop as added when the act had no list before', async () => {
    const root = tempRepo(
      withMusic(`${writeLoops} && printf '%s' '${after}' > tts/{part}/script.json`),
    )
    expect(await refreshDialog(join(root, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: true,
      loops: {
        added: [
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
        ],
        removed: [],
      },
    })
  })

  it('says nothing of loops when the command wrote no list, or the project has no music', async () => {
    const wrote = tempRepo(withMusic(`printf '%s' '${after}' > tts/{part}/script.json`))
    expect(await refreshDialog(join(wrote, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: true,
      loops: null,
    })
    const plain = tempRepo(project(`printf '%s' '${after}' > tts/{part}/script.json`))
    expect(await refreshDialog(join(plain, 'audio-studio.json'), 'act1')).toMatchObject({
      ok: true,
      loops: null,
    })
  })

  it('runs refreshShared in the project root and names the stingers added and removed', async () => {
    const list = JSON.stringify([loop('victory', { seconds: 5 })])
    const root = tempRepo(
      withMusic('true', `printf '%s' '${list}' > tts/stingers.json && echo listed`, {
        'tts/stingers.json': [loop('old', { seconds: 5 })],
      }),
    )
    expect(await refreshShared(join(root, 'audio-studio.json'))).toEqual({
      ok: true,
      stingers: 1,
      change: {
        added: [{ id: 'victory', title: 'VICTORY' }],
        removed: [{ id: 'old', title: 'OLD' }],
      },
      output: 'listed',
    })
  })

  it('says when the project has no shared command', async () => {
    const root = tempRepo(withMusic('true'))
    expect(await refreshShared(join(root, 'audio-studio.json'))).toMatchObject({
      ok: false,
      reason: 'none',
    })
  })

  it('reports a failing command, a missing list and a broken one', async () => {
    const failing = tempRepo(withMusic('true', 'echo oops >&2; exit 2'))
    expect(await refreshShared(join(failing, 'audio-studio.json'))).toMatchObject({
      ok: false,
      reason: 'failed',
      output: expect.stringContaining('oops'),
    })
    const wrote = tempRepo(withMusic('true', 'true'))
    expect(await refreshShared(join(wrote, 'audio-studio.json'))).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/stingers.json', path: '' }],
    })
    const long = JSON.stringify([loop('v', { seconds: 30 })])
    const broken = tempRepo(withMusic('true', `printf '%s' '${long}' > tts/stingers.json`))
    expect(await refreshShared(join(broken, 'audio-studio.json'))).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/stingers.json', path: '[0].seconds' }],
    })
  })

  it('says while the stingers are refreshing, apart from any part', async () => {
    const root = tempRepo(withMusic('true', 'sleep 0.3; echo "[]" > tts/stingers.json'))
    const file = join(root, 'audio-studio.json')
    const running = refreshShared(file)
    expect(isRefreshingShared(file)).toBe(true)
    expect(isRefreshing(file, 'act1')).toBe(false)
    await running
    expect(isRefreshingShared(file)).toBe(false)
  })
})
