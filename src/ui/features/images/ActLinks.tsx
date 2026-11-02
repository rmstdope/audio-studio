import { shortTitle } from '../../format'
import { listSeparator } from '../../imagesText'
import { routeHref } from '../../route'

/** Acts named as "Act I, Act III and Act V", each a link to that act's list of images. */
export function ActLinks({ acts }: { acts: { id: string; title: string }[] }) {
  return (
    <>
      {acts.map((act, i) => (
        <span key={act.id}>
          {listSeparator(i, acts.length)}
          <a href={routeHref({ view: 'images', page: 'act', part: act.id })}>
            {shortTitle(act.title)}
          </a>
        </span>
      ))}
    </>
  )
}
