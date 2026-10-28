import { describe, expect, it } from 'bun:test'
import {
  boxState,
  creditsLabel,
  creditsMeterLine,
  creditsPoints,
  creditsUsedUpLine,
  creditsWaitLine,
  meterLine,
  planLeftLine,
  needsResumeBox,
  takeCaches,
  payLabel,
  resumePoints,
  startPoints,
  usedUpLine,
  waitingAfter,
} from './sitting'

const view = { model: 's2.1-pro', perTake: 0.002, suggested: 0.1 }

describe('meterLine and usedUpLine', () => {
  it('says what is used of what was given, and how many takes are left', () => {
    const money = { dollars: 0.1, spent: 0.03, left: 0.07, takesLeft: 35, usedUp: false }
    expect(meterLine(money)).toBe('$0.03 of $0.10 used · about 35 takes left')
    expect(meterLine({ ...money, takesLeft: 1 })).toBe('$0.03 of $0.10 used · about 1 take left')
  })
  it('says how many voices have no take yet', () => {
    expect(usedUpLine(0.1, 4)).toBe(
      'The $0.10 for this audition is used. 4 voices on the board have no take yet.',
    )
    expect(usedUpLine(0.1, 1)).toBe(
      'The $0.10 for this audition is used. 1 voice on the board has no take yet.',
    )
    expect(usedUpLine(0.1, 0)).toBe('The $0.10 for this audition is used.')
  })
})

describe('payLabel', () => {
  it('follows the amount typed, and is a bare "Pay up to …" for one that is not money', () => {
    expect(payLabel('0.1')).toBe('Pay up to $0.10')
    expect(payLabel('abc')).toBe('Pay up to …')
    expect(payLabel('0.25', true)).toBe('Pay up to $0.25 more')
    expect(payLabel('', true)).toBe('Pay up to … more')
  })
})

describe('boxState', () => {
  it('waits for the credit', () => {
    expect(boxState(undefined, view, '0.10')).toEqual({ kind: 'loading' })
  })
  it('cannot start when the credit cannot be read, or cannot pay for a take', () => {
    expect(boxState(null, view, '0.10')).toMatchObject({ kind: 'cant' })
    expect(boxState(0, view, '0.10')).toMatchObject({
      kind: 'cant',
      message: expect.stringContaining('Your Fish credit is $0.00'),
    })
  })
  it('lets a valid amount be paid, and shows the credit', () => {
    expect(boxState(4.82, view, '0.10')).toEqual({
      kind: 'ask',
      credit: 4.82,
      amount: 0.1,
      problem: null,
      canPay: true,
    })
  })
  it('refuses an amount over the credit or not a sum, with the line for it', () => {
    expect(boxState(4.82, view, '5')).toMatchObject({
      canPay: false,
      problem: 'That is more than your credit of $4.82.',
    })
    expect(boxState(4.82, view, '')).toMatchObject({
      canPay: false,
      amount: null,
      problem: 'Enter an amount in dollars, like 0.10.',
    })
  })
})

describe('the points of a box', () => {
  it('start: model, cost of a take, how far the amount goes, and that takes record by themselves', () => {
    expect(startPoints('s2.1-pro', 0.002, 0.1)).toEqual([
      'Takes are recorded with s2.1-pro, the model the game ships with, and charged to your Fish account.',
      'A take costs about $0.002. $0.10 is enough for about 50 voices.',
      'Takes record by themselves until this is used; then the audition asks before spending more.',
    ])
  })
  it('resume: recorded takes are free, new ones are charged', () => {
    expect(resumePoints(0.002)).toEqual([
      'Takes already recorded play without charge.',
      'New takes are charged to your Fish account, about $0.002 each.',
    ])
  })
})

describe('waitingAfter', () => {
  it('adds a voice whose take waits, and drops one that has a take or failed', () => {
    const waiting = new Set(['a'])
    expect(waitingAfter(waiting, 'b', 'waits')).toEqual(new Set(['a', 'b']))
    expect(waitingAfter(waiting, 'a', 'recorded')).toEqual(new Set())
    expect(waitingAfter(waiting, 'a', 'failed')).toEqual(new Set())
  })
})

describe('needsResumeBox', () => {
  const money = { dollars: 0.1, spent: 0, left: 0.1, takesLeft: 50, usedUp: false }
  it('asks on a paid model with no sitting, or one that is used up; never with money', () => {
    expect(needsResumeBox({ paid: true, sitting: null })).toBe(true)
    expect(needsResumeBox({ paid: true, sitting: { ...money, usedUp: true } })).toBe(true)
    expect(needsResumeBox({ paid: true, sitting: money })).toBe(false)
    expect(needsResumeBox({ paid: false, sitting: null })).toBe(false)
    expect(needsResumeBox(null)).toBe(false)
  })
})

describe('takeCaches', () => {
  it('keeps board takes and the cast voice’s page takes apart, whatever the model', () => {
    expect(takeCaches(true)).toEqual({ voice: false, session: true })
    expect(takeCaches(false)).toEqual({ voice: true, session: false })
  })
})

describe('the words of an audition’s credits', () => {
  const money = { dollars: 2100, spent: 420, left: 1680, takesLeft: 40, usedUp: false }

  it('meter: what is used of what was given, and how many takes are left', () => {
    expect(creditsMeterLine(money)).toBe('420 of 2,100 credits used · about 40 takes left')
  })

  it('used up: the credits are used, and how many voices wait', () => {
    expect(creditsUsedUpLine(2100, 2)).toBe(
      'The 2,100 credits for this audition are used. 2 voices on the board have no take yet.',
    )
    expect(creditsUsedUpLine(100, 0)).toBe('The 100 credits for this audition are used.')
  })

  it('the bar: how many ElevenLabs voices wait for credits', () => {
    expect(creditsWaitLine(1)).toBe('1 ElevenLabs voice on the board waits for credits')
    expect(creditsWaitLine(2)).toBe('2 ElevenLabs voices on the board wait for credits')
  })

  it('the bar’s points: a take’s credits on the model, and that recorded and failed takes are free', () => {
    expect(creditsPoints('eleven_v3', 42)).toEqual([
      'A take with Eleven v3 is about 42 credits, charged to your plan as it is sent.',
      'A take already recorded is free; one that fails is given back.',
    ])
  })

  it('the button follows the credits typed', () => {
    expect(creditsLabel('2100')).toBe('Use up to 2,100 credits')
    expect(creditsLabel('2,100')).toBe('Use up to 2,100 credits')
    expect(creditsLabel('1.5')).toBe('Use up to … credits')
    expect(creditsLabel('500', true)).toBe('Use up to 500 more credits')
  })

  it('what is left on the plan, beside what running recordings and auditions hold', () => {
    const account = {
      tier: 'creator',
      charactersUsed: 1000,
      characterLimit: 50_000,
      renewsAt: null,
      overage: 0 as const,
      voiceSlots: { used: 0, limit: 30 },
    }
    expect(planLeftLine({ ok: true, account }, 0)).toBe('49,000 credits left on your plan')
    expect(planLeftLine({ ok: true, account }, 800)).toBe(
      '48,200 credits left on your plan, besides what recordings and auditions running now hold',
    )
    expect(planLeftLine({ ok: false, reason: 'elevenlabs', message: 'Down.' }, 0)).toBe(
      'What is left on your plan is unknown: Down.',
    )
    expect(planLeftLine(undefined, 0)).toBe('Reading your plan…')
  })
})
