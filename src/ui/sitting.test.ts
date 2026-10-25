import { describe, expect, it } from 'bun:test'
import {
  boxState,
  meterLine,
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
  it('keeps board takes and page takes apart on a paid model', () => {
    expect(takeCaches(true, true)).toEqual({ voice: false, session: true })
    expect(takeCaches(false, true)).toEqual({ voice: true, session: false })
  })
  it('feeds both when the model is free, as the takes are the same', () => {
    expect(takeCaches(true, false)).toEqual({ voice: true, session: true })
    expect(takeCaches(false, false)).toEqual({ voice: true, session: true })
  })
})
