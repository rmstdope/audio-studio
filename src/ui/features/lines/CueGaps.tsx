import { Fragment, useEffect, useRef, useState } from 'react'
import {
  WORDS_CHANGED,
  normalizeCue,
  piecesOf,
  wordsOf,
  withInside,
  type InsideCue,
} from '../../../core/cued'
import type { LineState } from '../../../core/planner'
import { chunkText } from '../../../core/spoken'
import { useSetInsideCue, useTryCue, takeUrl } from '../../api'
import { Problems } from '../../components/Problems'

/**
 * A line's words with the cues placed inside it. At rest each cue is a chip at its place; hovering
 * the text shows the gaps between words (none before the first word or after the last), and a
 * click on a gap or a chip opens a small box to place, change or remove the cue there. Keys: `p`
 * on the row (see `LinesView`) focuses the first gap; ← and → move between gaps, Enter opens the
 * box, Escape returns to the row. The box and its text are local: nothing survives a reload.
 */
export function LineWords({
  partId,
  line,
  language,
  chunkLimit,
  playing,
  toggle,
}: {
  partId: string
  line: LineState
  /** The language of the line, in a project with several. */
  language?: string
  chunkLimit: number
  playing: string | null
  toggle: (id: string, url: string) => void
}) {
  const words = wordsOf(line.text)
  const [open, setOpen] = useState<number | null>(null)
  // The gap to give focus back to once the box is closed.
  const back = useRef<number | null>(null)
  const text = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (open === null && back.current !== null) {
      text.current?.querySelector<HTMLElement>(`.cue-slot[data-at="${back.current}"]`)?.focus()
      back.current = null
    }
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>) => {
    const target = event.target as HTMLElement
    if (!target.classList.contains('cue-slot')) return
    const slots = [...event.currentTarget.querySelectorAll<HTMLElement>('.cue-slot')]
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      slots[slots.indexOf(target) + (event.key === 'ArrowRight' ? 1 : -1)]?.focus()
    } else if (event.key === 'Escape') {
      target.closest<HTMLElement>('tr[data-key]')?.focus()
    } else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <>
      <span className="line-text cued" ref={text} onKeyDown={onKeyDown}>
        {words.map((word, i) => {
          const placed = line.inside.find((c) => c.at === i)
          return (
            <Fragment key={i}>
              {i > 0 && (
                <>
                  {' '}
                  <button
                    type="button"
                    className={`cue-slot${placed ? ' cue-chip mono' : ' cue-gap'}`}
                    data-at={i}
                    tabIndex={-1}
                    title={
                      placed
                        ? 'A cue inside the line: click to change or remove it'
                        : 'Place a cue here'
                    }
                    aria-label={
                      placed ? `Cue ${placed.cue} before “${word}”` : `Place a cue before “${word}”`
                    }
                    aria-expanded={open === i}
                    onClick={() => setOpen(open === i ? null : i)}
                  >
                    {placed ? placed.cue : ''}
                  </button>
                  {placed ? ' ' : null}
                </>
              )}
              {word}
            </Fragment>
          )
        })}
      </span>
      {open !== null && (
        <CueBox
          key={open}
          partId={partId}
          line={line}
          at={open}
          placed={line.inside.find((c) => c.at === open)?.cue ?? null}
          word={words[open] ?? ''}
          language={language}
          chunkLimit={chunkLimit}
          playing={playing}
          toggle={toggle}
          close={() => {
            back.current = open
            setOpen(null)
          }}
        />
      )}
      {line.insideStale !== null && (
        <span className="line-stale-cues" role="status">
          <b>The cues inside this line no longer fit its words</b>, so it records with{' '}
          {line.cue || 'no cue'} only. Place them again in the text above. Before:{' '}
          <span className="mono">{line.insideStale}</span>
        </span>
      )}
    </>
  )
}

