import { useEffect, useRef, type ReactNode } from 'react'

/**
 * A question asked in the page before acting: what will happen, and the ways on. It scrolls into
 * view when it opens out of sight, as the button that opened it may be far down the page.
 */
export function Confirm({
  title,
  effects,
  note,
  back = 'Back to the audition',
  onBack,
  children,
}: {
  title: string
  effects: string[]
  note?: string
  /** What the button that goes back without acting says. */
  back?: string
  onBack: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    // Only when its top is out of sight above (it opens above the button that opened it); one
    // already in view stays put. A statement, not the result: browsers may return a promise
    // from scrollIntoView, which React would take for a cleanup function.
    const element = panel.current
    if (element && element.getBoundingClientRect().top < 0)
      element.scrollIntoView({ block: 'start' })
  }, [])
  return (
    <section ref={panel} className="panel confirm" role="alertdialog" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="confirm-effects">
        {effects.map((effect) => (
          <li key={effect}>{effect}</li>
        ))}
      </ul>
      {note && <span className="muted">{note}</span>}
      <div className="confirm-actions">
        <button className="btn btn-ghost" type="button" onClick={onBack}>
          {back}
        </button>
        {children}
      </div>
    </section>
  )
}
