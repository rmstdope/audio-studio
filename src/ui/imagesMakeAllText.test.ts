import { describe, expect, it } from 'bun:test'
import {
  busyLine,
  chosenLine,
  disagreeLine,
  nothingToMakeDisagreeLine,
  makeAllHeading,
  makeAllLine,
  readyLine,
  runningLine,
  summaryFailed,
  summaryLead,
  summaryStopped,
} from './imagesMakeAllText'

describe('the words of make-all on the Images page', () => {
  it('counts the images', () => {
    expect(readyLine(3)).toBe('3 images have no chosen take')
    expect(readyLine(1)).toBe('1 image has no chosen take')
    expect(makeAllHeading(12, 3)).toBe('Make 12 takes for 3 images?')
    expect(makeAllHeading(4, 1)).toBe('Make 4 takes for 1 image?')
  })

  it('says the model and the time, rounded up to whole minutes', () => {
    expect(
      makeAllLine({
        model: 'FLUX.2 klein',
        main: 'FLUX.2 klein',
        why: null,
        seconds: 96,
        guess: false,
      }),
    ).toBe(
      'Four takes each, on FLUX.2 klein, the image model on Setup. About 2 min in all — they are made one after another, and you can leave the page.',
    )
    expect(
      makeAllLine({
        model: 'Z-Image-Turbo',
        main: 'FLUX.2 klein',
        why: 'absent',
        seconds: 720,
        guess: false,
      }),
    ).toBe(
      "Four takes each, on Z-Image-Turbo: FLUX.2 klein, the image model on Setup, isn't on this computer. About 12 min in all — they are made one after another, and you can leave the page.",
    )
    expect(
      makeAllLine({
        model: 'Z-Image-Turbo',
        main: 'FLUX.2 klein',
        why: 'partial',
        seconds: 720,
        guess: false,
      }),
    ).toContain('is only partly downloaded. About 12 min')
    expect(
      makeAllLine({
        model: 'Z-Image-Turbo',
        main: 'FLUX.2 klein',
        why: 'failed',
        seconds: 720,
        guess: false,
      }),
    ).toContain('failed on its last take. About 12 min')
    expect(
      makeAllLine({
        model: 'FLUX.2 klein',
        main: 'FLUX.2 klein',
        why: null,
        seconds: 8,
        guess: false,
      }),
    ).toContain('About 10 s in all')
  })

  it('leads an untimed model\'s time with "A guess:"', () => {
    expect(
      makeAllLine({
        model: 'FLUX.2 klein 4B',
        main: 'FLUX.2 klein 4B',
        why: null,
        seconds: 720,
        guess: true,
      }),
    ).toBe(
      'Four takes each, on FLUX.2 klein 4B, the image model on Setup. A guess: about 12 min in all — they are made one after another, and you can leave the page.',
    )
    expect(
      makeAllLine({
        model: 'FLUX.2 klein 4B',
        main: 'FLUX.2 klein 4B',
        why: null,
        seconds: 40,
        guess: true,
      }),
    ).toContain('A guess: about 40 s in all')
    expect(
      makeAllLine({
        model: 'FLUX.2 klein 4B',
        main: 'FLUX.2 klein 4B',
        why: null,
        seconds: 40,
        guess: false,
      }),
    ).toContain('About 40 s in all')
  })

  it('reads a wait of an hour or more in hours and minutes', () => {
    const line = (seconds: number) =>
      makeAllLine({ model: 'Qwen-Image', main: 'Qwen-Image', why: null, seconds, guess: false })
    expect(line(59 * 60)).toContain('About 59 min in all')
    expect(line(60 * 60)).toContain('About 1 h in all')
    expect(line(61 * 60 - 30)).toContain('About 1 h 1 min in all')
    expect(line(144 * 60)).toBe(
      'Four takes each, on Qwen-Image, the image model on Setup. About 2 h 24 min in all — they are made one after another, and you can leave the page.',
    )
    expect(line(120 * 60)).toContain('About 2 h in all')
    expect(runningLine({ takes: 48, images: 12, left: 144 * 60 })).toBe(
      'Making 48 takes for 12 images · about 2 h 24 min left',
    )
    expect(runningLine({ takes: 4, images: 1, left: 120 * 60 })).toContain('about 2 h left')
    expect(runningLine({ takes: 4, images: 1, left: 45 * 60 })).toContain('about 45 min left')
  })

  it('names the images left out, one reason a line', () => {
    expect(chosenLine(['Fish market', "Captain's cabin"])).toBe(
      "Fish market and Captain's cabin have a chosen take and get none.",
    )
    expect(chosenLine(['A'])).toBe('A has a chosen take and gets none.')
    expect(busyLine(['Cave entrance'])).toBe('Cave entrance is already making takes and gets none.')
    expect(busyLine(['A', 'B', 'C'])).toBe('A, B and C are already making takes and get none.')
    expect(disagreeLine(["Smugglers' cave"])).toBe(
      "Smugglers' cave gets none: the game's lists disagree about it.",
    )
    expect(disagreeLine(['A', 'B'])).toBe("A and B get none: the game's lists disagree about them.")
    expect(nothingToMakeDisagreeLine(['A'])).toBe(
      "No takes can be made for A: the game's lists disagree about it.",
    )
    expect(nothingToMakeDisagreeLine(['A', 'B'])).toBe(
      "No takes can be made for A and B: the game's lists disagree about them.",
    )
  })

  it('says what is being made and how it ended', () => {
    expect(runningLine({ takes: 12, images: 3, left: 100 })).toBe(
      'Making 12 takes for 3 images · about 2 min left',
    )
    expect(runningLine({ takes: 4, images: 1, left: 11 })).toBe(
      'Making 4 takes for 1 image · about 15 s left',
    )
    expect(summaryLead(12, 12)).toBe('Made 12 of 12 takes.')
    expect(summaryFailed(2, ['Lighthouse'])).toEqual({
      before: '2 could not be made — ',
      after: ' says why.',
    })
    expect(summaryFailed(3, ['A', 'B']).after).toBe(' say why.')
    expect(summaryStopped(7)).toBe('7 were stopped.')
    expect(summaryStopped(1)).toBe('1 was stopped.')
  })
})
