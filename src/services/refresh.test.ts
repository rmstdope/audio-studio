import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { isRefreshing, refreshDialog, refreshEffects, refreshShared } from './refresh'
import { stopAll } from './stopWithStudio'

const before = [
  { id: 'a', speaker: 'mira', text: 'Hello.' },
  { id: 'b', speaker: 'mira', text: 'Goodbye.' },
]
const after = JSON.stringify([
  { id: 'a', speaker: 'mira', text: 'Hello.' },
  { id: 'c', speaker: 'mira', text: 'Farewell.' },
])

/** `command` as a part's refresh command, which names `{part}` (here in a comment if it has no use for it). */
function forPart(command: string): string {
  return command.includes('{part}') ? command : `${command} # {part}`
}

function project(part?: string) {
  const json = projectJson(part === undefined ? {} : { refresh: { part: forPart(part) } })
  return {
    'content-studio.json': json,
    'content-studio/narration/cast.json': { speakers: {}, pronounce: {} },
    'tts/act1/script.json': before,
  }
}

describe('refreshDialog', () => {
  it('runs the command in the project root for the part, and says what changed', async () => {
    const root = tempRepo(project(`printf '%s' '${after}' > tts/{part}/script.json && echo done`))
    const result = await refreshDialog(join(root, 'content-studio.json'), 'act1')
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
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: false,
      reason: 'failed',
      output: expect.stringContaining('no such act'),
    })
  })

  it('reports a dialog the command left broken', async () => {
    const root = tempRepo(project('printf \'[{"id": 1}]\' > tts/{part}/script.json'))
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: false,
      problems: expect.arrayContaining([
        expect.objectContaining({ file: 'tts/act1/script.json', path: '[0].id' }),
      ]),
    })
  })

  it('stops a command that takes too long, children included', async () => {
    const root = tempRepo(project('(sleep 1; echo late > marker.txt); true'))
    const result = await refreshDialog(join(root, 'content-studio.json'), 'act1', {
      timeoutMs: 300,
    })
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
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: false,
      message: 'The command was stopped by SIGKILL.',
    })
  })

  it('judges by the command, not by what it left running in the background', async () => {
    const root = tempRepo(project(`sleep 30 & printf '%s' '${after}' > tts/{part}/script.json`))
    const started = Date.now()
    const result = await refreshDialog(join(root, 'content-studio.json'), 'act1', {
      timeoutMs: 20_000,
    })
    expect(result).toMatchObject({ ok: true, lines: 2 })
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('leaves nothing running in the background once the command is done', async () => {
    const root = tempRepo(project('(sleep 1 && echo late > marker.txt) >/dev/null 2>&1 &'))
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(existsSync(join(root, 'marker.txt'))).toBe(false)
  })

  it('says while a part is refreshing, and stops every refresh when the studio stops', async () => {
    const root = tempRepo(project('(sleep 1; echo late > marker.txt); true'))
    const projectFile = join(root, 'content-studio.json')
    const running = refreshDialog(projectFile, 'act1')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(isRefreshing(projectFile, 'act1')).toBe(true)
    expect(isRefreshing(projectFile, 'act2')).toBe(false)
    stopAll()
    expect(await running).toMatchObject({ ok: false, reason: 'failed' })
    expect(isRefreshing(projectFile, 'act1')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(existsSync(join(root, 'marker.txt'))).toBe(false)
  })

  it('runs one refresh of a part at a time', async () => {
    const root = tempRepo(project('echo start >> runs.txt; sleep 0.2; echo end >> runs.txt'))
    const projectFile = join(root, 'content-studio.json')
    await Promise.all([refreshDialog(projectFile, 'act1'), refreshDialog(projectFile, 'act1')])
    expect(readFileSync(join(root, 'runs.txt'), 'utf8')).toBe('start\nend\nstart\nend\n')
  })

  it('keeps only the end of a long output', async () => {
    const root = tempRepo(project('seq 1 100000; exit 1'))
    const result = await refreshDialog(join(root, 'content-studio.json'), 'act1')
    if (result?.ok !== false || !('output' in result)) throw new Error('expected a failure')
    expect(result.output.length).toBeLessThanOrEqual(4000)
    expect(result.output.endsWith('100000')).toBe(true)
  })

  it('does not guess what changed when the dialog could not be read before', async () => {
    const files = project(`printf '%s' '${after}' > tts/{part}/script.json`)
    const root = tempRepo({ ...files, 'tts/act1/script.json': '{ broken' })
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: true,
      lines: 2,
      diff: null,
    })
  })

  it('says when the project has no refresh command', async () => {
    const root = tempRepo(project())
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: false,
      reason: 'none',
    })
  })

  it('knows no unknown part', async () => {
    const root = tempRepo(project('true'))
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act9')).toBeNull()
  })
})

