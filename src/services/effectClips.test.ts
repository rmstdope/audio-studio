import { describe, expect, it } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import { EffectLockSchema, type EffectBoardTake } from '../core/effectTakes'
import { ProjectSchema } from '../core/project'
import { FileNotWritten, type Encoder, type EncodeOptions } from './audio'
import {
  acceptEffect,
  commitEffect,
  formatEffectLock,
  readEffectChosen,
  uncommitEffect,
} from './effectClips'

const effects = {
  from: { shared: 'tts/effects.json' },
  clips: 'audio/effects',
  manifest: 'audio/effects/manifest.json',
}
const config = ProjectSchema.parse(projectJson({ effects })).effects!

const inputs = { description: 'A slow wooden door creaks open', seconds: 3 }
const take = (n: number, over: Partial<EffectBoardTake> = {}): EffectBoardTake => ({
  n,
  hash: '0123456789abcdef',
  seed: 100 + n,
  model: 'small-sfx',
  seconds: 1.4,
  peaks: [],
  inputs,
  ...over,
})

/** An encoder that writes `mp3` and remembers what it was asked. */
function fakeEncoder(fail = false) {
  const calls: { file: string; options: EncodeOptions }[] = []
  const encode: Encoder = async (_wav, file, options) => {
    calls.push({ file, options })
    mkdirSync(dirname(file), { recursive: true })
    if (fail) throw new Error('ffmpeg could not encode the clip: boom')
    writeFileSync(file, 'mp3')
  }
  return { encode, calls }
}

const at = new Date('2026-11-03T10:00:00.000Z')
const choose = (root: string, id: string, n: number, encode: Encoder, hash?: string) =>
  commitEffect({
    root,
    effects: config,
    id,
    take: take(n, hash ? { hash } : {}),
    inUse: inputs,
    wav: new Uint8Array(4),
    encode,
    now: () => at,
  })

describe('commitEffect', () => {
  it('says which file could not be written when the encoder cannot write the clip', async () => {
    const root = tempRepo({})
    const encode: Encoder = async () => {
      throw new FileNotWritten()
    }
    const quiet = console.error
    console.error = () => {}
    try {
      expect(await choose(root, 'coins', 1, encode)).toMatchObject({
        ok: false,
        message: 'audio/effects/coins.mp3 could not be written.',
      })
    } finally {
      console.error = quiet
    }
  })

  it('writes the clip, the manifest with its real length, and the lock', async () => {
    const root = tempRepo({})
    const { encode, calls } = fakeEncoder()
    expect(await choose(root, 'door-creak', 2, encode)).toEqual({ ok: true })
    expect(calls[0]!.options).toEqual({ bitrate: '160k', channels: 2 })
    expect(readFileSync(join(root, 'audio/effects/door-creak.mp3'), 'utf8')).toBe('mp3')
    expect(JSON.parse(readFileSync(join(root, 'audio/effects/manifest.json'), 'utf8'))).toEqual({
      'door-creak': { file: 'door-creak.mp3', duration: 1.4 },
    })
    const lock = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
    expect(lock['door-creak']).toEqual({
      fp: '0123456789abcdef',
      model: 'small-sfx',
      seed: 102,
      take: 2,
      inputs: { text: inputs.description, seconds: 3 },
      at: at.toISOString(),
    })
    expect(calls[0]!.file.includes('/.door-creak.')).toBe(true)
    expect(readdirSync(join(root, 'audio/effects')).sort()).toEqual([
      'door-creak.mp3',
      'manifest.json',
    ])
  })

  it('replaces the entry when another take is chosen and keeps other effects', async () => {
    const root = tempRepo({})
    const { encode } = fakeEncoder()
    await choose(root, 'door-creak', 1, encode)
    await choose(root, 'coins', 1, encode)
    await choose(root, 'door-creak', 3, encode)
    const lock = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
    expect(Object.keys(lock)).toEqual(['coins', 'door-creak'])
    expect(lock['door-creak'].take).toBe(3)
  })

  it('changes nothing when the encode fails', async () => {
    const root = tempRepo({})
    const result = await choose(root, 'door-creak', 1, fakeEncoder(true).encode)
    expect(result).toMatchObject({ ok: false })
    expect(existsSync(join(root, 'content-studio/effects/lock.json'))).toBe(false)
    expect(existsSync(join(root, 'audio/effects/manifest.json'))).toBe(false)
    expect(readdirSync(join(root, 'audio/effects'))).toEqual([])
  })

  it('changes nothing when the lock or the manifest cannot be read', async () => {
    const lockBroken = tempRepo({ 'content-studio/effects/lock.json': '{ nope' })
    const one = await choose(lockBroken, 'door-creak', 1, fakeEncoder().encode)
    expect(one).toMatchObject({
      ok: false,
      message:
        'Take 1 could not be chosen: the sound effects lock could not be read. Nothing was changed.',
    })
    expect(readdirSync(join(lockBroken, 'audio/effects'))).toEqual([])
    const manifestBroken = tempRepo({ 'audio/effects/manifest.json': '[' })
    const two = await choose(manifestBroken, 'door-creak', 1, fakeEncoder().encode)
    expect(two).toMatchObject({
      ok: false,
      message: expect.stringContaining('the sound effects manifest could not be read'),
    })
  })
})

