import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectJson, tempRepo } from '../../test/helpers'
import type { FishClient, TtsRequest } from './fish'
import { createLimiter } from './limit'
import { createBudget } from '../core/spend'
import { auditionTakes, recordTake, takeFile, tryLine } from './takes'

const files = {
  'audio-studio.json': projectJson(),
  'tts/cast.json': {
    speakers: {
      grandmother: {
        voice: 'cur',
        style: '[warm]',
        speed: 0.9,
        audition: { phrase: 'Elior, dear.' },
      },
    },
    pronounce: { Elior: 'El-ee-or' },
  },
  'tts/act1/script.json': [{ key: 'a', speaker: 'grandmother', text: 'Hello.' }],
}

function fakeFish() {
  const requests: TtsRequest[] = []
  const fish: FishClient = {
    async listOwnVoices() {
      return []
    },
    createVoice: () => Promise.reject(new Error('not used')),
    designVoice: () => Promise.reject(new Error('not used')),
    async credit() {
      return 25
    },
    listVoices: () => Promise.reject(new Error('not used')),
    getVoice: () => Promise.reject(new Error('not used')),
    async tts(request) {
      requests.push(request)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return new Uint8Array([7, 7, 7])
    },
  }
  return { fish, requests }
}

describe('recordTake', () => {
  it('has the voice say the character’s phrase in its style, and keeps the audio', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.cached).toBe(false)
    expect(requests).toEqual([
      {
        text: '[warm] El-ee-or, dear.',
        voice: 'v9',
        model: 's2.1-pro-free',
        temperature: 0.7,
        topP: 0.7,
        speed: 0.9,
      },
    ])
    const file = await takeFile(projectFile, result.key)
    expect(file).toBe(join(root, '.audio-studio/takes', `${result.key}.mp3`))
    expect([...readFileSync(file!)]).toEqual([7, 7, 7])
  })

  it('records a take only once', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const limiter = createLimiter()
    const [a, b] = await Promise.all([
      recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter),
      recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter),
    ])
    const again = await recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter)
    expect(requests).toHaveLength(1)
    expect(again).toMatchObject({ ok: true, cached: true })
    expect(a?.ok && b?.ok && a.key === b.key).toBe(true)
  })

  it('records a take once even when a slower request started first', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const limiter = createLimiter()
    // Gated both ways, so the order is fixed whatever the machine's load: the slower request has
    // missed the cache and asked for its client before the faster one speaks, and gets its client
    // only once the faster one has stored the take.
    let asked!: () => void
    const slowerAsked = new Promise<void>((resolve) => (asked = resolve))
    let stored!: () => void
    const takeStored = new Promise<void>((resolve) => (stored = resolve))
    const slow = async () => {
      asked()
      await takeStored
      return fish
    }
    const waitsForSlower: FishClient = {
      ...fish,
      async tts(request) {
        await slowerAsked
        return fish.tts(request)
      },
    }
    const [slower, faster] = await Promise.all([
      recordTake(projectFile, 'grandmother', 'v9', slow, limiter),
      recordTake(projectFile, 'grandmother', 'v9', async () => waitsForSlower, limiter).finally(
        stored,
      ),
    ])
    expect(requests).toHaveLength(1)
    expect(slower).toMatchObject({ ok: true, cached: true })
    expect(faster).toMatchObject({ ok: true, cached: false })
  })

  it('says which phrase the take is of', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const result = await recordTake(
      join(root, 'audio-studio.json'),
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    expect(result).toMatchObject({ ok: true, spoken: '[warm] El-ee-or, dear.' })
  })

  it('refuses empty audio from Fish, and keeps nothing', async () => {
    const root = tempRepo(files)
    const empty: FishClient = { ...fakeFish().fish, tts: async () => new Uint8Array() }
    const projectFile = join(root, 'audio-studio.json')
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => empty,
      createLimiter(),
    )
    expect(result).toMatchObject({ ok: false, reason: 'fish' })
    expect(existsSync(join(root, '.audio-studio/takes'))).toBe(false)
  })

  it('refuses a phrase in the cast too long for one take, and pays nothing', async () => {
    const long = 'x'.repeat(401)
    const root = tempRepo({
      ...files,
      'tts/cast.json': { speakers: { grandmother: { voice: 'cur', audition: { phrase: long } } } },
    })
    const { fish, requests } = fakeFish()
    const result = await recordTake(
      join(root, 'audio-studio.json'),
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    expect(result && !result.ok && 'problems' in result && result.problems[0]!.message).toContain(
      '401',
    )
    expect(requests).toEqual([])
  })

  it('lists only the cast’s problems when the cast is broken', async () => {
    const root = tempRepo({
      ...files,
      'tts/cast.json': '{ broken',
      'tts/act2/script.json': '[ broken',
    })
    const { fish } = fakeFish()
    const result = await recordTake(
      join(root, 'audio-studio.json'),
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
    )
    expect(
      result && !result.ok && 'problems' in result && result.problems.map((p) => p.file),
    ).toEqual(['tts/cast.json'])
  })

  it('says so when there is no API key, or Fish fails', async () => {
    const root = tempRepo(files)
    const projectFile = join(root, 'audio-studio.json')
    expect(
      await recordTake(projectFile, 'grandmother', 'v9', async () => null, createLimiter()),
    ).toMatchObject({
      ok: false,
      reason: 'no-key',
    })
    const failing: FishClient = {
      ...fakeFish().fish,
      tts: () => Promise.reject(new Error('no credit')),
    }
    expect(
      await recordTake(projectFile, 'grandmother', 'v9', async () => failing, createLimiter()),
    ).toEqual({
      ok: false,
      reason: 'fish',
      message: 'no credit',
    })
  })

  it('returns null for a character the project does not have', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    expect(
      await recordTake(
        join(root, 'audio-studio.json'),
        'nobody',
        'v9',
        async () => fish,
        createLimiter(),
      ),
    ).toBeNull()
  })
})

