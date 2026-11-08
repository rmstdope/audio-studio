import { describe, expect, it } from 'bun:test'
import { lookKey, lookOf } from './imageLook'
import {
  ImageEditsSchema,
  ImageLockSchema,
  ImageListSchema,
  StyleSchema,
  applyActStyleChange,
  applyActStylePick,
  applyAreaBox,
  areaFractions,
  withAreas,
  checkAreaBox,
  applyStyleChange,
  applyPatchWordsChange,
  applyWordsChange,
  assemblePrompt,
  effectiveStyle,
  formatImageEdits,
  formatImageLock,
  readImageEditsValue,
  acceptableReasons,
  imagesDone,
  outOfDateReasons,
  resolveCompare,
  resolvePatchCompare,
  summarizeImages,
  type ChosenEntry,
  type GameArea,
  type GamePatch,
  type ImageEdits,
  type ImageStyle,
  type MadeFrom,
  type ImagesInput,
} from './images'

const style: ImageStyle = {
  look: 'flat 16-colour pixel art',
  keepOut: 'text, modern things',
  palette: ['#000000', '#ffffff'],
  parts: { act1: 'warm lantern light' },
}
const none: ImageEdits = { images: {} }
const inn = {
  id: 'silver-stag-inn',
  title: 'The Silver Stag Inn',
  description: 'a low inn at dusk',
  width: 320,
  height: 200,
  patches: [] as GamePatch[],
  areas: [] as GameArea[],
}

describe('the game files', () => {
  const { description, ...listed } = inn
  const game = { ...listed, text: description }
  it('reads an image’s words from text, as its description inside the studio', () => {
    expect(ImageListSchema.parse([game])).toEqual([inn])
    expect(ImageListSchema.safeParse([inn]).error?.issues.map((i) => i.path)).toEqual([[0, 'text']])
  })
  it('accepts an image list and refuses a bad or repeated-in-list id', () => {
    expect(ImageListSchema.safeParse([game]).success).toBe(true)
    expect(ImageListSchema.safeParse([{ ...game, id: 'Silver Stag' }]).success).toBe(false)
    expect(ImageListSchema.safeParse([{ ...game, width: 0 }]).success).toBe(false)
  })
  it('takes the game’s own image file, inside the project and a picture', () => {
    const file = (f: string) => ImageListSchema.safeParse([{ ...game, file: f }]).success
    expect(file('web/public/images/inn.png')).toBe(true)
    expect(file('../inn.png')).toBe(false)
    expect(file('/inn.png')).toBe(false)
    expect(file('web/inn.mp3')).toBe(false)
  })
  it('accepts a style and refuses a palette that is not hex colours', () => {
    expect(StyleSchema.safeParse(style).success).toBe(true)
    expect(StyleSchema.safeParse({ ...style, palette: ['red'] }).success).toBe(false)
  })
  it('reads the images edits: the style, and text with gameWas, partStyle a part or null', () => {
    expect(ImageEditsSchema.parse({})).toEqual({ images: {} })
    const edits = {
      style,
      images: {
        inn: { text: 'cosy', gameWas: 'low', partStyle: 'act2' },
        map: { partStyle: null },
      },
    }
    expect(ImageEditsSchema.parse(edits)).toEqual(edits)
    expect(ImageEditsSchema.safeParse({ images: { inn: { text: 'cosy' } } }).success).toBe(false)
    expect(ImageEditsSchema.safeParse({ style: { keepOut: 'x' } }).success).toBe(false)
  })
})

describe('the images lock', () => {
  const key = (look: Parameters<typeof lookOf>[0], width = 320, height = 200) =>
    lookKey(lookOf(look), { width, height })
  const entry = {
    model: 'flux2-klein-4b',
    seed: 7,
    take: 3,
    inputs: {
      text: 'a low inn',
      width: 320,
      height: 200,
      style: { look: 'pixel art', keepOut: 'text', part: 'warm light' },
      look: { palette: ['#000000', '#ff8000'], dithering: 'flat' },
    },
    at: '2026-11-03T06:32:48.776Z',
  }
  const chosen: ChosenEntry = {
    words: 'a low inn',
    style: JSON.stringify(['pixel art', 'text', 'warm light']),
    width: 320,
    height: 200,
    take: 3,
    seed: 7,
    model: 'flux2-klein-4b',
    look: key({ palette: ['#000000', '#ff8000'], dithering: 'flat' }),
    at: '2026-11-03T06:32:48.776Z',
  }

  it('reads an entry keyed by image id, its inputs in the clear, as what the take was made from', () => {
    expect(ImageLockSchema.parse({ inn: entry })).toEqual({ inn: chosen })
    expect(ImageLockSchema.parse({})).toEqual({})
    const bare = { inputs: { text: 'w', width: 1, height: 2 } }
    expect(ImageLockSchema.parse({ a: bare })).toEqual({
      a: { words: 'w', style: '', width: 1, height: 2 },
    })
    expect(ImageLockSchema.safeParse({ a: { inputs: { width: 1, height: 2 } } }).success).toBe(
      false,
    )
  })

  it('writes one entry per line in id order, the inputs in the clear, and reads back the same', () => {
    const text = formatImageLock({ well: { ...chosen, take: 1 }, inn: chosen })
    expect(text).toBe(
      `{\n "inn": ${JSON.stringify(entry)},\n "well": ${JSON.stringify({ ...entry, take: 1 })}\n}\n`,
    )
    expect(ImageLockSchema.parse(JSON.parse(text))).toEqual({
      well: { ...chosen, take: 1 },
      inn: chosen,
    })
    expect(formatImageLock({})).toBe('{}\n')
  })

  it('writes the look as the style’s own fields: the palette, else the colour depth, and no dithering for full colour', () => {
    const lookOfEntry = (look: string) =>
      JSON.parse(formatImageLock({ a: { ...chosen, look } })).a.inputs.look
    expect(lookOfEntry(key({ palette: [], colourDepth: '8-bit', dithering: 'scattered' }))).toEqual(
      { colourDepth: '8-bit', dithering: 'scattered' },
    )
    expect(lookOfEntry(key({ palette: [] }))).toEqual({ colourDepth: 'full' })
    const { look: _look, ...unbrought } = chosen
    expect(JSON.parse(formatImageLock({ a: unbrought })).a.inputs.look).toBeUndefined()
  })

  it('keeps the size a picture was brought to when it is not the entry’s own, and reads it back', () => {
    const resized = { ...chosen, look: key({ palette: [] }, 640, 400) }
    const text = formatImageLock({ a: resized })
    expect(JSON.parse(text).a.inputs.look).toEqual({ colourDepth: 'full', width: 640, height: 400 })
    expect(ImageLockSchema.parse(JSON.parse(text))).toEqual({ a: resized })
    const same = formatImageLock({ a: { ...chosen, look: key({ palette: [] }) } })
    expect(JSON.parse(same).a.inputs.look).toEqual({ colourDepth: 'full' })
  })

  it('writes no style for a take made without one, part null for no addition, and reads old keys that held the palette', () => {
    const inputs = (style: string) =>
      JSON.parse(formatImageLock({ a: { ...chosen, style } })).a.inputs.style
    expect(inputs('')).toBeUndefined()
    expect(inputs(JSON.stringify(['p', 'k', null]))).toEqual({
      look: 'p',
      keepOut: 'k',
      part: null,
    })
    expect(inputs(JSON.stringify(['p', 'k', ['#000000'], 'x']))).toEqual({
      look: 'p',
      keepOut: 'k',
      part: 'x',
    })
  })

  it('leaves every chosen image as up to date, and every look as current, as before it was written', () => {
    const lookNow = lookOf(style)
    const base = summarizeImages(input({ look: lookNow })).images.acts[0]!.rows[0]!
    for (const made of [
      { ...base.madeFrom, take: 1, look: base.look.key! },
      { ...base.madeFrom, take: 1 },
      { ...base.madeFrom, take: 2, words: 'older words', look: key({ palette: [] }) },
    ]) {
      const read = ImageLockSchema.parse(JSON.parse(formatImageLock({ [inn.id]: made })))
      const before = summarizeImages(input({ look: lookNow, chosen: { [inn.id]: made } }))
      const after = summarizeImages(input({ look: lookNow, chosen: read }))
      expect(after.images).toEqual(before.images)
    }
    const left = summarizeImages(input({ edits: { [inn.id]: { partStyle: null } } }))
    const made = { ...left.images.acts[0]!.rows[0]!.madeFrom, take: 1 }
    const read = ImageLockSchema.parse(JSON.parse(formatImageLock({ [inn.id]: made })))
    expect(read[inn.id]).toEqual(made)
  })
})