describe('refreshing the music lists', () => {
  const loop = (id: string, extra = {}) => ({
    id,
    title: id.toUpperCase(),
    text: 'b',
    seconds: 80,
    ...extra,
  })
  const music = () => ({
    from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
    clips: 'audio/music',
    manifest: 'audio/music/manifest.json',
  })
  const withMusic = (command: string, shared?: string, files: Record<string, unknown> = {}) => {
    const json = projectJson({ music: music(), refresh: { part: forPart(command), shared } })
    return {
      'content-studio.json': json,
      'content-studio/narration/cast.json': { speakers: {}, pronounce: {} },
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
    const result = await refreshDialog(join(root, 'content-studio.json'), 'act1')
    expect(result).toMatchObject({
      ok: true,
      loops: { added: [{ id: 'c', title: 'C' }], removed: [{ id: 'a', title: 'A' }], total: 2 },
    })
  })

  it('counts every loop as added when the act had no list before', async () => {
    const root = tempRepo(
      withMusic(`${writeLoops} && printf '%s' '${after}' > tts/{part}/script.json`),
    )
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
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
    expect(await refreshDialog(join(wrote, 'content-studio.json'), 'act1')).toMatchObject({
      ok: true,
      loops: null,
    })
    const plain = tempRepo(project(`printf '%s' '${after}' > tts/{part}/script.json`))
    expect(await refreshDialog(join(plain, 'content-studio.json'), 'act1')).toMatchObject({
      ok: true,
      loops: null,
    })
  })

  it('runs refresh.shared in the project root and names the stingers added and removed', async () => {
    const list = JSON.stringify([loop('victory', { seconds: 5 })])
    const root = tempRepo(
      withMusic('true', `printf '%s' '${list}' > tts/stingers.json && echo listed`, {
        'tts/stingers.json': [loop('old', { seconds: 5 })],
      }),
    )
    expect(await refreshShared(join(root, 'content-studio.json'))).toEqual({
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
    expect(await refreshShared(join(root, 'content-studio.json'))).toMatchObject({
      ok: false,
      reason: 'none',
    })
  })

  it('says when the project lists no stingers, running nothing', async () => {
    const json = projectJson({
      music: { ...music(), from: { part: 'tts/{part}/music.json' } },
      refresh: { part: forPart('true'), shared: 'touch ran' },
    })
    const root = tempRepo({
      'content-studio.json': json,
      'content-studio/narration/cast.json': { speakers: {} },
    })
    expect(await refreshShared(join(root, 'content-studio.json'))).toEqual({
      ok: false,
      reason: 'none',
      message: 'The project file names no music.from.shared list.',
    })
    expect(existsSync(join(root, 'ran'))).toBe(false)
  })

  it('reports a failing command, a missing list and a broken one', async () => {
    const failing = tempRepo(withMusic('true', 'echo oops >&2; exit 2'))
    expect(await refreshShared(join(failing, 'content-studio.json'))).toMatchObject({
      ok: false,
      reason: 'failed',
      output: expect.stringContaining('oops'),
    })
    const wrote = tempRepo(withMusic('true', 'true'))
    expect(await refreshShared(join(wrote, 'content-studio.json'))).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/stingers.json', path: '' }],
    })
    const long = JSON.stringify([loop('v', { seconds: 30 })])
    const broken = tempRepo(withMusic('true', `printf '%s' '${long}' > tts/stingers.json`))
    expect(await refreshShared(join(broken, 'content-studio.json'))).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/stingers.json', path: '[0].seconds' }],
    })
  })
})

