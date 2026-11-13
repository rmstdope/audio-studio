import type { ImageRow, PatchRow } from '../core/images'
import { IMAGE_STATUS_LABEL } from './imagesText'

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
  /** The image's own takes or patches, read after the list, found the images lock unreadable. */
  lockUnread?: boolean
}

/** The tabs an image's page shows, in order; a job the game does not ask for has none. */
export function imageJobTabs(input: JobTabsInput): JobTab[] {
  const { row } = input
  // The lock cannot be read: which take the game shows is not known, so Make and Patches say so.
  // The list may be older than the image's own views (kept across the pager), so either says it.
  const unknown = row.status === 'unknown' || input.lockUnread === true
  const notKnown = { text: IMAGE_STATUS_LABEL.unknown, tone: 'warn' } as const
  const tabs: JobTab[] = [
    {
      job: 'make',
      title: 'Make',
      chip: unknown
        ? notKnown
        : row.chosenTake === null
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
    const chosen = row.patches.filter((p) => patchChosen(row, p)).length
    tabs.push({
      job: 'patches',
      title: 'Patches',
      chip: unknown
        ? notKnown
        : {
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

/** Whether the patch is chosen on the image's chosen take, the take the game shows. */
export function patchChosen(row: ImageRow, patch: PatchRow): boolean {
  return row.chosenTake !== null && patch.chosenOn.includes(row.chosenTake)
}

/**
 * The heading over the patches: how many are chosen of those the game asks for, or, while the
 * images lock cannot be read, only how many the game asks for.
 */
export function patchesHeading(row: ImageRow, lockUnread = false): string {
  if (lockUnread) return `Patches · ${row.patches.length}`
  const chosen = row.patches.filter((p) => patchChosen(row, p)).length
  return `Patches · ${chosen} of ${row.patches.length} chosen`
}

/** How the Patches tab lays out: a list beside a portrait image, chips above any other. */
export function patchLayoutOf(size: { width: number; height: number }): 'list' | 'chips' {
  return size.height > size.width ? 'list' : 'chips'
}

/** What a patch says of how far it has come: its chosen take, or how many takes there are. */
export function patchStateText(takes: readonly { n: number; chosen: boolean }[]): string {
  const chosen = takes.find((t) => t.chosen)
  if (chosen) return `Take ${chosen.n} chosen`
  if (takes.length === 0) return 'no takes yet'
  return `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`
}
