import { useRef, useState } from 'react'
import {
  acceptableReasons,
  type ImageRow,
  type ImagesAct,
  type ImagesSummary,
} from '../../../core/images'
import { Pager } from '../../components/Pager'
import { Problems } from '../../components/Problems'
import { useAcceptImageChange, useImageCompare, useSetImageWords } from '../../api'
import { shortTitle } from '../../format'
import { outOfDateText } from '../../imagesText'
import { pagerFor } from '../../pager'
import { routeHref } from '../../route'
import { ActStyleBox } from './ActStyleBox'
import { ActStyleMenu } from './ActStyleMenu'
import { ActLinks } from './ActLinks'
import { GamePatchesPanel } from './GamePatchesPanel'
import { PatchesSection } from './PatchesSection'
import { TakesSection } from './TakesSection'
import { WordsField } from './WordsField'

/**
 * An image's own page: what is out of date above, then its workbench: the prompt (the words,
 * editable, and the whole prompt) beside its takes.
 */
export function ImagePage({
  act,
  row,
  images,
}: {
  act: ImagesAct
  row: ImageRow
  images: ImagesSummary
}) {
  const actName = (id: string | null) => {
    const found = images.acts.find((a) => a.id === id)
    return found ? shortTitle(found.title) : null
  }
  const [saved, setSaved] = useState(false)
  const save = useSetImageWords(row.id)
  const compare = useImageCompare(row.id)
  const accept = useAcceptImageChange(row.id)
  const canAccept = acceptableReasons(row.reasons)
  const field = useRef<HTMLTextAreaElement>(null)
  const settle = (choice: 'keep' | 'game') =>
    compare.mutate(choice, {
      onSuccess: (result) => {
        if (result.ok) field.current?.focus()
      },
    })
  // The act's images in the list's order; one with no row (the lists disagree) is not stepped to.
  const listed = act.order.flatMap((id) => act.rows.find((r) => r.id === id) ?? [])
  const pager = pagerFor(listed, row.id, (r) => ({
    name: r.title,
    href: routeHref({ view: 'images', page: 'image', image: r.id, from: act.id }),
  }))
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
          <h1 tabIndex={-1}>{row.title}</h1>
          <span className="mono muted">{row.id}</span>
          {row.sharedWith.length > 0 && (
            <span className="muted images-shared">
              Shared with <ActLinks acts={row.sharedWith} />: a change here changes it there too.
            </span>
          )}
          <span className="muted images-look-line">
            {row.look.line}
            {row.looksOld && <span className="chip chip-warn">Old look</span>}
          </span>
        </div>
        {pager && <Pager {...pager} keys={false} />}
      </header>
      {row.status === 'out of date' && (
        <section className="notice notice-warn">
          <div className="notice-text">
            <strong>
              {outOfDateText(
                row.reasons,
                shortTitle(act.title),
                row.actStyleChange && {
                  now: actName(row.actStyleChange.now),
                  was: actName(row.actStyleChange.was),
                },
              )}
            </strong>
            <span>
              The game shows the chosen image until you choose another.{' '}
              {canAccept
                ? 'Accept counts it as up to date as it is.'
                : 'A changed size needs a new take.'}
            </span>
            {accept.data && !accept.data.ok && 'message' in accept.data && (
              <span className="adopt-error">{accept.data.message}</span>
            )}
            {accept.error && <span className="adopt-error">{accept.error.message}</span>}
          </div>
          {canAccept && (
            <div className="notice-actions">
              <button
                className="btn"
                type="button"
                disabled={accept.isPending}
                onClick={() => accept.mutate()}
              >
                Accept
              </button>
            </div>
          )}
        </section>
      )}
      {row.gameChanged && (
        <section
          className="notice notice-warn images-compare"
          aria-label="The game's words changed"
        >
          <div className="notice-text">
            <strong>
              The game changed this image&apos;s description since you wrote your own.
            </strong>
            <div className="images-cmp">
              <div>
                <span className="label">Your words (used now)</span>
                <div className="images-ro">{row.words}</div>
              </div>
              <div>
                <span className="label">The game&apos;s new words</span>
                <div className="images-ro">{row.description}</div>
                <span className="muted">Before: {row.gameWas}</span>
              </div>
            </div>
          </div>
          <div className="notice-actions">
            <button
              className="btn"
              type="button"
              disabled={compare.isPending}
              onClick={() => settle('game')}
            >
              Use the game&apos;s
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={compare.isPending}
              onClick={() => settle('keep')}
            >
              Keep mine
            </button>
            {compare.isError && <span className="adopt-error">{compare.error.message}</span>}
            {compare.data && !compare.data.ok && 'problems' in compare.data && (
              <Problems title="Could not be settled" problems={compare.data.problems} />
            )}
          </div>
        </section>
      )}
      <TakesSection
        row={row}
        prompt={
          <section className="panel brief-panel" aria-label="Prompt">
            <div className="brief-panel-head">
              <h2>Prompt</h2>
              {saved && (
                <span className="saved" role="status">
                  Saved
                </span>
              )}
            </div>
            <WordsField
              label="What the image shows"
              words={row.words}
              changed={row.changed}
              save={save}
              onSaved={() => setSaved(true)}
              onEdit={() => setSaved(false)}
              inputRef={field}
            />
            {row.changed && <span className="muted">The game&apos;s words: {row.description}</span>}
            {row.actStyle?.choices ? (
              <ActStyleMenu
                imageId={row.id}
                actStyle={row.actStyle}
                onSaved={() => setSaved(true)}
                onEdit={() => setSaved(false)}
              />
            ) : (
              row.actStyle && (
                <ActStyleBox
                  imageId={row.id}
                  actName={shortTitle(act.title)}
                  actStyle={row.actStyle}
                  onSaved={() => setSaved(true)}
                  onEdit={() => setSaved(false)}
                />
              )
            )}
            <details className="images-whole">
              <summary>The whole prompt the model gets</summary>
              <pre className="images-ro mono">{row.prompt}</pre>
            </details>
          </section>
        }
      />
      <GamePatchesPanel key={row.id} row={row} />
      <PatchesSection key={row.chosenTake} imageId={row.id} />
    </>
  )
}
