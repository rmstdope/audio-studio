import type { LanguageProgress } from '../../../services/workspace'
import { languageTab, movedTo } from '../../languages'

/**
 * The languages of a part, one tab each with how many of its lines are up to date. It wraps onto
 * more rows rather than becoming a menu, so every language's progress stays in view.
 */
export function LanguageSwitch({
  languages,
  progress,
  active,
  partTitle,
  onChoose,
}: {
  languages: { id: string; name: string }[]
  /** How far each language has come, once known. */
  progress: LanguageProgress[] | null
  active: string
  partTitle: string
  onChoose: (language: string) => void
}) {
  return (
    <div
      className="tabs language-switch"
      role="tablist"
      aria-label="Language"
      onKeyDown={(event) => {
        const next = movedTo(
          languages.map((l) => l.id),
          active,
          event.key,
        )
        if (!next) return
        event.preventDefault()
        onChoose(next)
        event.currentTarget.querySelector<HTMLElement>(`[data-language="${next}"]`)?.focus()
      }}
    >
      {languages.map((language) => {
        const known = progress?.find((p) => p.id === language.id)
        const { count, title, dimmed } = known
          ? languageTab(known, partTitle)
          : { count: null, title: undefined, dimmed: false }
        return (
          <button
            key={language.id}
            type="button"
            role="tab"
            lang={language.id}
            data-language={language.id}
            tabIndex={active === language.id ? 0 : -1}
            className={dimmed ? 'tab tab-dim' : 'tab'}
            aria-selected={active === language.id}
            title={title}
            onClick={() => onChoose(language.id)}
          >
            {language.name}
            {count !== null && <span className="mono tab-count">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}
