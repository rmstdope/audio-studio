import { useRef, useState } from 'react'
import type { ImageRow, ImagesAct } from '../../../core/images'
import { Problems } from '../../components/Problems'
import { useImageCompare, useSetImageWords } from '../../api'
import { shortTitle } from '../../format'
import { outOfDateText } from '../../imagesText'
import { routeHref } from '../../route'
import { TakesSection } from './TakesSection'
import { WordsField } from './WordsField'

/** An image's own page: its prompt (the words, editable), the whole prompt, and what is out of date. */
export function ImagePage({ act, row }: { act: ImagesAct; row: ImageRow }) {
  const [saved, setSaved] = useState(false)
  const save = useSetImageWords(row.id)
  const compare = useImageCompare(row.id)
  const field = useRef<HTMLTextAreaElement>(null)
  const settle = (choice: 'keep' | 'game') =>
    compare.mutate(choice, {
      onSuccess: (result) => {
        if (result.ok) field.current?.focus()
      },
    })
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
          <span className="mono muted">
            {row.id} · {row.width} × {row.height}
          </span>
        </div>
      </header>
      {row.status === 'out of date' && (
        <section className="notice notice-warn">
          <div className="notice-text">
            <strong>{outOfDateText(row.reasons)}</strong>
            <span>The game shows the chosen image until you choose another.</span>
          </div>
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
      <section className="panel brief-panel">
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
        <details className="images-whole">
          <summary>The whole prompt the model gets</summary>
          <pre className="images-ro mono">{row.prompt}</pre>
        </details>
      </section>
      <TakesSection row={row} />
    </>
  )
}
