import { describe, expect, it } from 'bun:test'
import {
  ChosenSchema,
  ImageListSchema,
  PromptsSchema,
  StyleSchema,
  applyStyleChange,
  applyWordsChange,
  assemblePrompt,
  effectiveStyle,
  outOfDateReasons,
  resolveCompare,
  styleChanges,
  summarizeImages,
  type GameStyle,
  type MadeFrom,
  type Prompts,
  type ImagesInput,
} from './images'

const style: GameStyle = {
  look: 'flat 16-colour pixel art',
  keepOut: 'text, modern things',
  palette: ['#000000', '#ffffff'],
  acts: { act1: 'warm lantern light' },
}
const none: Prompts = { images: {}, style: {} }
const inn = {
  id: 'silver-stag-inn',
  title: 'The Silver Stag Inn',
  description: 'a low inn at dusk',
  width: 320,
  height: 200,
}

describe('the game files', () => {
  it('accepts an image list and refuses a bad or repeated-in-list id', () => {
    expect(ImageListSchema.safeParse([inn]).success).toBe(true)
    expect(ImageListSchema.safeParse([{ ...inn, id: 'Silver Stag' }]).success).toBe(false)
    expect(ImageListSchema.safeParse([{ ...inn, width: 0 }]).success).toBe(false)
  })
  it('accepts a style and refuses a palette that is not hex colours', () => {
    expect(StyleSchema.safeParse(style).success).toBe(true)
    expect(StyleSchema.safeParse({ ...style, palette: ['red'] }).success).toBe(false)
  })
  it('reads the studio files, with extra keys in the lock tolerated', () => {
    expect(PromptsSchema.safeParse({ images: {}, style: {} }).success).toBe(true)
    const lock = {
      images: { a: { chosen: { words: 'w', style: 's', width: 1, height: 2 }, takes: [] } },
    }
    expect(ChosenSchema.safeParse(lock).success).toBe(true)
  })
})

describe('the assembled prompt', () => {
  const eff = effectiveStyle(style, none, 'act1')
  it('is the words, the act addition, the look, then what is kept out', () => {
    expect(assemblePrompt('a low inn', eff)).toBe(
      'a low inn\nwarm lantern light\nflat 16-colour pixel art\nKept out: text, modern things',
    )
  })
  it('leaves out what is empty, and is only the words without a style', () => {
    expect(assemblePrompt('a low inn', effectiveStyle(style, none, 'act2'))).toBe(
      'a low inn\nflat 16-colour pixel art\nKept out: text, modern things',
    )
    expect(assemblePrompt('a low inn', effectiveStyle(null, none, 'act1'))).toBe('a low inn')
  })
  it("uses the user's look over the game's", () => {
    const mine: Prompts = {
      images: {},
      style: { look: { words: 'oil paint', gameWas: style.look } },
    }
    expect(effectiveStyle(style, mine, 'act2')?.look).toBe('oil paint')
  })
})

describe('the studio’s own words', () => {
  it('keeps words that differ from the game’s, with the game’s words they were written over', () => {
    const next = applyWordsChange(none, 'inn', '  a cosy inn ', 'a low inn')
    expect(next.images.inn).toEqual({ words: 'a cosy inn', gameWas: 'a low inn' })
  })
  it('removes them when emptied or typed back as the game’s', () => {
    const mine = applyWordsChange(none, 'inn', 'a cosy inn', 'a low inn')
    expect(applyWordsChange(mine, 'inn', '', 'a low inn').images).toEqual({})
    expect(applyWordsChange(mine, 'inn', ' a low inn ', 'a low inn').images).toEqual({})
    expect(applyWordsChange(mine, 'inn', null, 'a low inn').images).toEqual({})
  })
  it('keeps the game’s words an existing override was written over, so editing does not settle a compare', () => {
    const mine: Prompts = { images: { inn: { words: 'cosy', gameWas: 'older' } }, style: {} }
    expect(applyWordsChange(mine, 'inn', 'cosier', 'a low inn').images.inn).toEqual({
      words: 'cosier',
      gameWas: 'older',
    })
  })
  it('does the same for the style fields', () => {
    const mine = applyStyleChange(none, 'look', 'oil paint', style.look)
    expect(mine.style.look).toEqual({ words: 'oil paint', gameWas: style.look })
    expect(applyStyleChange(mine, 'look', null, style.look).style).toEqual({})
  })
  it('settles a changed game description: keep mine moves the baseline, the game’s drops mine', () => {
    const mine: Prompts = { images: { inn: { words: 'cosy', gameWas: 'old' } }, style: {} }
    expect(resolveCompare(mine, 'inn', 'keep', 'new').images.inn).toEqual({
      words: 'cosy',
      gameWas: 'new',
    })
    expect(resolveCompare(mine, 'inn', 'game', 'new').images).toEqual({})
  })
})

