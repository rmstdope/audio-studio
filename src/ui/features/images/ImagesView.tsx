import type { ProjectSummary } from '../../../core/summary'
import { currentAct } from '../../imagesText'
import type { ImagesRoute } from '../../route'
import { ActPage } from './ActPage'
import { ConflictPage } from './ConflictPage'
import { ImagePage } from './ImagePage'
import { LookNotice } from './LookNotice'
import { NoImages } from './NoImages'
import { StyleNotice } from './StyleNotice'
import { StylePage } from './StylePage'

/** An Images page: an act's images, one image, or the Style page; how to set Images up when the project has none. */
export function ImagesView({ summary, route }: { summary: ProjectSummary; route: ImagesRoute }) {
  const { images } = summary
  if (!images) return <NoImages />
  const notice = images.styleNotice && <StyleNotice notice={images.styleNotice} />
  if (route.page === 'style') {
    return (
      <>
        {notice}
        <StylePage images={images} />
      </>
    )
  }
  const act = images.acts.find((a) => a.id === currentAct(images, route)) ?? images.acts[0]
  if (!act) return <NoImages />
  const row = route.page === 'image' ? act.rows.find((r) => r.id === route.image) : undefined
  const conflict =
    route.page === 'image' ? act.conflicts.find((c) => c.id === route.image) : undefined
  return (
    <>
      {notice}
      <LookNotice notice={images.lookNotice} />
      {conflict ? (
        <ConflictPage act={act} conflict={conflict} />
      ) : row ? (
        <ImagePage key={row.id} act={act} row={row} images={images} />
      ) : (
        <ActPage key={act.id} act={act} images={images} />
      )}
    </>
  )
}
