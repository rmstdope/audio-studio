import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ImagesSummary } from '../../../core/images'
import { useBringAll, useLookRun } from '../../api'
import { bringFailureText, bringingText, lookNoticeText } from '../../imagesText'

/**
 * The one notice above an act's images when the game's look changed: one button brings every take
 * and chosen image to it from the model's stored pictures. While it runs it counts, and it carries
 * on across a reload; images it could not bring are named, with Try again.
 */
export function LookNotice({ notice }: { notice: ImagesSummary['lookNotice'] }) {
  const run = useLookRun().data ?? null
  const bring = useBringAll()
  const client = useQueryClient()
  // Images already brought lose their tag as they finish.
  useEffect(() => {
    if (run) void client.invalidateQueries({ queryKey: ['project'] })
  }, [run?.done, run?.running, client])

  if (run?.running) {
    return (
      <section
        className="notice notice-warn"
        aria-label="Bringing images to the new look"
        role="status"
      >
        <div className="notice-text">
          <span>{bringingText(run.done, run.total)}</span>
        </div>
      </section>
    )
  }
  // A failure is shown while something still has the old look; once nothing does it is moot.
  if (run && run.failed.length && notice) {
    const text = bringFailureText(run.total, run.failed)
    return (
      <section className="notice notice-err" aria-label="Some images could not be brought">
        <div className="notice-text">
          <span>
            <strong>{text.head}</strong> {text.rest}
          </span>
        </div>
        <div className="notice-actions">
          <button
            className="btn"
            type="button"
            disabled={bring.isPending}
            onClick={() => bring.mutate()}
          >
            Try again
          </button>
          {bring.isError && <span className="adopt-error">{bring.error.message}</span>}
        </div>
      </section>
    )
  }
  if (!notice) return null
  const text = lookNoticeText(notice.count, notice.changed)
  const refused =
    bring.data && !bring.data.ok && 'message' in bring.data ? bring.data.message : null
  return (
    <section className="notice notice-warn" aria-label="The game's look changed">
      <div className="notice-text">
        <span>
          <strong>{text.head}</strong>
          {text.what}. {text.rest}
        </span>
      </div>
      <div className="notice-actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={bring.isPending}
          onClick={() => bring.mutate()}
        >
          Bring all to the new look
        </button>
        {bring.isError && <span className="adopt-error">{bring.error.message}</span>}
        {refused && <span className="adopt-error">{refused}</span>}
      </div>
    </section>
  )
}