const made: MadeFrom = { words: 'w', style: 's', width: 320, height: 200 }
describe('out of date', () => {
  it('names what differs, in the order the words, the size, the style', () => {
    expect(outOfDateReasons(made, made)).toEqual([])
    expect(outOfDateReasons({ ...made, words: 'x' }, made)).toEqual(['the words'])
    expect(outOfDateReasons({ ...made, width: 1, style: 'z' }, made)).toEqual([
      'the size',
      'the style',
    ])
  })
})

describe('what changed in the game’s style', () => {
  const parts = [
    { id: 'act1', title: 'Act I' },
    { id: 'act2', title: 'Act II' },
  ]
  it('is nothing when the same', () => {
    expect(styleChanges(style, { ...style }, parts)).toEqual([])
  })
  it('names the look, what is kept out, the palette and an act’s addition', () => {
    const now = {
      ...style,
      look: 'x',
      palette: ['#000000'],
      acts: { act1: 'warm lantern light', act2: 'snow' },
    }
    expect(styleChanges(style, now, parts)).toEqual([
      'the look',
      'the palette',
      'the addition for Act II',
    ])
    expect(styleChanges(style, { ...style, keepOut: 'y' }, parts)).toEqual(['what is kept out'])
  })
})

function input(over: Partial<ImagesInput> = {}): ImagesInput {
  return {
    parts: [{ id: 'act1', title: 'Act I' }],
    lists: [
      {
        id: 'act1',
        title: 'Act I',
        file: 'tts/act1/images.json',
        state: { status: 'ok', images: [inn] },
        canRefresh: true,
      },
    ],
    styleFile: 'images/style.json',
    style,
    prompts: none,
    chosen: {},
    seen: style,
    ...over,
  }
}

