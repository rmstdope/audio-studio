import { describe, expect, it } from 'bun:test'
import { lookKey, lookOf } from './imageLook'
import {
  ChosenSchema,
  ImageEditsSchema,
  ImageListSchema,
  StyleSchema,
  applyActStyleChange,
  applyActStylePick,
  applyStyleChange,
  applyWordsChange,
  assemblePrompt,
  effectiveStyle,
  formatImageEdits,
  acceptableReasons,
  imagesDone,
  outOfDateReasons,
  resolveCompare,
  summarizeImages,
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
  it('reads the lock, with extra keys tolerated', () => {
    const lock = {
      images: { a: { chosen: { words: 'w', style: 's', width: 1, height: 2 }, takes: [] } },
    }
    expect(ChosenSchema.safeParse(lock).success).toBe(true)
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
    expect(applyStyleChange(styled, 'look', ' oil paint ')?.style).toEqual({
      ...style,
      look: 'oil paint',
    })
    expect(applyStyleChange(styled, 'keepOut', null)?.style?.keepOut).toBe('')
    expect(applyStyleChange(styled, 'look', ' ')).toBeNull()
    expect(applyStyleChange(none, 'look', 'oil paint')).toBeNull()
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
  it('is full colour when the game has no style file', () => {
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
