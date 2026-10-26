import { describe, expect, it } from 'bun:test'
import {
  busyWords,
  changeOf,
  failureHeading,
  menuLabel,
  modelOptions,
  priceWords,
  questionWords,
  SAME_AS_DRAFT,
  STAGES,
} from './models'

const before = new Date('2026-10-25T12:00:00Z')
const after = new Date('2026-11-13T12:00:00Z')

describe('STAGES', () => {
  it('names the three stages and what each is for, in order', () => {
    expect(STAGES).toEqual([
      {
        stage: 'audition',
        name: 'Audition',
        purpose: 'Takes of voices you are trying for a character.',
      },
      {
        stage: 'draft',
        name: 'Draft',
        purpose: 'Every line, recorded while the game is being written.',
      },
      { stage: 'final', name: 'Final', purpose: 'Every line again, for the game you ship.' },
    ])
  })
})

describe('menuLabel', () => {
  it('gives the price in short', () => {
    expect(menuLabel('s2.1-pro-free', before)).toBe('Free')
    expect(menuLabel('s2.1-pro', before)).toBe('$15')
    expect(menuLabel('drama-3', before)).toBe('$10 until 12 Nov')
    expect(menuLabel('drama-3', after)).toBe('$50')
    expect(menuLabel('s1', before)).toBe('$15 · retires 31 December')
    expect(menuLabel('mystery', before)).toBe('price unknown')
  })
})

describe('modelOptions', () => {
  it('offers every priced model but s1, to every stage', () => {
    const options = modelOptions('draft', 's2.1-pro-free', before)
    expect(options.map((o) => o.model)).toEqual(['s2.1-pro-free', 's2.1-pro', 's2-pro', 'drama-3'])
    expect(options.every((o) => !o.apart)).toBe(true)
  })

  it('offers s1 last and set apart to a stage still on it', () => {
    const options = modelOptions('final', 's1', before)
    expect(options.at(-1)).toEqual({ model: 's1', label: '$15 · retires 31 December', apart: true })
    expect(options).toHaveLength(5)
  })

  it('keeps showing a model it has no price for, so a hand edit is not hidden', () => {
    const options = modelOptions('audition', 'mystery', before)
    expect(options[0]).toEqual({ model: 'mystery', label: 'price unknown', apart: false })
  })
})

describe('priceWords', () => {
  const dialog = { lines: 2340, bytes: 118_000 }
  it('never writes "about under" for a tiny project total', () => {
    const words = priceWords('s2.1-pro', before, { lines: 1, bytes: 40 })
    expect(words).toBe('$15 per million characters · under $0.01 for all 1 line')
  })
  it('says Free for a free model, with no total', () => {
    expect(priceWords('s2.1-pro-free', before, dialog)).toBe('Free')
  })
  it('gives the rate and the project total', () => {
    expect(priceWords('s2.1-pro', before, dialog)).toBe(
      '$15 per million characters · about $1.77 for all 2,340 lines',
    )
  })
  it('gives a promotion, when it ends, and both totals', () => {
    expect(priceWords('drama-3', before, dialog)).toBe(
      '$10 per million characters until 12 November, then $50 · about $1.18 for all 2,340 lines ($5.90 from 12 November)',
    )
  })
  it('shows only the list price once the promotion ended', () => {
    expect(priceWords('drama-3', after, dialog)).toBe(
      '$50 per million characters · about $5.90 for all 2,340 lines',
    )
  })
  it('gives only the rate with no lines yet', () => {
    expect(priceWords('s2.1-pro', before, { lines: 0, bytes: 0 })).toBe(
      '$15 per million characters',
    )
  })
  it('says s1 retires', () => {
    expect(priceWords('s1', before, dialog)).toBe(
      '$15 per million characters · retires 31 December · about $1.77 for all 2,340 lines',
    )
  })
  it('uses the singular for one line', () => {
    expect(priceWords('s2.1-pro', before, { lines: 1, bytes: 100_000 })).toBe(
      '$15 per million characters · about $1.50 for all 1 line',
    )
  })
  it('says when the price is unknown', () => {
    expect(priceWords('mystery', before, dialog)).toBe('The studio has no price for this model.')
  })
})

