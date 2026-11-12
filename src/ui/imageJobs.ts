import type { ImageRow } from '../core/images'

/** The jobs of an image's page, one tab each. */
export type ImageJob = 'make' | 'fine-tune' | 'patches' | 'areas'

/** One tab of an image's page: its job, its name, its chip and whether work is running in it. */
export interface JobTab {
  job: ImageJob
  title: string
  chip: { text: string; tone: 'ok' | 'warn' | 'accent' } | null
  making: boolean
}

/** What the tabs say, read from the row and the image's running work. */
export interface JobTabsInput {
  row: ImageRow
  makingTakes: boolean
  newFineTunes: number
  makingFineTunes: boolean
  makingPatches: boolean
}

/** The tabs an image's page shows, in order; a job the game does not ask for has none. */
export function imageJobTabs(input: JobTabsInput): JobTab[] {
  const { row } = input
  const tabs: JobTab[] = [
    {
      job: 'make',
      title: 'Make',
      chip:
        row.chosenTake === null
          ? { text: 'No take chosen', tone: 'warn' }
          : { text: `Take ${row.chosenTake} chosen`, tone: 'ok' },
      making: input.makingTakes,
    },
    {
      job: 'fine-tune',
      title: 'Fine-tune',
      chip: input.newFineTunes > 0 ? { text: `${input.newFineTunes} new`, tone: 'accent' } : null,
      making: input.makingFineTunes,
    },
  ]
  if (row.patches.length > 0) {
    const chosen = row.patches.filter(
      (p) => row.chosenTake !== null && p.chosenOn.includes(row.chosenTake),
    ).length
    tabs.push({
      job: 'patches',
      title: 'Patches',
      chip: {
        text: `${chosen} of ${row.patches.length}`,
        tone: chosen === row.patches.length ? 'ok' : 'warn',
      },
      making: input.makingPatches,
    })
  }
  if (row.areas.length > 0) {
    const placed = row.areas.filter((a) => a.placed).length
    tabs.push({
      job: 'areas',
      title: 'Named areas',
      chip: {
        text: `${placed} of ${row.areas.length}`,
        tone: placed === row.areas.length ? 'ok' : 'warn',
      },
      making: false,
    })
  }
  return tabs
}

/** The job a number key opens among the tabs shown (1 is the first tab); null for any other key. */
export function jobAtKey(tabs: JobTab[], key: string): ImageJob | null {
  return /^[1-9]$/.test(key) ? (tabs[Number(key) - 1]?.job ?? null) : null
}