describe('choosing a take made for an earlier description', () => {
  it('counts the effect as made from the description in use, and keeps the take’s own length', async () => {
    const root = tempRepo({})
    const inUse = { description: 'A heavy door groans', seconds: 3 }
    await commitEffect({
      root,
      effects: config,
      id: 'door-creak',
      take: take(1),
      inUse,
      wav: new Uint8Array(4),
      encode: fakeEncoder().encode,
      now: () => at,
    })
    const lock = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
    expect(lock['door-creak'].inputs).toEqual({ text: 'A heavy door groans', seconds: 3 })
    // A take made for another length stays changed: a changed length needs a new take.
    await commitEffect({
      root,
      effects: config,
      id: 'door-creak',
      take: take(2, { inputs: { ...inputs, seconds: 2 } }),
      inUse,
      wav: new Uint8Array(4),
      encode: fakeEncoder().encode,
      now: () => at,
    })
    const again = JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))
    expect(again['door-creak'].inputs).toEqual({ text: 'A heavy door groans', seconds: 2 })
  })
})

describe('the order of writes', () => {
  it('leaves the lock as it was when the manifest write fails after the clip is in place', async () => {
    const root = tempRepo({})
    await choose(root, 'coins', 1, fakeEncoder().encode)
    const before = readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8')
    // A directory where the manifest must be written makes that write fail.
    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'audio/effects/manifest.json'))
    mkdirSync(join(root, 'audio/effects/manifest.json'))
    const result = await choose(root, 'door-creak', 1, fakeEncoder().encode)
    expect(result).toMatchObject({ ok: false })
    expect(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8')).toBe(before)
  })

  it('un-choosing removes the lock entry last: a failure leaves the effect chosen', async () => {
    const root = tempRepo({})
    await choose(root, 'coins', 1, fakeEncoder().encode)
    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'audio/effects/manifest.json'))
    mkdirSync(join(root, 'audio/effects/manifest.json'))
    // The manifest cannot be read as JSON, so nothing is changed.
    expect(await uncommitEffect({ root, effects: config, id: 'coins' })).toMatchObject({
      ok: false,
    })
    expect(
      Object.keys(JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))),
    ).toEqual(['coins'])
    expect(existsSync(join(root, 'audio/effects/coins.mp3'))).toBe(true)
  })
})

