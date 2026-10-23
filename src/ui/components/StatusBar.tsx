import type { LineStatus } from '../../core/planner'
import { STATUS } from '../status'

/** A bar split by how many lines have each status. */
export function StatusBar({
  counts,
  height = 8,
}: {
  counts: Partial<Record<LineStatus, number>>
  height?: number
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0)
  return (
    <div className="status-bar" style={{ height }} aria-hidden="true">
      {total > 0 &&
        (Object.keys(STATUS) as LineStatus[]).map((status) => {
          const count = counts[status] ?? 0
          return count ? (
            <span
              key={status}
              style={{ width: `${(count / total) * 100}%`, background: STATUS[status].color }}
            />
          ) : null
        })}
    </div>
  )
}

/** A status as a coloured pill. */
export function StatusPill({ status }: { status: LineStatus }) {
  const { label, color, bg } = STATUS[status]
  return (
    <span className="pill" style={{ color, background: bg }}>
      <span className="pill-dot" />
      {label}
    </span>
  )
}

/** A status as a small coloured square, for legends. */
export function StatusDot({ status }: { status: LineStatus }) {
  return <span className="dot" style={{ background: STATUS[status].color }} />
}