describe('refreshing the sound effects', () => {
  const effect = (id: string) => ({ id, text: `${id} sound`, seconds: 2 })
  const withEffects = (shared?: string, files: Record<string, unknown> = {}) =>
    tempRepo({
      'content-studio.json': projectJson({
        refresh: { shared },
        effects: {
          from: { shared: 'tts/effects.json' },
          clips: 'audio/effects',
          manifest: 'audio/effects/manifest.json',
        },
      }),
      'tts/.keep': '',
      ...files,
    })

  it('runs the command in the project root and names the ids added and removed', async () => {
    const list = JSON.stringify([effect('coins'), effect('wind')])
    const root = withEffects(`printf '%s' '${list}' > tts/effects.json && echo listed`, {
      'tts/effects.json': [effect('wind'), effect('lantern-hum')],
    })
    expect(await refreshEffects(join(root, 'content-studio.json'))).toEqual({
      ok: true,
      effects: 2,
      change: { added: ['coins'], removed: ['lantern-hum'] },
      output: 'listed',
    })
  })

  it('does not know what changed when the list was unreadable before', async () => {
    const list = JSON.stringify([effect('coins')])
    const root = withEffects(`printf '%s' '${list}' > tts/effects.json`, {
      'tts/effects.json': '{ broken',
    })
    expect(await refreshEffects(join(root, 'content-studio.json'))).toMatchObject({
      ok: true,
      change: null,
    })
  })

  it('says when the project names no command', async () => {
    const root = withEffects()
    expect(await refreshEffects(join(root, 'content-studio.json'))).toMatchObject({
      ok: false,
      reason: 'none',
    })
  })

  it('reports a failing command, no list written and a list that cannot be read', async () => {
    const failing = withEffects('echo oops >&2; exit 2')
    expect(await refreshEffects(join(failing, 'content-studio.json'))).toMatchObject({
      ok: false,
      reason: 'failed',
      output: expect.stringContaining('oops'),
    })
    const none = withEffects('true')
    expect(await refreshEffects(join(none, 'content-studio.json'))).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/effects.json', path: '' }],
    })
    const broken = withEffects(`printf '%s' '{}' > tts/effects.json`)
    expect(await refreshEffects(join(broken, 'content-studio.json'))).toMatchObject({
      ok: false,
      problems: [{ file: 'tts/effects.json', path: '' }],
    })
  })

  it('still succeeds when some entries cannot be read', async () => {
    const list = JSON.stringify([effect('coins'), { id: 'Bad' }])
    const root = withEffects(`printf '%s' '${list}' > tts/effects.json`)
    expect(await refreshEffects(join(root, 'content-studio.json'))).toMatchObject({
      ok: true,
      effects: 1,
    })
  })
})