describe('summarizeImages', () => {
  it('lists each act’s images with their words, size and status', () => {
    const { images } = summarizeImages(input())
    const row = images.acts[0]!.rows[0]!
    expect(row).toMatchObject({
      id: 'silver-stag-inn',
      words: 'a low inn at dusk',
      changed: false,
      gameChanged: false,
      status: 'none yet',
    })
    expect(row.prompt).toContain('Kept out: text, modern things')
    expect(images.acts[0]!.addition).toBe('warm lantern light')
    expect(images.acts[0]!.chosen).toBe(0)
  })
  it('marks changed words, and the game’s words changed under them', () => {
    const prompts: Prompts = {
      images: { [inn.id]: { words: 'cosy', gameWas: 'older' } },
      style: {},
    }
    const row = summarizeImages(input({ prompts })).images.acts[0]!.rows[0]!
    expect(row).toMatchObject({ words: 'cosy', changed: true, gameChanged: true, gameWas: 'older' })
    expect(row.status).toBe('none yet')
  })
  it('is chosen when the take was made from the current prompt, and out of date otherwise', () => {
    const first = summarizeImages(input()).images.acts[0]!.rows[0]!
    const chosen = { [inn.id]: first.madeFrom }
    expect(summarizeImages(input({ chosen })).images.acts[0]!.rows[0]!.status).toBe('chosen')
    const bigger = {
      lists: [
        {
          ...input().lists[0]!,
          state: { status: 'ok' as const, images: [{ ...inn, width: 640 }] },
        },
      ],
    }
    const row = summarizeImages(input({ chosen, ...bigger })).images.acts[0]!.rows[0]!
    expect(row.status).toBe('out of date')
    expect(row.reasons).toEqual(['the size'])
  })
  it('does not call an image out of date when only the game’s words changed under the user’s', () => {
    const prompts: Prompts = {
      images: { [inn.id]: { words: 'cosy', gameWas: 'older' } },
      style: {},
    }
    const first = summarizeImages(input({ prompts })).images.acts[0]!.rows[0]!
    const row = summarizeImages(input({ prompts, chosen: { [inn.id]: first.madeFrom } })).images
      .acts[0]!.rows[0]!
    expect(row.status).toBe('chosen')
  })
  it('reports a missing list, an empty list and a missing style', () => {
    const missing = summarizeImages(
      input({
        lists: [{ ...input().lists[0]!, state: { status: 'missing' } }],
        style: null,
        seen: null,
      }),
    )
    expect(missing.images.acts[0]!.state).toBe('missing')
    expect(missing.images.style.present).toBe(false)
    expect(missing.images.acts[0]!.rows).toEqual([])
    const empty = summarizeImages(
      input({ lists: [{ ...input().lists[0]!, state: { status: 'ok', images: [] } }] }),
    )
    expect(empty.images.acts[0]!.state).toBe('ok')
  })
  it('drops images whose id is used twice, with a problem naming both files', () => {
    const lists = [
      { ...input().lists[0]! },
      {
        id: 'act2',
        title: 'Act II',
        file: 'tts/act2/images.json',
        state: { status: 'ok' as const, images: [inn] },
        canRefresh: true,
      },
    ]
    const result = summarizeImages(
      input({ lists, parts: [...input().parts, { id: 'act2', title: 'Act II' }] }),
    )
    expect(result.images.acts.every((act) => act.rows.length === 0)).toBe(true)
    expect(result.problems).toHaveLength(2)
    expect(result.problems[0]!.message).toContain('silver-stag-inn')
  })
  it('reports an act addition for a part the project does not have', () => {
    const odd = { ...style, acts: { act9: 'x' } }
    const result = summarizeImages(input({ style: odd, seen: odd }))
    expect(result.problems.map((p) => p.path)).toEqual(['acts.act9'])
  })
  it('raises the style notice with the chosen images made from the old style', () => {
    const first = summarizeImages(input()).images.acts[0]!.rows[0]!
    const chosen = { [inn.id]: first.madeFrom }
    const changed = { ...style, look: 'watercolour' }
    const result = summarizeImages(input({ style: changed, seen: style, chosen }))
    expect(result.images.styleNotice).toEqual({ count: 1, changed: ['the look'] })
    expect(result.images.acts[0]!.rows[0]!.reasons).toEqual(['the style'])
  })
  it('raises no notice for none chosen, for a first sight, or for the user’s own style change', () => {
    const changed = { ...style, look: 'watercolour' }
    expect(summarizeImages(input({ style: changed })).images.styleNotice).toBeNull()
    const first = summarizeImages(input()).images.acts[0]!.rows[0]!
    const chosen = { [inn.id]: first.madeFrom }
    expect(
      summarizeImages(input({ style: changed, seen: null, chosen })).images.styleNotice,
    ).toBeNull()
    const mine: Prompts = {
      images: {},
      style: { look: { words: 'oil paint', gameWas: style.look } },
    }
    const result = summarizeImages(input({ prompts: mine, chosen }))
    expect(result.images.styleNotice).toBeNull()
    expect(result.images.acts[0]!.rows[0]!.reasons).toEqual(['the style'])
  })
})
