import type { ImageConflict, ImagesAct } from '../../../core/images'
import { shortTitle } from '../../format'
import { disagreeText } from '../../imagesText'
import { routeHref } from '../../route'

/** The page of an image the acts' lists disagree about: only the reason, nothing to edit. */
export function ConflictPage({ act, conflict }: { act: ImagesAct; conflict: ImageConflict }) {
  return (
    <>
      <header className="page-header">
        <div>
          <span className="crumbs">
            <a href={routeHref({ view: 'images', page: null })}>Images</a> ›{' '}
            <a href={routeHref({ view: 'images', page: 'act', part: act.id })}>
              {shortTitle(act.title)}
            </a>
          </span>
          <h1 tabIndex={-1}>{conflict.title}</h1>
          <span className="mono muted">{conflict.id}</span>
        </div>
      </header>
      <section className="notice notice-err">
        <div className="notice-text">
          <strong>
            {disagreeText(
              conflict.acts.map((a) => shortTitle(a.title)),
              conflict.differs,
            )}
          </strong>
        </div>
      </section>
    </>
  )
}