describe('uncommitEffect', () => {
  it('deletes the manifest entry, the clip and the lock entry', async () => {
    const root = tempRepo({})
    const { encode } = fakeEncoder()
    await choose(root, 'door-creak', 1, encode)
    await choose(root, 'coins', 1, encode)
    expect(await uncommitEffect({ root, effects: config, id: 'door-creak' })).toEqual({ ok: true })
    expect(existsSync(join(root, 'audio/effects/door-creak.mp3'))).toBe(false)
    expect(
      Object.keys(JSON.parse(readFileSync(join(root, 'audio/effects/manifest.json'), 'utf8'))),
    ).toEqual(['coins'])
    expect(
      Object.keys(JSON.parse(readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8'))),
    ).toEqual(['coins'])
  })

  it('refuses an effect with no chosen take, and an unreadable lock', async () => {
    const root = tempRepo({})
    expect(await uncommitEffect({ root, effects: config, id: 'coins' })).toEqual({
      ok: false,
      message: 'No take is chosen for this effect.',
    })
    const broken = tempRepo({ 'content-studio/effects/lock.json': 'x' })
    expect(await uncommitEffect({ root: broken, effects: config, id: 'coins' })).toEqual({
      ok: false,
      message: 'The sound effects lock could not be read.',
    })
  })
})

describe('acceptEffect', () => {
  const now = { description: 'A heavy door groans', seconds: 3 }
  const accept = (root: string, to = now) => acceptEffect({ root, id: 'door-creak', now: to })

  it('counts the chosen take as made from the new description', async () => {
    const root = tempRepo({})
    await choose(root, 'door-creak', 1, fakeEncoder().encode)
    expect(await accept(root)).toEqual({ ok: true })
    const written = readFileSync(join(root, 'content-studio/effects/lock.json'), 'utf8')
    expect(JSON.parse(written)['door-creak'].inputs).toEqual({ text: now.description, seconds: 3 })
    expect(written.split('\n')).toHaveLength(4)
    expect(JSON.parse(written)['door-creak'].take).toBe(1)
  })

  it('refuses a changed length, nothing changed, and an effect with no chosen take', async () => {
    const root = tempRepo({})
    expect(await accept(root)).toEqual({ ok: false, message: 'No take is chosen for this effect.' })
    await choose(root, 'door-creak', 1, fakeEncoder().encode)
    expect(await accept(root, inputs)).toEqual({
      ok: false,
      message: 'Nothing has changed since the take was chosen.',
    })
    expect(await accept(root, { ...now, seconds: 4 })).toEqual({
      ok: false,
      message: 'A changed length cannot be accepted: the effect needs a new take.',
    })
  })
})

describe('readEffectChosen', () => {
  it('lists the lock’s effects with whether the clip is a file there; unread when unreadable', async () => {
    const root = tempRepo({})
    await choose(root, 'door-creak', 1, fakeEncoder().encode)
    await choose(root, 'coins', 1, fakeEncoder().encode)
    const { rmSync } = await import('node:fs')
    rmSync(join(root, 'audio/effects/coins.mp3'))
    const chosen = await readEffectChosen(root, config, [])
    expect(
      Object.entries(chosen.read ? chosen.entries : {}).map(([id, c]) => [id, c.fileExists]),
    ).toEqual([
      ['coins', false],
      ['door-creak', true],
    ])
    const broken = tempRepo({ 'content-studio/effects/lock.json': '{' })
    const problems: unknown[] = []
    expect(await readEffectChosen(broken, config, problems as never)).toEqual({ read: false })
    expect(problems).toHaveLength(1)
  })
})

describe('formatEffectLock', () => {
  const line = (id: string, inputs: string) =>
    ` "${id}": {"fp":"${'a'.repeat(16)}","model":"small-sfx","seed":7,"take":2,"inputs":${inputs},"at":"2026-11-03T10:00:00.000Z"}`
  const text = [
    '{',
    `${line('coins', '{"text":"Coins spill","seconds":0.5}')},`,
    line('rain', '{"text":"Steady rain","seconds":8,"loops":true}'),
    '}',
    '',
  ].join('\n')

  it('writes one entry per line in id order, the words as text, as it read them', () => {
    const { coins, rain } = EffectLockSchema.parse(JSON.parse(text))
    expect(formatEffectLock({ rain: rain!, coins: coins! })).toBe(text)
    expect(formatEffectLock({})).toBe('{}\n')
  })

  it.skipIf(process.getuid?.() === 0)(
    'says which file could not be written when the effects folder is read-only',
    async () => {
      const root = tempRepo({})
      await choose(root, 'coins', 1, fakeEncoder().encode)
      const clips = join(root, 'audio/effects')
      chmodSync(clips, 0o555)
      try {
        expect(await uncommitEffect({ root, effects: config, id: 'coins' })).toMatchObject({
          ok: false,
          message: 'audio/effects/manifest.json could not be written.',
        })
      } finally {
        chmodSync(clips, 0o755)
      }
      expect(existsSync(join(root, 'audio/effects/coins.mp3'))).toBe(true)
    },
  )
})
