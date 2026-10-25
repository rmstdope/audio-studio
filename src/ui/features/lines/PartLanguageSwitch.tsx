import { useRef } from 'react'
import type { PartSummary, ProjectSummary } from '../../../core/summary'
import type { LanguageProgress } from '../../../services/workspace'
import { shortTitle } from '../../format'
import { languageTab } from '../../languages'
import { LanguageSwitch } from './LanguageSwitch'

/**
 * The language switch of a part's pages (its overview and its lines): a tab per declared language
 * with how many of the part's lines are up to date in it. The counts last seen stay while another
 * language loads, so the switch does not blink.
 */
export function PartLanguageSwitch({
  summary,
  part,
  active,
  progress,
  onChoose,
}: {
  summary: ProjectSummary
  part: PartSummary
  /** The language shown. */
  active: string
  /** How far each language has come, once the part is loaded. */
  progress: LanguageProgress[] | null
  onChoose: (language: string) => void
}) {
  const seen = useRef<LanguageProgress[] | null>(null)
  if (progress) seen.current = progress
  return (
    <LanguageSwitch
      tabs={summary.languages.map((language) => {
        const known = seen.current?.find((p) => p.id === language.id)
        const tab = known ? languageTab(known, shortTitle(part.title)) : null
        return {
          id: language.id,
          name: language.name,
          count: tab?.count ?? null,
          title: tab?.title,
          dimmed: tab?.dimmed ?? false,
        }
      })}
      active={active}
      onChoose={onChoose}
    />
  )
}
