import type { CSSProperties } from 'react'
import { attentionText } from '../status'

/**
 * The lead count at the top of a list's page, "Lines up to date 620 / 624", beside a ring filled to
 * the share done (rounded down, so it is full only when all are): while some need attention it says
 * how many and is a link to them (`href`).
 */
export function DoneStat({
  label,
  done,
  total,
  href,
}: {
  label: string
  done: number
  total: number
  href: string
}) {
  const left = total - done
  const share = total ? Math.floor((done / total) * 100) : 0
  const body = (
    <>
      <i
        className="done-ring"
        aria-hidden="true"
        style={{ '--done': `${share}%` } as CSSProperties}
      >
        {total ? `${share}%` : '—'}
      </i>
      <span>{label}</span>
      <strong>
        {done}
        <span className="stat-of"> / {total}</span>
      </strong>
      {left > 0 && <span className="stat-more">{attentionText(left)} ›</span>}
    </>
  )
  return left > 0 ? (
    <a className="stat stat-lead stat-link" href={href}>
      {body}
    </a>
  ) : (
    <div className="stat stat-lead">{body}</div>
  )
}