describe('changeOf', () => {
  const recorded = {
    's2.1-pro-free': { lines: 1412, bytes: 71_400 },
    's2.1-pro': { lines: 640, bytes: 21_333 },
    s1: { lines: 10, bytes: 400 },
  }
  const models = { audition: 's2.1-pro-free', draft: 's2.1-pro-free', final: 'drama-3' }

  it('saves an audition change at once, whatever is recorded', () => {
    expect(changeOf('audition', 's2.1-pro', models, recorded, before)).toEqual({ kind: 'save' })
  })

  it('saves a change at once when nothing recorded with the old model', () => {
    const m = { ...models, draft: 'drama-3' }
    expect(changeOf('draft', 's2.1-pro', m, recorded, before)).toEqual({ kind: 'save' })
  })

  it('asks when lines recorded with the old draft model go out of date', () => {
    const change = changeOf('draft', 's2.1-pro', models, recorded, before)
    expect(change).toMatchObject({ kind: 'ask', lines: 1412, cost: { later: null } })
    expect(change.kind === 'ask' && change.cost.now).toBeCloseTo(1.071, 6)
  })

  it('does not ask when the old model is still in use by the other stage', () => {
    const alike = { ...models, final: 's2.1-pro-free' }
    // The free lines are then the final recording: still in date.
    expect(changeOf('draft', 's2.1-pro', alike, recorded, before)).toEqual({ kind: 'save' })
    const same = { audition: 'a', draft: 's2.1-pro', final: 's2.1-pro' }
    // Moving draft away leaves those lines as the final recording: still in date.
    expect(changeOf('draft', 'drama-3', same, recorded, before)).toEqual({ kind: 'save' })
    // Moving final away leaves them as the draft recording: still in date.
    expect(changeOf('final', 'drama-3', same, recorded, before)).toEqual({ kind: 'save' })
  })

  it('saves s1 to s2.1-pro at once: Fish serves them as one', () => {
    const m = { audition: 'a', draft: 's1', final: 's1' }
    expect(changeOf('draft', 's2.1-pro', m, recorded, before)).toEqual({ kind: 'save' })
  })

  it('gives both prices of a promotion, and says free for a free model', () => {
    const m = { ...models, draft: 's2.1-pro', final: 's2.1-pro' }
    const rec = { 's2.1-pro': { lines: 640, bytes: 32_000 } }
    const promo = changeOf('final', 'drama-3', { ...m, draft: 's2-pro' }, rec, before)
    expect(promo).toMatchObject({ kind: 'ask', lines: 640 })
    expect(promo.kind === 'ask' && promo.cost.now).toBeCloseTo(0.32, 6)
    expect(promo.kind === 'ask' && promo.cost.later).toBeCloseTo(1.6, 6)
    expect(changeOf('final', 's2.1-pro-free', { ...m, draft: 's2-pro' }, rec, before)).toEqual({
      kind: 'ask',
      lines: 640,
      cost: { now: 0, later: null },
    })
  })

  it('does nothing when the model is already chosen', () => {
    expect(changeOf('draft', 's2.1-pro-free', models, recorded, before)).toEqual({ kind: 'none' })
  })
})

describe('questionWords', () => {
  it('words a draft change', () => {
    expect(
      questionWords(
        'draft',
        's2.1-pro-free',
        's2.1-pro',
        { lines: 1412, cost: { now: 1.071, later: null } },
        'audio-studio.json',
        before,
      ),
    ).toEqual({
      heading: 'Switch drafts to s2.1-pro?',
      items: [
        'Draft: s2.1-pro-free → s2.1-pro',
        '1,412 lines drafted with s2.1-pro-free become out of date: the next draft records them again, about $1.07.',
        'Saved in audio-studio.json; nothing else in it changes.',
      ],
      keep: 'Keep s2.1-pro-free',
      confirm: 'Switch to s2.1-pro',
    })
  })

  it('never writes "about under" for a cost below a cent', () => {
    const words = questionWords(
      'final',
      's2.1-pro',
      'drama-3',
      { lines: 1, cost: { now: 0.0004, later: 0.002 } },
      'audio-studio.json',
      before,
    )
    expect(words.items[1]).toBe(
      '1 line recorded for the final with s2.1-pro becomes out of date: the next final recording records it again, under $0.01 (under $0.01 from 12 November).',
    )
    expect(words.items[1]).not.toContain('about under')
  })

  it('words a final change with a promotion', () => {
    const words = questionWords(
      'final',
      's2.1-pro',
      'drama-3',
      { lines: 640, cost: { now: 0.32, later: 1.6 } },
      'audio-studio.json',
      before,
    )
    expect(words.heading).toBe('Switch the final recording to drama-3?')
    expect(words.items[0]).toBe('Final: s2.1-pro → drama-3')
    expect(words.items[1]).toBe(
      '640 lines recorded for the final with s2.1-pro become out of date: the next final recording records them again, about $0.32 (about $1.60 from 12 November).',
    )
  })

  it('says free, and uses the singular', () => {
    const words = questionWords(
      'draft',
      's2.1-pro',
      's2.1-pro-free',
      { lines: 1, cost: { now: 0, later: null } },
      'audio-studio.json',
      before,
    )
    expect(words.items[1]).toBe(
      '1 line drafted with s2.1-pro becomes out of date: the next draft records it again, free.',
    )
  })
})

describe('failureHeading', () => {
  it('names the stage', () => {
    expect(failureHeading('draft', 's2.1-pro')).toBe('Could not switch drafts to s2.1-pro')
    expect(failureHeading('final', 'drama-3')).toBe(
      'Could not switch the final recording to drama-3',
    )
    expect(failureHeading('audition', 's2.1-pro')).toBe('Could not switch auditions to s2.1-pro')
  })
})

describe('busyWords and SAME_AS_DRAFT', () => {
  it('names what is going on', () => {
    expect(busyWords({ kind: 'recording', name: 'Act II: The Mill' })).toBe(
      'Act II: The Mill is recording. The models can be changed when it ends.',
    )
    expect(busyWords({ kind: 'auditioning', name: 'Mira' })).toBe(
      'Mira is auditioning. The models can be changed when it ends.',
    )
    expect(SAME_AS_DRAFT).toBe(
      'Same as draft: every line is recorded once, with no separate final recording.',
    )
  })
})
