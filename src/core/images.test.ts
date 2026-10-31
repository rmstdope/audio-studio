import { describe, expect, it } from 'bun:test'
import { lookKey, lookOf } from './imageLook'
import {
  ChosenSchema,
  ImageListSchema,
  PromptsSchema,
  StyleSchema,
  applyActStyleChange,
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
  it('takes the game’s own image file, inside the project and a picture', () => {
    const file = (f: string) => ImageListSchema.safeParse([{ ...inn, file: f }]).success
    expect(file('web/public/images/inn.png')).toBe(true)
    expect(file('../inn.png')).toBe(false)
    expect(file('/inn.png')).toBe(false)
    expect(file('web/inn.mp3')).toBe(false)
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
  it('names the look, what is kept out and an act’s addition, but not the palette (the look notice owns it)', () => {
    const now = {
      ...style,
      look: 'x',
      palette: ['#000000'],
      acts: { act1: 'warm lantern light', act2: 'snow' },
    }
    expect(styleChanges(style, now, parts)).toEqual(['the look', 'the addition for Act II'])
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
  it('says which take is chosen, and the game’s own image file and whether it is there', () => {
    const withFile = { ...inn, file: 'web/inn.png' }
    const lists = input().lists.map((l) => ({
      ...l,
      state: { status: 'ok' as const, images: [withFile] },
    }))
    const first = summarizeImages(input({ lists })).images.acts[0]!.rows[0]!
    expect(first.chosenTake).toBeNull()
    expect(first.gameFile).toEqual({ file: 'web/inn.png', exists: false })
    const row = summarizeImages(
      input({
        lists,
        gameFiles: { [inn.id]: true },
        chosen: { [inn.id]: { ...first.madeFrom, take: 3 } },
      }),
    ).images.acts[0]!.rows[0]!
    expect(row.chosenTake).toBe(3)
    expect(row.gameFile).toEqual({ file: 'web/inn.png', exists: true })
    expect(summarizeImages(input()).images.acts[0]!.rows[0]!.gameFile).toBeNull()
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

describe('the game’s look in the rows', () => {
  const size = { width: inn.width, height: inn.height }
  const nowKey = lookKey(lookOf(style), size)
  const row = (over: Partial<ImagesInput> = {}) =>
    summarizeImages(input({ look: lookOf(style), ...over })).images
  const chosenAs = (look?: string): ImagesInput['chosen'] => {
    const first = summarizeImages(input()).images.acts[0]!.rows[0]!
    return { [inn.id]: { ...first.madeFrom, take: 1, ...(look ? { look } : {}) } }
  }

  it('gives the look line and what a picture is brought to', () => {
    const { look, looksOld } = row().acts[0]!.rows[0]!
    expect(look).toEqual({
      line: "320 × 200 · the game's palette, 2 colours · patterned dithering",
      key: nowKey,
      error: null,
    })
    expect(looksOld).toBe(false)
    expect(row().lookNotice).toBeNull()
  })
  it('is up to date when the chosen picture and the takes were brought to this look', () => {
    const images = row({ chosen: chosenAs(nowKey), takeLooks: { [inn.id]: [nowKey, nowKey] } })
    expect(images.acts[0]!.rows[0]!.looksOld).toBe(false)
    expect(images.lookNotice).toBeNull()
  })
  it('marks an image old when its chosen picture or any take has another look, and counts it once', () => {
    const other = lookKey(lookOf({ ...style, palette: ['#000000'] }), size)
    const chosen = row({ chosen: chosenAs(other), takeLooks: { [inn.id]: [other, other] } })
    expect(chosen.acts[0]!.rows[0]!.looksOld).toBe(true)
    expect(chosen.lookNotice).toEqual({ count: 1, changed: ['its palette'] })
    expect(row({ takeLooks: { [inn.id]: [nowKey, other] } }).acts[0]!.rows[0]!.looksOld).toBe(true)
  })
  it('names what changed: depth, dithering, size, and a picture that never had a look', () => {
    const named = (then: string | null) =>
      row({ chosen: chosenAs(undefined), takeLooks: { [inn.id]: [then] } }).lookNotice?.changed
    const was = (raw: object, w = 320, h = 200) =>
      lookKey(lookOf({ ...style, ...raw }), { width: w, height: h })
    expect(named(was({ dithering: 'flat' }))).toContain('its dithering')
    expect(named(was({}, 160, 100))).toContain("an image's size")
    expect(named(was({ palette: [], colourDepth: '8-bit' }))).toContain('its palette')
    expect(named(null)).toContain('its look')
  })
  it('has no look to compare, and no notice, while the style cannot be used', () => {
    const images = row({ look: null, lookError: 'no', chosen: chosenAs(undefined) })
    const { look, looksOld } = images.acts[0]!.rows[0]!
    expect(look).toEqual({
      line: "320 × 200 · the game's palette — can't be read",
      key: null,
      error: 'no',
    })
    expect(looksOld).toBe(false)
    expect(images.lookNotice).toBeNull()
  })
  it('is full colour when the game has no style file', () => {
    const { look } = summarizeImages(input({ style: null, seen: null, look: undefined })).images
      .acts[0]!.rows[0]!
    expect(look.line).toBe('320 × 200 · full colour')
  })
  it('keeps an image chosen before looks existed up to date: its style key had the palette in it', () => {
    const eff = effectiveStyle(style, none, 'act1')!
    const first = summarizeImages(input()).images.acts[0]!.rows[0]!
    const legacy = {
      ...first.madeFrom,
      take: 1,
      style: JSON.stringify([eff.look, eff.keepOut, eff.palette, eff.addition]),
    }
    const row = summarizeImages(input({ chosen: { [inn.id]: legacy } })).images.acts[0]!.rows[0]!
    expect(row.status).toBe('chosen')
    const changed = {
      ...legacy,
      style: JSON.stringify(['other', eff.keepOut, eff.palette, eff.addition]),
    }
    expect(
      summarizeImages(input({ chosen: { [inn.id]: changed } })).images.acts[0]!.rows[0]!.reasons,
    ).toEqual(['the style'])
  })
  it('does not make an image out of date when only the palette changes', () => {
    const chosen = chosenAs(nowKey)
    const changed = { ...style, palette: ['#ff0000'] }
    const row2 = summarizeImages(input({ style: changed, seen: changed, chosen })).images.acts[0]!
      .rows[0]!
    expect(row2.status).toBe('chosen')
  })
})

describe('leaving the act’s style out of one image', () => {
  const off: Prompts = { images: {}, style: {}, actStyleOff: [inn.id] }
  const row = (prompts: Prompts, extra: Partial<ImagesInput> = {}) =>
    summarizeImages(input({ prompts, ...extra })).images.acts[0]!.rows[0]!
  it('keeps the act’s line out of that image’s prompt only', () => {
    expect(assemblePrompt('w', effectiveStyle(style, off, 'act1', inn.id))).toBe(
      'w\nflat 16-colour pixel art\nKept out: text, modern things',
    )
    expect(assemblePrompt('w', effectiveStyle(style, off, 'act1', 'other'))).toContain(
      'warm lantern light',
    )
    const left = row(off)
    expect(left.prompt).not.toContain('warm lantern light')
    expect(left.actStyle).toEqual({ text: 'warm lantern light', on: false })
    expect(row(none).actStyle).toEqual({ text: 'warm lantern light', on: true })
    expect(summarizeImages(input({ prompts: off })).images.acts[0]!.addition).toBe(
      'warm lantern light',
    )
  })
  it('has no choice to show when the act adds no style, and keeps it for when one returns', () => {
    const plain = { ...style, acts: {} }
    expect(row(off, { style: plain }).actStyle).toBeNull()
    expect(row(off, { style: { ...style, acts: { act1: 'new light' } } }).prompt).not.toContain(
      'new light',
    )
  })
  it('toggles in the prompts, sorted, and removes the id when ticked again', () => {
    const one = applyActStyleChange(none, 'b', false)
    expect(applyActStyleChange(one, 'a', false).actStyleOff).toEqual(['a', 'b'])
    expect(applyActStyleChange(one, 'b', false).actStyleOff).toEqual(['b'])
    expect(applyActStyleChange(one, 'b', true).actStyleOff).toBeUndefined()
  })
  it('makes a picture out of date for the act’s style when the choice changes, and current again when undone', () => {
    const made = row(none).madeFrom
    expect(row(off, { chosen: { [inn.id]: made } })).toMatchObject({
      status: 'out of date',
      reasons: ['the act style'],
    })
    const madeLeftOut = row(off).madeFrom
    expect(row(none, { chosen: { [inn.id]: madeLeftOut } }).reasons).toEqual(['the act style'])
    expect(row(off, { chosen: { [inn.id]: madeLeftOut } }).status).toBe('chosen')
  })
  it('does not make a left-out image out of date when the game changes the act’s style, but does the others', () => {
    const changed = { ...style, acts: { act1: 'new light' } }
    const left = row(off).madeFrom
    expect(row(off, { style: changed, chosen: { [inn.id]: left } }).status).toBe('chosen')
    const used = row(none).madeFrom
    expect(row(none, { style: changed, chosen: { [inn.id]: used } }).reasons).toEqual([
      'the act style',
    ])
  })
  it('names the look and the act’s style apart, and still reads keys written with a palette', () => {
    const made = JSON.stringify(['a', 'k', 'x'])
    const now = { words: 'w', style: JSON.stringify(['b', 'k', null]), width: 1, height: 1 }
    expect(outOfDateReasons(now, { ...now, style: made })).toEqual(['the style', 'the act style'])
    const old = JSON.stringify(['a', 'k', ['#000'], 'x'])
    expect(outOfDateReasons({ ...now, style: made }, { ...now, style: old })).toEqual([])
  })
})