describe('takeFile', () => {
  it('knows only keys that look like keys and have a file', async () => {
    const root = tempRepo({ ...files, '.audio-studio/takes/0123456789abcdef.mp3': 'x' })
    const projectFile = join(root, 'audio-studio.json')
    expect(await takeFile(projectFile, '0123456789abcdef')).not.toBeNull()
    expect(await takeFile(projectFile, 'fedcba9876543210')).toBeNull()
    expect(await takeFile(projectFile, '../audio-studio')).toBeNull()
  })
})

describe('recordedTakes', () => {
  it('finds the takes recorded for the phrase, the current voice included', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const projectFile = join(root, 'audio-studio.json')
    const take = await recordTake(
      projectFile,
      'grandmother',
      'cur',
      async () => fish,
      createLimiter(),
    )
    const result = await auditionTakes(projectFile, 'grandmother', ['cur', 'other'])
    expect(take?.ok && result?.ok && result.takes).toEqual({ cur: take?.ok ? take.key : '' })
  })
})

describe('tryLine', () => {
  const projectFileOf = (root: string) => join(root, 'audio-studio.json')

  it('adds the cue typed at a gap to the line: the saved opening and cues inside stay, a long line is one request', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [
        { key: 'a', speaker: 'grandmother', text: 'Elior, dear. Come here. Sit down now.' },
      ],
      'tts/act1/cues.json': { a: '[soft] Elior, dear. Come [low] here. Sit down now.' },
    })
    const { fish, requests } = fakeFish()
    const result = await tryLine(
      projectFileOf(root),
      'act1',
      'a',
      'whispering',
      async () => fish,
      createLimiter(),
      undefined,
      4,
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result.spoken).toBe('[soft] El-ee-or, dear. Come [low] here. [whispering] Sit down now.')
    expect(requests).toHaveLength(1)
  })

  it('refuses a gap that is not between two words', async () => {
    const root = tempRepo(files)
    const { fish } = fakeFish()
    const result = await tryLine(
      projectFileOf(root),
      'act1',
      'a',
      '[x]',
      async () => fish,
      createLimiter(),
      undefined,
      1,
    )
    expect(result).toMatchObject({ ok: false })
  })

  it('has the cast voice say the line with the cue tried, as the cast says it, and keeps it', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const result = await tryLine(
      projectFileOf(root),
      'act1',
      'a',
      '[hushed]',
      async () => fish,
      createLimiter(),
    )
    if (!result?.ok) throw new Error(JSON.stringify(result))
    expect(result).toMatchObject({ spoken: '[hushed] Hello.', cached: false })
    expect(requests).toEqual([
      {
        text: '[hushed] Hello.',
        voice: 'cur',
        model: 's2.1-pro-free',
        temperature: 0.7,
        topP: 0.7,
        speed: 0.9,
      },
    ])
    expect(await takeFile(projectFileOf(root), result.key)).toBe(
      join(root, '.audio-studio/takes', `${result.key}.mp3`),
    )
    // Nothing of the game's: no cue saved, no manifest or lock made.
    for (const file of [
      'tts/act1/cues.json',
      'audio/act1/manifest.json',
      'tts/act1/narration.lock.json',
    ]) {
      expect(existsSync(join(root, file))).toBe(false)
    }
  })

  it('needs only the dialog and the cast: a broken manifest or lock does not stop it', async () => {
    const root = tempRepo({
      ...files,
      'audio/act1/manifest.json': { a: { file: 3 } },
      'tts/act1/narration.lock.json': 'not json',
    })
    const { fish } = fakeFish()
    const result = await tryLine(
      projectFileOf(root),
      'act1',
      'a',
      '',
      async () => fish,
      createLimiter(),
    )
    expect(result).toMatchObject({ ok: true })
    const broken = tempRepo({ ...files, 'tts/cast.json': { speakers: 'no' } })
    const refused = await tryLine(
      projectFileOf(broken),
      'act1',
      'a',
      '',
      async () => fish,
      createLimiter(),
    )
    expect(refused).toMatchObject({ ok: false, problems: [{ file: 'tts/cast.json' }] })
  })

  it('tries the character’s style for an empty cue, and records a cue once', async () => {
    const root = tempRepo(files)
    const { fish, requests } = fakeFish()
    const limiter = createLimiter()
    const first = await tryLine(projectFileOf(root), 'act1', 'a', '  ', async () => fish, limiter)
    const again = await tryLine(projectFileOf(root), 'act1', 'a', '', async () => fish, limiter)
    expect(first).toMatchObject({ ok: true, spoken: '[warm] Hello.', cached: false })
    expect(again).toMatchObject({ ok: true, spoken: '[warm] Hello.', cached: true })
    expect(requests).toHaveLength(1)
  })

  it('is null for an unknown part or line, and refuses a line whose speaker has no voice', async () => {
    const root = tempRepo({
      ...files,
      'tts/act1/script.json': [
        { key: 'a', speaker: 'grandmother', text: 'Hello.' },
        { key: 'b', speaker: 'stranger', text: 'Who?' },
      ],
    })
    const { fish, requests } = fakeFish()
    const limiter = createLimiter()
    expect(
      await tryLine(projectFileOf(root), 'act9', 'a', '', async () => fish, limiter),
    ).toBeNull()
    expect(
      await tryLine(projectFileOf(root), 'act1', 'zz', '', async () => fish, limiter),
    ).toBeNull()
    expect(await tryLine(projectFileOf(root), 'act1', 'b', '', async () => fish, limiter)).toEqual({
      ok: false,
      reason: 'uncast',
      message: 'stranger has no voice yet; cast one first.',
    })
    expect(requests).toHaveLength(0)
  })

  it('says there is no key, and what Fish answered', async () => {
    const root = tempRepo(files)
    const limiter = createLimiter()
    expect(
      await tryLine(projectFileOf(root), 'act1', 'a', '', async () => null, limiter),
    ).toMatchObject({
      ok: false,
      reason: 'no-key',
    })
    const failing: FishClient = { ...fakeFish().fish, tts: () => Promise.reject(new Error('boom')) }
    expect(
      await tryLine(projectFileOf(root), 'act1', 'a', '', async () => failing, limiter),
    ).toEqual({ ok: false, reason: 'fish', message: 'boom' })
  })
})

