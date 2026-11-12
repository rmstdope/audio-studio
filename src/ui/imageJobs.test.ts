import { describe, expect, it } from 'bun:test'
import type { ImageRow } from '../core/images'
import type { PatchRow } from '../core/images'
import {
  imageJobTabs,
  jobAtKey,
  patchChosen,
  patchesHeading,
  patchLayoutOf,
  patchStateText,
} from './imageJobs'

/** An image row with only what the tabs read. */
function row(over: {
  chosenTake?: number | null
  patches?: { id: string; chosenOn: number[] }[]
  areas?: { id: string; placed: boolean }[]
}): ImageRow {
  return {
    chosenTake: over.chosenTake ?? null,
    patches: over.patches ?? [],
    areas: over.areas ?? [],
  } as unknown as ImageRow
}

const quiet = { makingTakes: false, newFineTunes: 0, makingFineTunes: false, makingPatches: false }

describe('imageJobTabs', () => {
  it('lists only Make and Fine-tune when the game asks for no patches or areas', () => {
    const tabs = imageJobTabs({ row: row({}), ...quiet })
    expect(tabs.map((t) => t.title)).toEqual(['Make', 'Fine-tune'])
  })

  it('lists all four in order when the game asks for patches and areas', () => {
    const tabs = imageJobTabs({
      row: row({
        patches: [{ id: 'p', chosenOn: [] }],
        areas: [{ id: 'a', placed: false }],
      }),
      ...quiet,
    })
    expect(tabs.map((t) => t.title)).toEqual(['Make', 'Fine-tune', 'Patches', 'Named areas'])
  })

  it('says which take is chosen, or that none is', () => {
    expect(imageJobTabs({ row: row({ chosenTake: 3 }), ...quiet })[0]!.chip).toEqual({
      text: 'Take 3 chosen',
      tone: 'ok',
    })
    expect(imageJobTabs({ row: row({}), ...quiet })[0]!.chip?.text).toBe('No take chosen')
  })

  it('counts the unseen fine-tunes, and has no chip without any', () => {
    expect(imageJobTabs({ row: row({}), ...quiet, newFineTunes: 2 })[1]!.chip).toEqual({
      text: '2 new',
      tone: 'accent',
    })
    expect(imageJobTabs({ row: row({}), ...quiet })[1]!.chip).toBeNull()
  })

  it('counts the patches chosen on the chosen take: amber until all, then green', () => {
    const patches = [
      { id: 'a', chosenOn: [3] },
      { id: 'b', chosenOn: [2] },
    ]
    expect(imageJobTabs({ row: row({ chosenTake: 3, patches }), ...quiet })[2]!.chip).toEqual({
      text: '1 of 2',
      tone: 'warn',
    })
    const all = patches.map((p) => ({ ...p, chosenOn: [3] }))
    expect(imageJobTabs({ row: row({ chosenTake: 3, patches: all }), ...quiet })[2]!.chip).toEqual({
      text: '2 of 2',
      tone: 'ok',
    })
  })

  it('counts the areas placed', () => {
    const areas = [
      { id: 'a', placed: true },
      { id: 'b', placed: false },
    ]
    const tabs = imageJobTabs({ row: row({ areas }), ...quiet })
    expect(tabs[2]!.chip).toEqual({ text: '1 of 2', tone: 'warn' })
  })

  it('marks the tabs whose work is running', () => {
    const tabs = imageJobTabs({
      row: row({ patches: [{ id: 'p', chosenOn: [] }] }),
      makingTakes: true,
      newFineTunes: 0,
      makingFineTunes: true,
      makingPatches: true,
    })
    expect(tabs.map((t) => t.making)).toEqual([true, true, true])
  })
})

describe('jobAtKey', () => {
  const tabs = imageJobTabs({ row: row({ areas: [{ id: 'a', placed: true }] }), ...quiet })
  it('follows the tabs shown', () => {
    expect(jobAtKey(tabs, '1')).toBe('make')
    expect(jobAtKey(tabs, '3')).toBe('areas')
    expect(jobAtKey(tabs, '4')).toBeNull()
    expect(jobAtKey(tabs, 'a')).toBeNull()
  })
})

describe('the Patches tab', () => {
  it('lays out a list beside a portrait image, chips above a landscape or square one', () => {
    expect(patchLayoutOf({ width: 600, height: 800 })).toBe('list')
    expect(patchLayoutOf({ width: 800, height: 600 })).toBe('chips')
    expect(patchLayoutOf({ width: 600, height: 600 })).toBe('chips')
  })

  it('counts a patch chosen when it is chosen on the image’s chosen take', () => {
    const patch = { id: 'a', chosenOn: [3] } as unknown as PatchRow
    expect(patchChosen(row({ chosenTake: 3 }), patch)).toBe(true)
    expect(patchChosen(row({ chosenTake: 2 }), patch)).toBe(false)
    expect(patchChosen(row({}), patch)).toBe(false)
  })

  it('heads the patches with how many are chosen', () => {
    const patches = [
      { id: 'a', chosenOn: [1] },
      { id: 'b', chosenOn: [] },
      { id: 'c', chosenOn: [1] },
    ]
    expect(patchesHeading(row({ chosenTake: 1, patches }))).toBe('Patches · 2 of 3 chosen')
  })

  it('says how far a patch has come', () => {
    expect(patchStateText([])).toBe('no takes yet')
    expect(patchStateText([{ n: 1, chosen: false }])).toBe('1 take')
    expect(
      patchStateText([
        { n: 1, chosen: false },
        { n: 2, chosen: false },
        { n: 3, chosen: false },
      ]),
    ).toBe('3 takes')
    expect(
      patchStateText([
        { n: 1, chosen: false },
        { n: 2, chosen: true },
      ]),
    ).toBe('Take 2 chosen')
  })
})