describe('the one shared command', () => {
  it('writes the stingers and the effects alike, and runs once at a time, whichever asked', async () => {
    const stinger = { id: 'victory', title: 'Victory', text: 'b', seconds: 5 }
    const effect = { id: 'coins', text: 'coins sound', seconds: 2 }
    const command = [
      'echo start >> runs.txt',
      `printf '%s' '${JSON.stringify([stinger])}' > tts/stingers.json`,
      `printf '%s' '${JSON.stringify([effect])}' > tts/effects.json`,
      'sleep 0.2',
      'echo end >> runs.txt',
    ].join('; ')
    const root = tempRepo({
      'content-studio.json': projectJson({
        refresh: { shared: command },
        music: {
          from: { part: 'tts/{part}/music.json', shared: 'tts/stingers.json' },
          clips: 'audio/music',
          manifest: 'audio/music/manifest.json',
        },
        effects: {
          from: { shared: 'tts/effects.json' },
          clips: 'audio/effects',
          manifest: 'audio/effects/manifest.json',
        },
      }),
      'tts/.keep': '',
    })
    const projectFile = join(root, 'content-studio.json')
    const [stingers, effects] = await Promise.all([
      refreshShared(projectFile),
      refreshEffects(projectFile),
    ])
    expect(stingers).toMatchObject({ ok: true, stingers: 1 })
    expect(effects).toMatchObject({ ok: true, effects: 1 })
    expect(readFileSync(join(root, 'runs.txt'), 'utf8')).toBe('start\nend\nstart\nend\n')
  })
})

describe('refreshing an act’s images', () => {
  const MANIFEST = 'web/images/manifest.json'
  const imagesSection = {
    from: { part: 'tts/{part}/images.json' },
    clips: 'web/images',
    manifest: MANIFEST,
  }
  const inn = { id: 'inn', title: 'Inn', text: 'a low inn', width: 320, height: 200 }
  const entry = { file: 'inn.png', width: 320, height: 200 }
  const edits = {
    style: { look: 'pixel', keepOut: 'x', palette: ['#000000'] },
    images: { inn: { areas: { fountain: { x: 80, y: 50, width: 160, height: 100 } } } },
  }
  const gameList = JSON.stringify([{ ...inn, areas: [{ id: 'fountain', title: 'Fountain' }] }])

  function imagesProject(extra: Record<string, unknown> = {}, command = 'true') {
    return tempRepo({
      ...project(command),
      'content-studio.json': projectJson({
        images: imagesSection,
        refresh: { part: forPart(command) },
      }),
      'tts/act1/images.json': [inn],
      'content-studio/images/edits.json': edits,
      [MANIFEST]: { inn: entry },
      ...extra,
    })
  }
  const manifestOf = (root: string) => JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'))

  it('hands the placed boxes to the game for every image of the act, boxes marked before included', async () => {
    const root = imagesProject({}, `printf '%s' '${gameList}' > tts/{part}/images.json`)
    const result = await refreshDialog(join(root, 'content-studio.json'), 'act1')
    expect(result).toMatchObject({ ok: true })
    expect(manifestOf(root).inn.areas).toEqual({
      fountain: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    })
  })

  it('takes an area the game stopped asking for out, leaving the box in the edits', async () => {
    const root = imagesProject({
      [MANIFEST]: { inn: { ...entry, areas: { fountain: { x: 0, y: 0, width: 1, height: 1 } } } },
    })
    await refreshDialog(join(root, 'content-studio.json'), 'act1')
    expect(manifestOf(root)).toEqual({ inn: entry })
    expect(readFileSync(join(root, 'content-studio/images/edits.json'), 'utf8')).toContain(
      'fountain',
    )
  })

  it('leaves the manifest untouched when there is nothing to change', async () => {
    const root = imagesProject({ 'content-studio/images/edits.json': { images: {} } })
    const raw = readFileSync(join(root, MANIFEST), 'utf8')
    await refreshDialog(join(root, 'content-studio.json'), 'act1')
    expect(readFileSync(join(root, MANIFEST), 'utf8')).toBe(raw)
  })

  it('fails with the areas reason when the manifest cannot be read', async () => {
    const root = imagesProject(
      { [MANIFEST]: '{ nope' },
      `printf '%s' '${gameList}' > tts/{part}/images.json`,
    )
    expect(await refreshDialog(join(root, 'content-studio.json'), 'act1')).toMatchObject({
      ok: false,
      reason: 'areas',
      message: 'The command ran, but the named areas could not be passed to the game',
      detail: 'The images manifest could not be read. Fix it, then Refresh from the game again.',
    })
  })
})
