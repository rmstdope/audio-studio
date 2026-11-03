import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { forgetEffect, keepMineEffect, setEffectDescription } from './effectWords'
import { loadWorkspace } from './workspace'

const effects = {
  refresh: 'true',
  paths: {
    list: 'tts/effects.json',
    lock: 'audio/effects.lock.json',
    clips: 'audio/effects',
    manifest: 'audio/effects/manifest.json',
  },
}
const list = [
  { id: 'door-creak', description: 'A slow wooden door creaks', seconds: 3 },
  { id: 'coins', description: 'Coins spill on stone', seconds: 0.5 },
]

function repo(files: Record<string, unknown> = {}) {
  const root = tempRepo({
    'content-studio.json': projectJson({ effects }),
    'tts/effects.json': list,
    ...files,
  })
  const read = (path: string) => readFileSync(join(root, path), 'utf8')
  return { root, file: join(root, 'content-studio.json'), read }
}

async function summary(file: string) {
  const opened = await loadWorkspace(file)
  if (!opened.ok) throw new Error('project did not open')
  return opened.summary.effects!
}

describe('reading the effects into the summary', () => {
  it('is null without an effects section', async () => {
    const root = tempRepo({ 'content-studio.json': projectJson() })
    const opened = await loadWorkspace(join(root, 'content-studio.json'))
    expect(opened.ok && opened.summary.effects).toBeNull()
  })

  it('says the list is missing before the game writes it', async () => {
    const { file } = repo({ 'tts/effects.json': undefined })
    expect(await summary(file)).toMatchObject({ status: 'missing', canRefresh: true })
  })

  it('reports an unreadable list with its file', async () => {
    const { file } = repo({ 'tts/effects.json': '{ nope' })
    const s = await summary(file)
    expect(s.status).toBe('invalid')
    expect(s.problems[0]!.file).toBe('tts/effects.json')
  })

  it('shows the readable effects and reports the others', async () => {
    const { file } = repo({
      'tts/effects.json': [...list, { id: 'Bad', description: 'x', seconds: 1 }],
    })
    const s = await summary(file)
    expect(s.rows.map((r) => r.id)).toEqual(['door-creak', 'coins'])
    expect(s.unreadable).toBe(1)
    expect(s.problems[0]).toMatchObject({ file: 'tts/effects.json', path: '[2].id' })
  })

  it('leaves the list’s own problems to the effects page, not the workspace’s', async () => {
    const { file } = repo({ 'tts/effects.json': [{ id: 'Bad' }] })
    const opened = await loadWorkspace(file)
    expect(opened.ok && opened.summary.problems).toEqual([])
    expect((await summary(file)).problems).toHaveLength(3)
  })

  it('reports a broken overrides file and shows the game’s words', async () => {
    const { file } = repo({ '.content-studio/effects.json': '[1]' })
    const s = await summary(file)
    expect(s.rows[0]!.changedHere).toBe(false)
    const opened = await loadWorkspace(file)
    expect(
      opened.ok && opened.summary.problems.some((p) => p.file === '.content-studio/effects.json'),
    ).toBe(true)
  })
})

describe('setEffectDescription', () => {
  it('keeps the studio’s words in .content-studio/effects.json and never writes the game’s list', async () => {
    const { file, read } = repo()
    const before = read('tts/effects.json')
    expect(await setEffectDescription(file, 'coins', '  Coins on glass ')).toEqual({ ok: true })
    expect(read('.content-studio/effects.json')).toBe(
      '{\n "coins": {"words":"Coins on glass","gameWas":"Coins spill on stone"}\n}\n',
    )
    expect(read('tts/effects.json')).toBe(before)
    expect((await summary(file)).rows[1]).toMatchObject({
      description: 'Coins on glass',
      changedHere: true,
    })
  })

  it('returns to the game’s words when emptied, typed back or set to null', async () => {
    const { file, read } = repo()
    for (const back of ['', 'Coins spill on stone', null]) {
      await setEffectDescription(file, 'coins', 'Mine')
      await setEffectDescription(file, 'coins', back)
      expect(read('.content-studio/effects.json')).toBe('{}\n')
    }
  })

  it('knows no effect the game does not list', async () => {
    const { file } = repo()
    expect(await setEffectDescription(file, 'nope', 'x')).toBeNull()
  })

  it('refuses to write over an overrides file it cannot read', async () => {
    const { file, read } = repo({ '.content-studio/effects.json': '[1]' })
    const result = await setEffectDescription(file, 'coins', 'Mine')
    expect(result).toMatchObject({ ok: false })
    expect(read('.content-studio/effects.json')).toBe('[1]')
  })
})

describe('the game rewording an effect you changed', () => {
  const game = (description: string) => [{ ...list[0]!, description }, list[1]]
  const mine = { 'door-creak': { words: 'Mine', gameWas: 'A slow wooden door creaks' } }

  it('flags it, across reads, until Keep mine', async () => {
    const { file } = repo({
      'tts/effects.json': game('A heavy door groans'),
      '.content-studio/effects.json': mine,
    })
    expect((await summary(file)).rows[0]!.gameChanged).toBe(true)
    expect((await summary(file)).rows[0]!.gameChanged).toBe(true)
    expect(await keepMineEffect(file, 'door-creak')).toEqual({ ok: true })
    expect((await summary(file)).rows[0]).toMatchObject({ gameChanged: false, description: 'Mine' })
  })

  it('is cleared by changing your own words', async () => {
    const { file } = repo({
      'tts/effects.json': game('A heavy door groans'),
      '.content-studio/effects.json': mine,
    })
    await setEffectDescription(file, 'door-creak', 'Mine again')
    expect((await summary(file)).rows[0]).toMatchObject({
      gameChanged: false,
      description: 'Mine again',
    })
  })

  it('Keep mine knows only an effect with words of yours', async () => {
    const { file } = repo()
    expect(await keepMineEffect(file, 'coins')).toBeNull()
  })

  it('Use the game’s is setEffectDescription with null', async () => {
    const { file } = repo({ 'tts/effects.json': game('New'), '.content-studio/effects.json': mine })
    await setEffectDescription(file, 'door-creak', null)
    expect((await summary(file)).rows[0]).toMatchObject({ changedHere: false, description: 'New' })
  })
})

describe('an effect the game drops', () => {
  const files = {
    'tts/effects.json': [list[0]],
    '.content-studio/effects.json': { coins: { words: 'Mine', gameWas: 'Coins spill on stone' } },
  }

  it('keeps your words in a dropped list, and brings them back when the game lists it again', async () => {
    const { file, root } = repo(files)
    expect((await summary(file)).dropped).toEqual([{ id: 'coins', name: 'Coins', words: 'Mine' }])
    await Bun.write(join(root, 'tts/effects.json'), JSON.stringify(list))
    const s = await summary(file)
    expect(s.dropped).toEqual([])
    expect(s.rows[1]).toMatchObject({ description: 'Mine', changedHere: true })
  })

  it('is forgotten only when the game does not list it', async () => {
    const { file, read } = repo(files)
    expect(await forgetEffect(file, 'door-creak')).toBeNull()
    expect(await forgetEffect(file, 'coins')).toEqual({ ok: true })
    expect(read('.content-studio/effects.json')).toBe('{}\n')
    expect((await summary(file)).dropped).toEqual([])
  })
})
