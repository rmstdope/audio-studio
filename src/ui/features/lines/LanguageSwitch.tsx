import { movedTo } from '../../languages'

/** One tab of the switch: a language, what it says beside the name, and its hover text. */
export interface LanguageTab {
  id: string
  name: string
  /** What the tab says beside the language (a line count, a casting state); null until known. */
  count: string | null
  title?: string
  dimmed: boolean
  /** Shown in amber: something needs attention in this language. */
  warn?: boolean
}

/**
 * The languages of a page, one tab each with how its language stands (a part's lines up to date,
 * a character's casting). It wraps onto more rows rather than becoming a menu, so every
 * language's state stays in view.
 */
export function LanguageSwitch({
  tabs,
  active,
  onChoose,
}: {
  tabs: LanguageTab[]
  active: string
  onChoose: (language: string) => void
}) {
  return (
    <div
      className="tabs language-switch"
      role="tablist"
      aria-label="Language"
      onKeyDown={(event) => {
        const next = movedTo(
          tabs.map((t) => t.id),
          active,
          event.key,
        )
        if (!next) return
        event.preventDefault()
        onChoose(next)
        event.currentTarget.querySelector<HTMLElement>(`[data-language="${next}"]`)?.focus()
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          lang={tab.id}
          data-language={tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          className={tab.dimmed ? 'tab tab-dim' : tab.warn ? 'tab tab-warn' : 'tab'}
          aria-selected={active === tab.id}
          title={tab.title}
          onClick={() => onChoose(tab.id)}
        >
          {tab.name}
          {tab.count !== null && <span className="mono tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}