describe('tryLine in a language besides the source', () => {
  const several = projectJson()
  const narration = several.narration as Record<string, unknown>
  narration.languages = ['en', 'sv']
  narration.paths = {
    dialog: 'tts/{part}/{language}/script.json',
    cues: 'tts/{part}/{language}/cues.json',
    lock: 'tts/{part}/{language}/narration.lock.json',
    clips: 'audio/{part}/{language}',
    manifest: 'audio/{part}/{language}/manifest.json',
  }
  const swedish = {
    'audio-studio.json': several,
    'tts/cast.json': {
      speakers: {
        narrator: { voice: 'v-n', style: '[warm]', languages: { sv: { voice: 'v-sv' } } },
      },
    },
    'tts/act1/en/script.json': [{ key: 'k1', speaker: 'narrator', text: 'Hello.' }],
    'tts/act1/sv/script.json': [{ key: 'k1', speaker: 'narrator', text: 'Hej.' }],
    'tts/act1/en/cues.json': { k1: '[worried]' },
  }
  const tryIt = async (cue: string) => {
    const root = tempRepo(swedish)
    const { fish, requests } = fakeFish()
    await tryLine(
      join(root, 'audio-studio.json'),
      'act1',
      'k1',
      cue,
      async () => fish,
      createLimiter(),
      'sv',
    )
    return requests.map((r) => [r.text, r.voice])
  }

  it('says the language’s text in its voice; an empty cue follows the source cue', async () => {
    expect(await tryIt('')).toEqual([['[worried] Hej.', 'v-sv']])
    expect(await tryIt('[mjukt]')).toEqual([['[mjukt] Hej.', 'v-sv']])
  })
})