describe('the assembled prompt', () => {
  const eff = effectiveStyle(style, 'act1')
  it('is the words, the act addition, the look, then what is kept out', () => {
    expect(assemblePrompt('a low inn', eff)).toBe(
      'a low inn\nwarm lantern light\nflat 16-colour pixel art\nKept out: text, modern things',
    )
  })
  it('leaves out what is empty, and is only the words without a style', () => {
    expect(assemblePrompt('a low inn', effectiveStyle(style, 'act2'))).toBe(
      'a low inn\nflat 16-colour pixel art\nKept out: text, modern things',
    )
    expect(assemblePrompt('a low inn', effectiveStyle(null, 'act1'))).toBe('a low inn')
  })
})

describe('the studio’s own words', () => {
  it('keeps words that differ from the game’s, with the game’s words they were written over', () => {
    const next = applyWordsChange(none, 'inn', '  a cosy inn ', 'a low inn')
    expect(next.images.inn).toEqual({ text: 'a cosy inn', gameWas: 'a low inn' })
  })
  it('removes them when emptied or typed back as the game’s', () => {
    const mine = applyWordsChange(none, 'inn', 'a cosy inn', 'a low inn')
    expect(applyWordsChange(mine, 'inn', '', 'a low inn').images).toEqual({})
    expect(applyWordsChange(mine, 'inn', ' a low inn ', 'a low inn').images).toEqual({})
    expect(applyWordsChange(mine, 'inn', null, 'a low inn').images).toEqual({})
    const picked = applyActStylePick(mine, 'inn', 'act2')
    expect(applyWordsChange(picked, 'inn', null, 'a low inn').images).toEqual({
      inn: { partStyle: 'act2' },
    })
  })
  it('keeps the game’s words an existing override was written over, so editing does not settle a compare', () => {
    const mine: ImageEdits = { images: { inn: { text: 'cosy', gameWas: 'older' } } }
    expect(applyWordsChange(mine, 'inn', 'cosier', 'a low inn').images.inn).toEqual({
      text: 'cosier',
      gameWas: 'older',
    })
  })
  it('sets the style’s look and what is kept out directly, refusing an empty look', () => {
    const styled: ImageEdits = { style, images: {} }
    expect(applyStyleChange(styled, 'look', ' oil paint ')).toEqual({
      style: { ...style, look: 'oil paint' },
      images: {},
    })
    expect(applyStyleChange(styled, 'keepOut', null)).toEqual({
      style: { ...style, keepOut: '' },
      images: {},
    })
    expect(applyStyleChange(styled, 'look', ' ')).toBe('empty look')
    expect(applyStyleChange(none, 'look', 'oil paint')).toBe('no style')
    expect(applyStyleChange(none, 'keepOut', null)).toBe('no style')
  })
  it('settles a changed game description: keep mine moves the baseline, the game’s drops mine', () => {
    const mine: ImageEdits = { images: { inn: { text: 'cosy', gameWas: 'old' } } }
    expect(resolveCompare(mine, 'inn', 'keep', 'new').images.inn).toEqual({
      text: 'cosy',
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
    editsFile: 'content-studio/images/edits.json',
    style,
    edits: {},
    chosen: {},
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
    const edits = { [inn.id]: { text: 'cosy', gameWas: 'older' } }
    const row = summarizeImages(input({ edits })).images.acts[0]!.rows[0]!
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
    const edits = { [inn.id]: { text: 'cosy', gameWas: 'older' } }
    const first = summarizeImages(input({ edits })).images.acts[0]!.rows[0]!
    const row = summarizeImages(input({ edits, chosen: { [inn.id]: first.madeFrom } })).images
      .acts[0]!.rows[0]!
    expect(row.status).toBe('chosen')
  })
  it('reports a missing list, an empty list and a missing style', () => {
    const missing = summarizeImages(
      input({
        lists: [{ ...input().lists[0]!, state: { status: 'missing' } }],
        style: null,
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
  it('reports an act addition for a part the project does not have', () => {
    const odd = { ...style, parts: { act9: 'x' } }
    const result = summarizeImages(input({ style: odd }))
    expect(result.problems).toEqual([
      {
        file: 'content-studio/images/edits.json',
        path: 'style.parts.act9',
        message: '"act9" is not one of the project\'s parts',
      },
    ])
  })
  it('makes a chosen image out of date for the style when the style changes', () => {
    const first = summarizeImages(input()).images.acts[0]!.rows[0]!
    const chosen = { [inn.id]: first.madeFrom }
    const changed = { ...style, look: 'watercolour' }
    const row = summarizeImages(input({ style: changed, chosen })).images.acts[0]!.rows[0]!
    expect(row.reasons).toEqual(['the style'])
  })
  it('shows the style as it is on the Style page, with each part’s addition', () => {
    const { style: view } = summarizeImages(input()).images
    expect(view).toEqual({
      present: true,
      invalid: false,
      look: style.look,
      keepOut: style.keepOut,
      palette: style.palette,
      acts: [{ id: 'act1', title: 'Act I', addition: 'warm lantern light' }],
    })
    const unread = summarizeImages(input({ style: null, editsInvalid: true })).images.style
    expect(unread).toMatchObject({ present: false, invalid: true, look: '', keepOut: '' })
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
  it('is full colour when there is no style', () => {
    const { look } = summarizeImages(input({ style: null, look: undefined })).images.acts[0]!
      .rows[0]!
    expect(look.line).toBe('320 × 200 · full colour')
  })
  it('keeps an image chosen before looks existed up to date: its style key had the palette in it', () => {
    const eff = effectiveStyle(style, 'act1')!
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
    const row2 = summarizeImages(input({ style: changed, chosen })).images.acts[0]!.rows[0]!
    expect(row2.status).toBe('chosen')
  })
})

describe('leaving the act’s style out of one image', () => {
  const off: ImageEdits['images'] = { [inn.id]: { partStyle: null } }
  const row = (edits: ImageEdits['images'], extra: Partial<ImagesInput> = {}) =>
    summarizeImages(input({ edits, ...extra })).images.acts[0]!.rows[0]!
  it('keeps the act’s line out of that image’s prompt only', () => {
    expect(assemblePrompt('w', effectiveStyle(style, 'act1', true))).toBe(
      'w\nflat 16-colour pixel art\nKept out: text, modern things',
    )
    expect(assemblePrompt('w', effectiveStyle(style, 'act1'))).toContain('warm lantern light')
    const left = row(off)
    expect(left.prompt).not.toContain('warm lantern light')
    expect(left.actStyle).toEqual({ text: 'warm lantern light', on: false })
    expect(row({}).actStyle).toEqual({ text: 'warm lantern light', on: true })
    expect(summarizeImages(input({ edits: off })).images.acts[0]!.addition).toBe(
      'warm lantern light',
    )
  })
  it('has no choice to show when the act adds no style, and keeps it for when one returns', () => {
    const plain = { ...style, parts: {} }
    expect(row(off, { style: plain }).actStyle).toBeNull()
    expect(row(off, { style: { ...style, parts: { act1: 'new light' } } }).prompt).not.toContain(
      'new light',
    )
  })
  it('toggles as partStyle null in the edits, and removes it when ticked again', () => {
    const one = applyActStyleChange(none, 'b', false)
    expect(one.images).toEqual({ b: { partStyle: null } })
    expect(applyActStyleChange(one, 'b', false).images).toEqual({ b: { partStyle: null } })
    expect(applyActStyleChange(one, 'b', true).images).toEqual({})
    const worded = applyWordsChange(one, 'b', 'mine', 'game')
    expect(applyActStyleChange(worded, 'b', true).images).toEqual({
      b: { text: 'mine', gameWas: 'game' },
    })
  })
  it('picks a part, or none, as partStyle', () => {
    expect(applyActStylePick(none, 'b', 'act2').images).toEqual({ b: { partStyle: 'act2' } })
    expect(applyActStylePick(none, 'b', null).images).toEqual({ b: { partStyle: null } })
  })
  it('makes a picture out of date for the act’s style when the choice changes, and current again when undone', () => {
    const made = row({}).madeFrom
    expect(row(off, { chosen: { [inn.id]: made } })).toMatchObject({
      status: 'out of date',
      reasons: ['the act style'],
    })
    const madeLeftOut = row(off).madeFrom
    expect(row({}, { chosen: { [inn.id]: madeLeftOut } }).reasons).toEqual(['the act style'])
    expect(row(off, { chosen: { [inn.id]: madeLeftOut } }).status).toBe('chosen')
  })
  it('does not make a left-out image out of date when the game changes the act’s style, but does the others', () => {
    const changed = { ...style, parts: { act1: 'new light' } }
    const left = row(off).madeFrom
    expect(row(off, { style: changed, chosen: { [inn.id]: left } }).status).toBe('chosen')
    const used = row({}).madeFrom
    expect(row({}, { style: changed, chosen: { [inn.id]: used } }).reasons).toEqual([
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

describe('an image the game lists in several acts', () => {
  const lists = (...images: (typeof inn)[][]): ImagesInput['lists'] =>
    images.map((list, i) => ({
      id: `act${i + 1}`,
      title: `Act ${['I', 'II', 'III'][i]}: Title`,
      file: `tts/act${i + 1}/images.json`,
      state: { status: 'ok' as const, images: list },
      canRefresh: true,
    }))
  const shared = (over: Partial<ImagesInput> = {}) =>
    summarizeImages(
      input({
        parts: [
          { id: 'act1', title: 'Act I: Title' },
          { id: 'act2', title: 'Act II: Title' },
          { id: 'act3', title: 'Act III: Title' },
        ],
        lists: lists([inn], [inn], [inn]),
        style: { ...style, parts: { act1: 'warm lantern light', act3: 'cold dawn' } },
        ...over,
      }),
    )

  it('is one image shown in each act, naming the other acts', () => {
    const { images, problems } = shared()
    expect(problems).toEqual([])
    expect(images.acts.map((a) => a.rows.map((r) => r.id))).toEqual([[inn.id], [inn.id], [inn.id]])
    expect(images.acts[0]!.rows[0]!.sharedWith.map((a) => a.id)).toEqual(['act2', 'act3'])
    expect(images.acts[2]!.rows[0]!.sharedWith.map((a) => a.id)).toEqual(['act1', 'act2'])
    expect(images.acts[1]!.rows[0]!.partId).toBe('act2')
    expect(images.acts[0]!.order).toEqual([inn.id])
  })
  it('is not shared when only one act lists it', () => {
    const row = summarizeImages(input()).images.acts[0]!.rows[0]!
    expect(row.sharedWith).toEqual([])
    expect(row.actStyle).toEqual({ text: 'warm lantern light', on: true })
  })
  it('has one status, from one chosen take, in every act', () => {
    const first = shared().images.acts[0]!.rows[0]!
    const { images } = shared({ chosen: { [inn.id]: { ...first.madeFrom, take: 2 } } })
    expect(images.acts.map((a) => a.rows[0]!.status)).toEqual(['chosen', 'chosen', 'chosen'])
    expect(images.acts.map((a) => a.rows[0]!.chosenTake)).toEqual([2, 2, 2])
  })
  it('counts once in the look notice', () => {
    const first = shared().images.acts[0]!.rows[0]!
    const chosen = { [inn.id]: { ...first.madeFrom, take: 1, look: 'old' } }
    const { images } = shared({ chosen, look: lookOf(style) })
    expect(images.lookNotice?.count).toBe(1)
  })

  describe('act style', () => {
    const row = (over: Partial<ImagesInput> = {}, at = 0) => shared(over).images.acts[at]!.rows[0]!
    it('offers the acts that add a style, starting on the first act in the game’s order', () => {
      const r = row()
      expect(r.actStyle).toEqual({
        text: 'warm lantern light',
        on: true,
        pick: 'act1',
        choices: [
          { id: 'act1', title: 'Act I: Title', text: 'warm lantern light' },
          { id: 'act3', title: 'Act III: Title', text: 'cold dawn' },
        ],
      })
      expect(r.prompt).toContain('warm lantern light')
      // the same from every act
      expect(row({}, 2).actStyle).toEqual(r.actStyle)
      expect(row({}, 2).prompt).toBe(r.prompt)
    })
    it('uses the picked act’s addition', () => {
      const r = row({ edits: { [inn.id]: { partStyle: 'act3' } } })
      expect(r.actStyle?.pick).toBe('act3')
      expect(r.prompt).toContain('cold dawn')
      expect(r.prompt).not.toContain('warm lantern')
    })
    it('starts on None when the first act adds none, and shows no menu when no act adds one', () => {
      const r = row({ style: { ...style, parts: { act3: 'cold dawn' } } })
      expect(r.actStyle?.pick).toBeNull()
      expect(r.actStyle?.on).toBe(false)
      expect(r.prompt).not.toContain('cold dawn')
      expect(row({ style: { ...style, parts: {} } }).actStyle).toBeNull()
    })
    it('is None when the image leaves it out', () => {
      const r = row({ edits: { [inn.id]: { partStyle: null } } })
      expect(r.actStyle?.pick).toBeNull()
      expect(r.prompt).not.toContain('cold dawn')
    })
    it('goes back to the first act when the picked act no longer lists the image', () => {
      const r = row({
        lists: lists([inn], [inn], []),
        edits: { [inn.id]: { partStyle: 'act3' } },
      })
      expect(r.actStyle?.pick).toBe('act1')
    })
    it('names the act style in the out-of-date reason', () => {
      const made = row().madeFrom
      const chosen = { [inn.id]: { ...made, take: 1 } }
      const picked = row({ chosen, edits: { [inn.id]: { partStyle: 'act3' } } })
      expect(picked.reasons).toEqual(['the act style'])
      expect(picked.actStyleChange).toEqual({ now: 'act3', was: 'act1' })
      const left = row({ chosen, edits: { [inn.id]: { partStyle: null } } })
      expect(left.actStyleChange).toEqual({ now: null, was: 'act1' })
      expect(row({ chosen }).actStyleChange).toBeNull()
    })
  })
})

describe('lists that disagree about an image', () => {
  const act = (n: number, image: typeof inn) => ({
    id: `act${n}`,
    title: `Act ${n}`,
    file: `tts/act${n}/images.json`,
    state: { status: 'ok' as const, images: [inn, image, { ...inn, id: `other-${n}` }].slice(1) },
    canRefresh: true,
  })
  const summary = (...images: (typeof inn)[]) =>
    summarizeImages(
      input({
        parts: images.map((_, i) => ({ id: `act${i + 1}`, title: `Act ${i + 1}` })),
        lists: images.map((image, i) => act(i + 1, image)),
      }),
    )

  it('shows neither copy, keeps the place in each act, and names the difference', () => {
    const { images } = summary(inn, { ...inn, description: 'a different inn' })
    for (const a of images.acts) {
      expect(a.rows.map((r) => r.id)).toEqual([`other-${a.id.slice(3)}`])
      expect(a.order).toEqual([inn.id, `other-${a.id.slice(3)}`])
      expect(a.conflicts).toEqual([
        {
          id: inn.id,
          title: inn.title,
          acts: [
            { id: 'act1', title: 'Act 1' },
            { id: 'act2', title: 'Act 2' },
          ],
          differs: ['words'],
        },
      ])
    }
  })
  it('reports words, sizes and names, in that order', () => {
    const both = summary(inn, { ...inn, width: 640, title: 'Another', description: 'x' })
    expect(both.images.acts[0]!.conflicts[0]!.differs).toEqual(['words', 'sizes', 'names'])
  })
  it('puts one problem on each list, naming the other list', () => {
    const { problems } = summary(inn, { ...inn, height: 100 })
    expect(problems).toEqual([
      {
        file: 'tts/act1/images.json',
        path: '[0].id',
        message: `the image "${inn.id}" has another size in tts/act2/images.json`,
      },
      {
        file: 'tts/act2/images.json',
        path: '[0].id',
        message: `the image "${inn.id}" has another size in tts/act1/images.json`,
      },
    ])
  })
  it('says other words, and joins what differs', () => {
    const { problems } = summary(inn, { ...inn, description: 'x', title: 'y' })
    expect(problems[0]!.message).toBe(
      `the image "${inn.id}" has other words and another name in tts/act2/images.json`,
    )
  })
  it('names, for each list of three, a list it differs from', () => {
    const { problems } = summary(inn, inn, { ...inn, description: 'x' })
    expect(problems.map((p) => p.message.split(' in ')[1])).toEqual([
      'tts/act3/images.json',
      'tts/act3/images.json',
      'tts/act1/images.json',
    ])
  })
  it('keeps the old problem for an id used twice in one list', () => {
    const result = summarizeImages(
      input({
        lists: [
          {
            id: 'act1',
            title: 'Act I',
            file: 'tts/act1/images.json',
            state: { status: 'ok', images: [inn, inn] },
            canRefresh: true,
          },
        ],
      }),
    )
    expect(result.images.acts[0]!.rows).toEqual([])
    expect(result.problems.map((p) => p.message)).toEqual([
      `the image id "${inn.id}" is used more than once in the game's lists`,
      `the image id "${inn.id}" is used more than once in the game's lists`,
    ])
  })
})

describe('acceptableReasons', () => {
  it('are changed words or styles, never a changed size', () => {
    expect(acceptableReasons(['the words', 'the style', 'the act style'])).toBe(true)
    expect(acceptableReasons(['the words', 'the size'])).toBe(false)
    expect(acceptableReasons([])).toBe(false)
  })
})

describe('imagesDone', () => {
  const row = (id: string, status: string) => ({ id, status })
  it('counts the images chosen and up to date out of all, the ones the lists disagree on among them', () => {
    const act = {
      rows: [row('a', 'chosen'), row('b', 'out of date'), row('c', 'none yet')],
      conflicts: [{ id: 'd' }],
    } as never
    expect(imagesDone(act)).toEqual({ done: 1, total: 4, needs: ['b', 'c', 'd'] })
  })
})

describe('formatImageEdits', () => {
  it('writes the style first in a fixed key order, leaving out what is at its default', () => {
    const edits = ImageEditsSchema.parse({
      images: { well: { partStyle: null }, inn: { gameWas: 'low', text: 'cosy' } },
      style: { parts: { act1: 'warm' }, dithering: 'flat', keepOut: '', look: 'pixels' },
    })
    expect(formatImageEdits(edits)).toBe(
      `${JSON.stringify(
        {
          style: { look: 'pixels', dithering: 'flat', parts: { act1: 'warm' } },
          images: { inn: { text: 'cosy', gameWas: 'low' }, well: { partStyle: null } },
        },
        null,
        2,
      )}\n`,
    )
    expect(formatImageEdits({ images: {} })).toBe('{\n  "images": {}\n}\n')
  })
})

describe('readImageEditsValue', () => {
  const FILE = 'content-studio/images/edits.json'
  const own = { text: 'cosy', gameWas: 'low' }

  it('reads the style and every image, with no problems', () => {
    expect(readImageEditsValue({ style, images: { inn: own } }, FILE)).toEqual({
      edits: { style, images: { inn: own } },
      styleBroken: false,
      problems: [],
    })
    expect(readImageEditsValue({}, FILE)).toEqual({
      edits: { images: {} },
      styleBroken: false,
      problems: [],
    })
  })

  it('leaves out only a bad image, with a problem at its path', () => {
    const read = readImageEditsValue(
      { style, images: { inn: own, well: { text: 'deep' }, map: { partStyle: 3 } } },
      FILE,
    )
    expect(read.edits).toEqual({ style, images: { inn: own } })
    expect(read.styleBroken).toBe(false)
    expect(read.problems.map((p) => [p.file, p.path])).toEqual([
      [FILE, 'images.well'],
      [FILE, 'images.map.partStyle'],
    ])
  })

  it('keeps the rewordings when the style is bad, and says the style is broken', () => {
    const read = readImageEditsValue({ style: { keepOut: 'x' }, images: { inn: own } }, FILE)
    expect(read.edits).toEqual({ images: { inn: own } })
    expect(read.styleBroken).toBe(true)
    expect(read.problems.map((p) => p.path)).toEqual(['style.look'])
  })

  it('takes a file that is not an object, or images that are not one, as having none', () => {
    const notObject = readImageEditsValue([1], FILE)
    expect(notObject).toMatchObject({ edits: { images: {} }, styleBroken: true })
    expect(notObject.problems.map((p) => p.path)).toEqual([''])
    const images = readImageEditsValue({ style, images: [] }, FILE)
    expect(images.edits).toEqual({ style, images: {} })
    expect(images.problems.map((p) => p.path)).toEqual(['images'])
  })
})

describe('the patches the game asks for', () => {
  const bread = { id: 'bread-taken', title: 'Bread taken', description: 'Remove the bread' }
  const lamp = { id: 'lamp-lit', title: 'Lamp lit', description: 'Light the lamp' }
  const withPatches = { ...inn, patches: [bread, lamp] }
  const game = (patches: unknown) => ({
    id: inn.id,
    title: inn.title,
    text: inn.description,
    width: 320,
    height: 200,
    patches,
  })
  const asked = (patches: unknown) => ImageListSchema.safeParse([game(patches)])

  it('reads them, as text, and an image with none has an empty list', () => {
    const read = asked([{ id: 'bread-taken', title: 'Bread taken', text: 'Remove the bread' }])
    expect(read.data?.[0]?.patches).toEqual([bread])
    expect(ImageListSchema.parse([{ ...game(undefined), patches: undefined }])[0]!.patches).toEqual(
      [],
    )
    expect(asked([]).data?.[0]?.patches).toEqual([])
  })
  it('refuses a patch with no id, title or words, or an id repeated in the image', () => {
    const one = { id: 'bread-taken', title: 'Bread taken', text: 'Remove the bread' }
    expect(asked([{ ...one, id: undefined }]).success).toBe(false)
    expect(asked([{ ...one, id: 'Bread Taken' }]).success).toBe(false)
    expect(asked([{ ...one, title: '' }]).success).toBe(false)
    expect(asked([{ ...one, text: '' }]).success).toBe(false)
    const twice = asked([one, { ...one, title: 'Again' }])
    expect(twice.error?.issues.map((i) => i.path)).toEqual([[0, 'patches', 1, 'id']])
  })
  it('keeps the edit of words with the game’s words they were written over, sorted by id', () => {
    const edits = applyPatchWordsChange(none, 'inn', 'lamp-lit', ' Dim the lamp ', 'Light the lamp')
    expect(edits.images.inn).toEqual({
      patches: { 'lamp-lit': { text: 'Dim the lamp', gameWas: 'Light the lamp' } },
    })
    const both = applyPatchWordsChange(edits, 'inn', 'bread-taken', 'No bread', 'Remove the bread')
    expect(Object.keys(JSON.parse(formatImageEdits(both)).images.inn.patches)).toEqual([
      'bread-taken',
      'lamp-lit',
    ])
    expect(ImageEditsSchema.parse(JSON.parse(formatImageEdits(both)))).toEqual(both)
  })
  it('takes the words back when emptied or typed as the game’s, leaving the image’s own edit', () => {
    const own: ImageEdits = { images: { inn: { text: 'cosy', gameWas: 'old' } } }
    const mine = applyPatchWordsChange(own, 'inn', 'lamp-lit', 'Dim', 'Light the lamp')
    expect(mine.images.inn!.text).toBe('cosy')
    const back = applyPatchWordsChange(mine, 'inn', 'lamp-lit', 'Light the lamp', 'Light the lamp')
    expect(back).toEqual(own)
    expect(applyPatchWordsChange(mine, 'inn', 'lamp-lit', null, 'Light the lamp')).toEqual(own)
    const only = applyPatchWordsChange(none, 'inn', 'lamp-lit', 'Dim', 'Light the lamp')
    expect(applyPatchWordsChange(only, 'inn', 'lamp-lit', '', 'Light the lamp').images).toEqual({})
  })
  it('keeps the words of the other patches and the image’s words when one is taken back', () => {
    let edits = applyPatchWordsChange(none, 'inn', 'lamp-lit', 'Dim', 'Light the lamp')
    edits = applyPatchWordsChange(edits, 'inn', 'bread-taken', 'No bread', 'Remove the bread')
    edits = applyPatchWordsChange(edits, 'inn', 'lamp-lit', null, 'Light the lamp')
    expect(Object.keys(edits.images.inn!.patches!)).toEqual(['bread-taken'])
  })
  it('settles a changed patch: keep mine moves the baseline, the game’s drops mine', () => {
    const mine = applyPatchWordsChange(none, 'inn', 'lamp-lit', 'Dim', 'old')
    expect(resolvePatchCompare(mine, 'inn', 'lamp-lit', 'keep', 'new').images.inn).toEqual({
      patches: { 'lamp-lit': { text: 'Dim', gameWas: 'new' } },
    })
    expect(resolvePatchCompare(mine, 'inn', 'lamp-lit', 'game', 'new').images).toEqual({})
  })
  it('a patch edit without gameWas drops that image’s edit, and no other image’s', () => {
    const read = readImageEditsValue(
      {
        images: {
          inn: { patches: { 'lamp-lit': { text: 'Dim' } } },
          bar: { text: 'a', gameWas: 'b' },
        },
      },
      'edits.json',
    )
    expect(Object.keys(read.edits.images)).toEqual(['bar'])
    expect(read.problems.length).toBe(1)
  })

  describe('in the rows', () => {
    const rowOf = (over: Partial<ImagesInput> = {}, image = withPatches) =>
      summarizeImages(
        input({
          lists: [
            {
              id: 'act1',
              title: 'Act I',
              file: 'tts/act1/images.json',
              state: { status: 'ok', images: [image] },
              canRefresh: true,
            },
          ],
          ...over,
        }),
      ).images.acts[0]!.rows[0]!

    it('lists them in the game’s order with the game’s words, none reworded', () => {
      expect(rowOf().patches).toEqual([
        { ...bread, words: bread.description, changed: false, gameChanged: false, gameWas: null },
        { ...lamp, words: lamp.description, changed: false, gameChanged: false, gameWas: null },
      ])
      expect(rowOf({}, inn).patches).toEqual([])
    })
    it('uses the user’s words, and notes when the game’s changed under them', () => {
      const edits = {
        [inn.id]: {
          patches: {
            'lamp-lit': { text: 'Dim it', gameWas: 'Light the lamp' },
            'bread-taken': { text: 'No bread', gameWas: 'Take the bread' },
          },
        },
      }
      const [b, l] = rowOf({ edits }).patches
      expect(l).toMatchObject({ words: 'Dim it', changed: true, gameChanged: false })
      expect(b).toMatchObject({
        words: 'No bread',
        changed: true,
        gameChanged: true,
        gameWas: 'Take the bread',
      })
    })
    it('drops a patch the game stopped asking for from the rows, keeping the words in the edits', () => {
      const edits = { [inn.id]: { patches: { gone: { text: 'x', gameWas: 'y' } } } }
      expect(rowOf({ edits }, { ...inn, patches: [bread] }).patches.map((p) => p.id)).toEqual([
        'bread-taken',
      ])
    })
    it('does not make the image out of date, nor change what a take is made from', () => {
      const plain = rowOf({}, inn)
      const edits = { [inn.id]: { patches: { 'lamp-lit': { text: 'Dim', gameWas: 'Light' } } } }
      const row = rowOf({ edits, chosen: { [inn.id]: plain.madeFrom } })
      expect(row.status).toBe('chosen')
      expect(row.madeFrom).toEqual(plain.madeFrom)
      expect(row.prompt).toBe(plain.prompt)
    })
  })

  describe('shared between acts', () => {
    const lists = (...images: (typeof inn)[]): ImagesInput['lists'] =>
      images.map((image, i) => ({
        id: `act${i + 1}`,
        title: `Act ${i + 1}`,
        file: `tts/act${i + 1}/images.json`,
        state: { status: 'ok' as const, images: [image] },
        canRefresh: true,
      }))
    const run = (...images: (typeof inn)[]) =>
      summarizeImages(
        input({
          parts: images.map((_, i) => ({ id: `act${i + 1}`, title: `Act ${i + 1}` })),
          lists: lists(...images),
        }),
      )

    it('is a disagreement when a patch is missing or its id, title or words differ', () => {
      for (const other of [
        [bread],
        [bread, { ...lamp, id: 'lamp-out' }],
        [bread, { ...lamp, title: 'Lamp' }],
        [bread, { ...lamp, description: 'x' }],
      ]) {
        const { images } = run(withPatches, { ...inn, patches: other })
        expect(images.acts[0]!.conflicts[0]!.differs).toEqual(['patches'])
        expect(images.acts[0]!.rows).toEqual([])
      }
    })
    it('joins patches to the other kinds, and the problem says other patches', () => {
      const { images, problems } = run(withPatches, { ...inn, description: 'x', patches: [bread] })
      expect(images.acts[0]!.conflicts[0]!.differs).toEqual(['words', 'patches'])
      expect(problems[0]!.message).toBe(
        `the image "${inn.id}" has other words and other patches in tts/act2/images.json`,
      )
    })
    it('is not a disagreement in another order, and uses the first act’s order', () => {
      const { images, problems } = run(withPatches, { ...inn, patches: [lamp, bread] })
      expect(problems).toEqual([])
      for (const act of images.acts) {
        expect(act.rows[0]!.patches.map((p) => p.id)).toEqual(['bread-taken', 'lamp-lit'])
      }
    })
  })
})

describe('a patch tied to a named area', () => {
  const well = { id: 'well', title: 'Well' }
  const tied = { id: 'well-dry', title: 'Well dry', description: 'Dry it', area: 'well' }
  const game = (patches: unknown, areas: unknown = [well]) => ({
    id: inn.id,
    title: inn.title,
    text: inn.description,
    width: 320,
    height: 200,
    patches,
    areas,
  })
  const asked = (patches: unknown, areas?: unknown) =>
    ImageListSchema.safeParse([game(patches, areas)])
  const entry = { id: 'well-dry', title: 'Well dry', text: 'Dry it' }

  it('reads the tie, and a patch without one has none', () => {
    expect(asked([{ ...entry, area: 'well' }]).data?.[0]?.patches).toEqual([tied])
    expect(asked([entry]).data?.[0]?.patches[0]?.area).toBeUndefined()
  })
  it('reports a tie to an area the image does not list, at its place', () => {
    const bad = asked([{ ...entry, area: 'wel' }])
    expect(bad.success).toBe(false)
    expect(bad.error?.issues.map((i) => [i.path, i.message])).toEqual([
      [
        [0, 'patches', 0, 'area'],
        'the patch "well-dry" names the area "wel", which this image does not list',
      ],
    ])
    expect(asked([{ ...entry, area: 'well' }], []).success).toBe(false)
    expect(asked([{ ...entry, area: 'Not a slug' }]).success).toBe(false)
  })
  it('is a disagreement between acts when the tie differs, and only "patches"', () => {
    const lists = [inn, inn].map((_, i) => ({
      id: `act${i + 1}`,
      title: `Act ${i + 1}`,
      file: `tts/act${i + 1}/images.json`,
      state: {
        status: 'ok' as const,
        images: [{ ...inn, areas: [well], patches: [i ? { ...tied, area: undefined } : tied] }],
      },
      canRefresh: true,
    }))
    const { images } = summarizeImages(
      input({
        parts: [
          { id: 'act1', title: 'Act 1' },
          { id: 'act2', title: 'Act 2' },
        ],
        lists,
      }),
    )
    expect(images.acts[0]!.conflicts[0]!.differs).toEqual(['patches'])
  })
  it('carries the tie in the row and does not make a chosen take out of date when it changes', () => {
    const run = (area: string | undefined, chosen?: ChosenEntry) =>
      summarizeImages(
        input({
          lists: [
            {
              id: 'act1',
              title: 'Act I',
              file: 'tts/act1/images.json',
              state: {
                status: 'ok',
                images: [{ ...inn, areas: [well], patches: [{ ...tied, area }] }],
              },
              canRefresh: true,
            },
          ],
          ...(chosen ? { chosen: { [inn.id]: chosen } } : {}),
        }),
      ).images.acts[0]!.rows[0]!
    const before = run('well')
    expect(before.patches[0]!.area).toBe('well')
    const after = run(undefined, before.madeFrom as ChosenEntry)
    expect(after.status).toBe('chosen')
  })
})

describe('the named areas the game declares', () => {
  const fountain = { id: 'fountain', title: 'Fountain' }
  const notice = { id: 'old-notice', title: 'Old notice' }
  const withAreas = { ...inn, areas: [fountain, notice] }
  const game = (areas: unknown) => ({
    id: inn.id,
    title: inn.title,
    text: inn.description,
    width: 320,
    height: 200,
    areas,
  })
  const asked = (areas: unknown) => ImageListSchema.safeParse([game(areas)])
  const rowsOf = (...images: (typeof inn)[]) =>
    summarizeImages(
      input({
        parts: images.map((_, i) => ({ id: `act${i + 1}`, title: `Act ${i + 1}` })),
        lists: images.map((image, i) => ({
          id: `act${i + 1}`,
          title: `Act ${i + 1}`,
          file: `tts/act${i + 1}/images.json`,
          state: { status: 'ok' as const, images: [image] },
          canRefresh: true,
        })),
      }),
    )

  it('reads them, and an image with none or an empty list has an empty list', () => {
    expect(asked([fountain, notice]).data?.[0]?.areas).toEqual([fountain, notice])
    expect(ImageListSchema.parse([{ ...game(undefined), areas: undefined }])[0]!.areas).toEqual([])
    expect(asked([]).data?.[0]?.areas).toEqual([])
  })
  it('refuses an area with no id or title, a bad id, or an id repeated in the image', () => {
    expect(asked([{ ...fountain, id: undefined }]).success).toBe(false)
    expect(asked([{ ...fountain, id: 'Old Notice' }]).success).toBe(false)
    expect(asked([{ ...fountain, title: '' }]).success).toBe(false)
    const twice = asked([fountain, { ...fountain, title: 'Again' }])
    expect(twice.error?.issues.map((i) => i.path)).toEqual([[0, 'areas', 1, 'id']])
  })
  it('lists them in the game’s order, none placed yet', () => {
    const [row] = rowsOf(withAreas).images.acts[0]!.rows
    expect(row!.areas).toEqual([
      { ...fountain, placed: false, box: null },
      { ...notice, placed: false, box: null },
    ])
    expect(rowsOf(inn).images.acts[0]!.rows[0]!.areas).toEqual([])
  })
  it('does not make a chosen take out of date when an area changes', () => {
    const plain = rowsOf(inn).images.acts[0]!.rows[0]!
    const { images } = summarizeImages(
      input({
        lists: [
          {
            id: 'act1',
            title: 'Act I',
            file: 'tts/act1/images.json',
            state: {
              status: 'ok',
              images: [{ ...withAreas, areas: [{ ...fountain, title: 'Well' }] }],
            },
            canRefresh: true,
          },
        ],
        chosen: { [inn.id]: plain.madeFrom },
      }),
    )
    expect(images.acts[0]!.rows[0]!.status).toBe('chosen')
  })
  it('is a disagreement when an area is missing or its id or title differs', () => {
    for (const other of [
      [fountain],
      [fountain, { ...notice, id: 'sign' }],
      [fountain, { ...notice, title: 'Sign' }],
    ]) {
      const { images } = rowsOf(withAreas, { ...inn, areas: other })
      expect(images.acts[0]!.conflicts[0]!.differs).toEqual(['named areas'])
      expect(images.acts[0]!.rows).toEqual([])
    }
  })
  it('names the areas among the other kinds in the problem', () => {
    const { images, problems } = rowsOf(withAreas, { ...inn, description: 'x', areas: [fountain] })
    expect(images.acts[0]!.conflicts[0]!.differs).toEqual(['words', 'named areas'])
    expect(problems[0]!.message).toBe(
      `the image "${inn.id}" has other words and other named areas in tts/act2/images.json`,
    )
  })
  it('is not a disagreement in another order, and uses the first act’s order', () => {
    const { images, problems } = rowsOf(withAreas, { ...inn, areas: [notice, fountain] })
    expect(problems).toEqual([])
    for (const act of images.acts) {
      expect(act.rows[0]!.areas.map((a) => a.id)).toEqual(['fountain', 'old-notice'])
    }
  })
})

describe('the boxes marked for named areas', () => {
  const size = { width: 320, height: 200 }
  const box = { x: 10, y: 20, width: 50, height: 40 }
  const fountain = () => ({ id: 'fountain', title: 'Fountain' })
  const notice = () => ({ id: 'old-notice', title: 'Old notice' })
  it('accepts a box inside the picture and refuses one outside or too small', () => {
    expect(checkAreaBox(box, size)).toBeNull()
    expect(checkAreaBox({ x: 0, y: 0, width: 320, height: 200 }, size)).toBeNull()
    expect(checkAreaBox({ x: 300, y: 0, width: 30, height: 10 }, size)).not.toBeNull()
    expect(checkAreaBox({ x: -1, y: 0, width: 30, height: 10 }, size)).not.toBeNull()
    expect(checkAreaBox({ x: 0, y: 0, width: 3, height: 10 }, size)).not.toBeNull()
    expect(checkAreaBox({ x: 0, y: 0, width: 10.5, height: 10 }, size)).not.toBeNull()
  })
  it('sets, replaces and clears a box, dropping what is left empty', () => {
    const one = applyAreaBox(none, 'inn', 'fountain', box)
    expect(one.images.inn?.areas).toEqual({ fountain: box })
    const moved = applyAreaBox(one, 'inn', 'fountain', { ...box, x: 11 })
    expect(moved.images.inn?.areas?.fountain?.x).toBe(11)
    expect(applyAreaBox(moved, 'inn', 'fountain', null)).toEqual(none)
  })
  it('keeps the other edits of the image when clearing', () => {
    const edits = applyAreaBox(
      applyWordsChange(none, 'inn', 'Mine', 'Game'),
      'inn',
      'fountain',
      box,
    )
    const cleared = applyAreaBox(edits, 'inn', 'fountain', null)
    expect(cleared.images.inn?.text).toBe('Mine')
    expect(cleared.images.inn?.areas).toBeUndefined()
  })
  it('is written by area id, with the box keys in a fixed order', () => {
    const edits = applyAreaBox(applyAreaBox(none, 'inn', 'z', box), 'inn', 'a', {
      height: 40,
      width: 50,
      y: 20,
      x: 10,
    })
    const text = formatImageEdits(edits)
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"z"'))
    expect(text).toContain('"x": 10')
    expect(text.indexOf('"x"')).toBeLessThan(text.indexOf('"width"'))
    expect(readImageEditsValue(JSON.parse(text), 'e').edits).toEqual(edits)
  })
  it('refuses a box that is not four whole numbers when reading', () => {
    const read = readImageEditsValue(
      { images: { inn: { areas: { fountain: { x: 1, y: 2, width: 'x', height: 4 } } } } },
      'e',
    )
    expect(read.problems.length).toBe(1)
  })
  const withBoxes = (areas: GameArea[], edits: ImageEdits) =>
    summarizeImages(
      input({
        lists: [
          {
            id: 'act1',
            title: 'Act I',
            file: 'tts/act1/images.json',
            state: { status: 'ok', images: [{ ...inn, areas }] },
            canRefresh: true,
          },
        ],
        edits: edits.images,
      }),
    ).images.acts[0]!.rows[0]!.areas
  it('shows a marked area as placed with its box', () => {
    const edits = applyAreaBox(none, inn.id, 'fountain', box)
    expect(withBoxes([fountain(), notice()], edits)).toEqual([
      { ...fountain(), placed: true, box },
      { ...notice(), placed: false, box: null },
    ])
  })
  it('keeps a box when the game stops asking for the area, and shows it if the id returns', () => {
    const edits = applyAreaBox(none, inn.id, 'fountain', box)
    expect(withBoxes([notice()], edits).map((a) => a.id)).toEqual(['old-notice'])
    expect(withBoxes([{ ...fountain(), title: 'Well' }], edits)[0]).toEqual({
      id: 'fountain',
      title: 'Well',
      placed: true,
      box,
    })
  })
})

describe('areas for the game', () => {
  const row = (
    id: string,
    box: { x: number; y: number; width: number; height: number } | null,
  ) => ({
    id,
    title: id,
    placed: box !== null,
    box,
  })
  const size = { width: 320, height: 200 }

  it('gives each placed area as fractions of the picture, and none when nothing is placed', () => {
    expect(
      areaFractions(
        [row('fountain', { x: 80, y: 50, width: 160, height: 100 }), row('gate', null)],
        size,
      ),
    ).toEqual({ fountain: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } })
    expect(areaFractions([row('gate', null)], size)).toBeUndefined()
  })

  it('rounds to six decimals', () => {
    const got = areaFractions([row('a', { x: 1, y: 1, width: 4, height: 4 })], {
      width: 3,
      height: 3,
    })
    expect(got?.a).toEqual({ x: 0.333333, y: 0.333333, width: 1.333333, height: 1.333333 })
  })

  it('sets or removes the areas of an entry, keeping its other fields in order', () => {
    const entry = { file: 'a.png', width: 320, height: 200, extra: 1 }
    const areas = { f: { x: 0, y: 0, width: 1, height: 1 } }
    const with_ = withAreas(entry, areas)
    expect(Object.keys(with_)).toEqual(['file', 'width', 'height', 'extra', 'areas'])
    expect(withAreas(with_, undefined)).toEqual(entry)
    expect('areas' in withAreas(with_, undefined)).toBe(false)
  })
})
