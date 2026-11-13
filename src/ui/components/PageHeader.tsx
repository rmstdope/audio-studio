import type { ReactNode } from 'react'
import { Pager, type PagerProps } from './Pager'

/**
 * A page's header: the title block, the optional tabs (a language switch), and the buttons and the
 * previous/next control together at the right end, wrapping there when the window is narrow.
 * Every page that steps through a list builds its header with this, so they wrap alike.
 */
export function PageHeader({
  title,
  titleClass,
  tabs,
  actions,
  pager,
}: {
  title: ReactNode
  /** A class for the title block, where the page lays it out itself. */
  titleClass?: string
  tabs?: ReactNode
  actions?: ReactNode
  pager?: PagerProps | null
}) {
  return (
    <header className="page-header">
      <div className={titleClass}>{title}</div>
      {tabs}
      {(actions || pager) && (
        <div className="header-actions header-end">
          {actions}
          {pager && <Pager {...pager} />}
        </div>
      )}
    </header>
  )
}