/** Words with cue chips between them, as a piece of a line is recorded or a source line is shown; nothing to click. */
export function CuedText({ text, inside }: { text: string; inside: InsideCue[] }) {
  return (
    <>
      {wordsOf(text).map((word, i) => {
        const placed = inside.find((c) => c.at === i)
        return (
          <Fragment key={i}>
            {i > 0 && ' '}
            {placed && (
              <>
                <span className="cue-chip mono">{placed.cue}</span>{' '}
              </>
            )}
            {word}
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * The box to place a cue at a gap, or change or remove the one in a chip. Add or Save writes
 * straight away (the line turns stale); Hear it plays the whole line with the cue as typed, a free
 * take that saves nothing. While open on a line recorded in several pieces it lists them, as they
 * would be sent with the cue as typed.
 */
function CueBox({
  partId,
  line,
  at,
  placed,
  word,
  language,
  chunkLimit,
  playing,
  toggle,
  close,
}: {
  partId: string
  line: LineState
  at: number
  /** The cue already at this gap (a chip), else null. */
  placed: string | null
  /** The word the cue comes before. */
  word: string
  language?: string
  chunkLimit: number
  playing: string | null
  toggle: (id: string, url: string) => void
  close: () => void
}) {
  const save = useSetInsideCue(partId, language)
  const hear = useTryCue(partId, language)
  const [draft, setDraft] = useState(placed ?? '')
  const tryId = `try/${line.key}/${at}`
  const heard = hear.data?.ok ? hear.data : null
  const refused = hear.data && !hear.data.ok ? hear.data : null
  const problems = save.data && !save.data.ok && 'problems' in save.data ? save.data.problems : []
  const changed = problems.some((p) => p.message === WORDS_CHANGED)
  const cue = normalizeCue(draft)

  // A try still playing stops when the box goes (a reload, a filter, a closed box).
  const playingNow = useRef(playing)
  playingNow.current = playing
  useEffect(
    () => () => {
      if (playingNow.current === tryId) toggle(tryId, '')
    },
    [tryId, toggle],
  )

  const chunks = chunkText(line.text, chunkLimit)
  const pieces =
    chunks.length > 1 ? piecesOf(chunks, line.cue, withInside(line.inside, at, cue)) : []

  const write = (value: string) =>
    save.mutate(
      { key: line.key, at, cue: value, text: line.text },
      { onSuccess: (result) => result.ok && close() },
    )
  const tryIt = () => {
    if (playing === tryId) return toggle(tryId, '')
    hear.mutate(
      { key: line.key, cue, at },
      { onSuccess: (result) => result.ok && toggle(tryId, takeUrl(result.key)) },
    )
  }
  const cancel = () => {
    if (playing === tryId) toggle(tryId, '')
    close()
  }

  return (
    <>
      <form
        className="cue-box"
        onSubmit={(event) => {
          event.preventDefault()
          if (cue && !save.isPending && !changed && cue !== placed) write(cue)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancel()
          }
        }}
      >
        <input
          className="mono"
          autoFocus
          aria-label={`Cue before “${word}”`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="cue-hint muted">
          {placed === null
            ? `From “${word}” on, until the next cue. Brackets are added for you.`
            : `From “${word}” on, until the next cue.`}
        </span>
        {changed && (
          <section className="cue-refused" role="alert">
            <b>The cue could not be saved.</b> This line’s words changed in the game; close this and
            place the cue again.
          </section>
        )}
        <div className="cue-actions">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={save.isPending || changed || !cue || cue === placed}
          >
            {placed === null ? 'Add' : 'Save'}
          </button>
          {placed !== null && (
            <button
              className="btn"
              type="button"
              disabled={save.isPending}
              onClick={() => write('')}
            >
              Remove
            </button>
          )}
          <button className="btn" type="button" onClick={cancel}>
            Cancel
          </button>
          <button
            className="btn"
            type="button"
            title="Hear the whole line said with this cue, without saving anything (a free take)"
            disabled={hear.isPending || (placed === null && !cue)}
            onClick={tryIt}
          >
            {hear.isPending ? 'Recording…' : playing === tryId ? 'Stop' : 'Hear it'}
          </button>
        </div>
        {heard && playing === tryId && <span className="muted cue-tried mono">{heard.spoken}</span>}
        {!changed && problems.length > 0 && (
          <Problems title="The cue could not be saved" problems={problems} />
        )}
        {save.isError && <span className="adopt-error">{save.error.message}</span>}
        {refused && 'problems' in refused && (
          <Problems title="The cue could not be tried" problems={refused.problems} />
        )}
        {refused && 'message' in refused && <span className="adopt-error">{refused.message}</span>}
        {hear.isError && <span className="adopt-error">{hear.error.message}</span>}
      </form>
      {pieces.length > 0 && (
        <div className="cue-pieces">
          <span className="muted">Recorded in {pieces.length} pieces:</span>
          {pieces.map((piece, i) => (
            <div className="cue-piece" key={i}>
              <span className="cue-piece-n muted">Piece {i + 1}</span>
              <span>
                {piece.cue && (
                  <>
                    <span className="cue-chip mono">{piece.cue}</span>{' '}
                  </>
                )}
                <CuedText text={piece.text} inside={piece.inside} />
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
