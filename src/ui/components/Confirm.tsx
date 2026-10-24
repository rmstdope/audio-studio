import type { ReactNode } from 'react'

/** A question asked in the page before acting: what will happen, and the ways on. */
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
  return (
    <section className="panel confirm" role="alertdialog" aria-label={title}>
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