describe('takes on a paid audition model', () => {
  const paid = {
    ...files,
    'audio-studio.json': projectJson({
      narration: { ...(projectJson().narration as object), models: { audition: 's2.1-pro' } },
    }),
  }
  // '[warm] El-ee-or, dear.' is 22 bytes: $0.00033 at $15 per million.
  const COST = (22 / 1e6) * 15
  const board = (budget?: ReturnType<typeof createBudget>, charged?: (d: number) => void) => ({
    board: true,
    budget,
    charged,
  })

  it('records a board take with the audition model and charges it to the budget', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const budget = createBudget({ model: 's2.1-pro', dollars: 0.01 })
    const charged: number[] = []
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
      board(budget, (d) => charged.push(d)),
    )
    expect(result?.ok).toBe(true)
    expect(requests.map((r) => r.model)).toEqual(['s2.1-pro'])
    expect(budget.left).toBeCloseTo(0.01 - COST, 12)
    expect(charged).toHaveLength(1)
    expect(charged[0]).toBeCloseTo(COST, 12)
  })

  it('needs a sitting for a board take: nothing is sent to Fish without one', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
      board(),
    )
    expect(result).toMatchObject({ ok: false, reason: 'no-sitting' })
    expect(requests).toEqual([])
  })

  it('waits when the budget cannot pay for the take, and sends nothing', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const budget = createBudget({ model: 's2.1-pro', dollars: COST / 2 })
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
      board(budget),
    )
    expect(result).toMatchObject({ ok: false, reason: 'waits' })
    expect(requests).toEqual([])
    expect(budget.left).toBeCloseTo(COST / 2, 12)
  })

  it('charges a take already recorded nothing', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const budget = createBudget({ model: 's2.1-pro', dollars: 0.01 })
    const limiter = createLimiter()
    await recordTake(projectFile, 'grandmother', 'v9', async () => fish, limiter, board(budget))
    const left = budget.left
    const again = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      limiter,
      board(budget),
    )
    expect(again).toMatchObject({ ok: true, cached: true })
    expect(requests).toHaveLength(1)
    expect(budget.left).toBe(left)
  })

  it('gives the money back when Fish fails', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const failing: FishClient = {
      createVoice: () => Promise.reject(new Error('not used')),
      designVoice: () => Promise.reject(new Error('not used')),
      credit: async () => 25,
      listVoices: () => Promise.reject(new Error('not used')),
      listOwnVoices: () => Promise.reject(new Error('not used')),
      getVoice: () => Promise.reject(new Error('not used')),
      tts: () => Promise.reject(new Error('Fish said no')),
    }
    const budget = createBudget({ model: 's2.1-pro', dollars: 0.01 })
    const charged: number[] = []
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => failing,
      createLimiter(),
      board(budget, (d) => charged.push(d)),
    )
    expect(result).toMatchObject({ ok: false, reason: 'fish' })
    expect(budget.left).toBeCloseTo(0.01, 12)
    expect(charged).toEqual([])
  })

  it('sends nothing once the sitting has ended while the take was queued', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish, requests } = fakeFish()
    const budget = createBudget({ model: 's2.1-pro', dollars: 0.01 })
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
      {
        board: true,
        budget,
        open: () => false,
      },
    )
    expect(result).toMatchObject({ ok: false, reason: 'no-sitting' })
    expect(requests).toEqual([])
    expect(budget.left).toBe(0.01)
  })

  it('keeps a take that was made when saving what it cost fails', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish } = fakeFish()
    const budget = createBudget({ model: 's2.1-pro', dollars: 0.01 })
    const result = await recordTake(
      projectFile,
      'grandmother',
      'v9',
      async () => fish,
      createLimiter(),
      {
        board: true,
        budget,
        charged: () => Promise.reject(new Error('disk full')),
      },
    )
    expect(result).toMatchObject({ ok: true, cached: false })
  })

  it('keeps the cast voice’s page take on the free model, and a try too', async () => {
    const projectFile = join(
      tempRepo({
        ...paid,
        'tts/cast.json': {
          ...(files['tts/cast.json'] as object),
          speakers: { grandmother: { voice: 'cur', style: '[warm]' } },
        },
      }),
      'audio-studio.json',
    )
    const { fish, requests } = fakeFish()
    const page = await recordTake(
      projectFile,
      'grandmother',
      'cur',
      async () => fish,
      createLimiter(),
    )
    expect(page?.ok).toBe(true)
    const tried = await tryLine(
      projectFile,
      'act1',
      'a',
      '[soft]',
      async () => fish,
      createLimiter(),
    )
    expect(tried?.ok).toBe(true)
    expect(requests.map((r) => r.model)).toEqual(['s2.1-pro-free', 's2.1-pro-free'])
  })

  it('finds the takes of the audition model for the board and the free ones for the page', async () => {
    const projectFile = join(tempRepo(paid), 'audio-studio.json')
    const { fish } = fakeFish()
    const budget = createBudget({ model: 's2.1-pro', dollars: 0.01 })
    const onBoard = await recordTake(
      projectFile,
      'grandmother',
      'cur',
      async () => fish,
      createLimiter(),
      board(budget),
    )
    const onPage = await recordTake(
      projectFile,
      'grandmother',
      'cur',
      async () => fish,
      createLimiter(),
    )
    expect(onBoard?.ok && onPage?.ok && onBoard.key !== onPage.key).toBe(true)
    const found = await auditionTakes(projectFile, 'grandmother', ['cur'])
    expect(found?.ok && found.takes).toEqual({ cur: onBoard?.ok ? onBoard.key : '' })
  })
})
