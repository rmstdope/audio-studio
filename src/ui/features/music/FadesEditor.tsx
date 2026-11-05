import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  EMPTY_LINE,
  FADE_SHAPES,
  FADE_STEP,
  envelopePoints,
  fadeGain,
  heardAs,
  fadesProblem,
  lengthAtX,
  stepHandle,
  type Fades,
} from '../../../core/fades'
import type { TakeView } from '../../../core/musicTake'
import { cutShares, playedSeconds, takeSoundUrl } from './trimSilence'
import { useTrackActions } from './trackActions'
import { useSetFades } from '../../api'
import type { useClipPlayer } from '../../components/useClipPlayer'

/** One clip at a time, shared with the takes around the editor. */
type Player = ReturnType<typeof useClipPlayer>

/** A length as it is typed in a box: "0.3", "1", never "0.30000000000000004". */
function boxText(seconds: number): string {
  return `${Math.round(seconds * 100) / 100}`
}

/** A box's text as a length; NaN for an empty or unreadable box. */
function lengthOf(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text)
}

/**
 * A take's waveform for the editor: tall, on a dark well, with the fade line over it and a handle
 * at the inner end of each fade. The bars inside a fade are drawn shrunk by it, with their full
 * height ghosted behind.
 */
function FadeWave({
  part,
  fades,
  position,
  onIn,
  onOut,
}: {
  /** The sound that plays: its length and the bars of the part between the cuts. */
  part: { seconds: number; peaks: number[] }
  /** The fades as they last could be used. */
  fades: Fades
  position?: () => number | null
  /** A handle moved: the length it now means. */
  onIn: (seconds: number) => void
  onOut: (seconds: number) => void
}) {
  const well = useRef<HTMLDivElement>(null)
  const head = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!position) return
    let frame = 0
    const draw = () => {
      if (head.current) head.current.style.left = `${(position() ?? 0) * 100}%`
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [position])
  const { seconds } = part
  const lengthAt = (event: PointerEvent) => {
    const box = well.current?.getBoundingClientRect()
    return lengthAtX(event.clientX - (box?.left ?? 0), box?.width ?? 0, seconds)
  }
  /** A press on a handle takes the pointer, so the drag follows it out of the handle. */
  const grab = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
    event.currentTarget.focus()
  }
  const key = (event: KeyboardEvent, step: (direction: 1 | -1, shift: boolean) => void) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    step(event.key === 'ArrowRight' ? 1 : -1, event.shiftKey)
  }
  const bars = part.peaks.length
  return (
    <div className="wave wave-big" ref={well}>
      {part.peaks.map((peak, i) => {
        const gain = fadeGain(fades, seconds, ((i + 0.5) / bars) * seconds)
        return (
          <i key={i} aria-hidden>
            <span style={{ height: `${Math.max(4, peak * 100 * gain)}%` }} />
            <b style={{ height: `${Math.max(4, peak * 100)}%` }} />
          </i>
        )
      })}
      <svg className="env" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <polyline points={envelopePoints(fades, seconds)} />
      </svg>
      <span
        className="handle"
        role="slider"
        tabIndex={0}
        aria-label="Fade in length"
        aria-valuemin={0}
        aria-valuemax={seconds}
        aria-valuenow={fades.in}
        style={{ left: `calc(${(fades.in / seconds) * 100}% - 6px)` }}
        onKeyDown={(event) =>
          key(event, (d, shift) => onIn(stepHandle(fades.in, d, shift, 0, seconds)))
        }
        onPointerDown={grab}
        onPointerMove={(event) => {
          if (event.buttons) onIn(lengthAt(event))
        }}
      />
      <span
        className="handle"
        role="slider"
        tabIndex={0}
        aria-label="Fade out length"
        aria-valuemin={0}
        aria-valuemax={seconds}
        aria-valuenow={fades.out}
        style={{ left: `calc(${((seconds - fades.out) / seconds) * 100}% - 6px)` }}
        // The out handle sits at the fade's inner end: right shortens the fade.
        onKeyDown={(event) =>
          key(event, (d, shift) =>
            onOut(stepHandle(fades.out, d === 1 ? -1 : 1, shift, 0, seconds)),
          )
        }
        onPointerDown={grab}
        onPointerMove={(event) => {
          if (event.buttons) onOut(seconds - lengthAt(event))
        }}
      />
      {position && <span className="playhead" ref={head} />}
    </div>
  )
}

/**
 * The editor of a stinger take's fades, in place of the card's own waveform and buttons (or inside
 * the In the game block when the take is the chosen one): play it with the fades as they stand,
 * drag the handles or type the lengths, pick the shape, then Save fades, Cancel, or Remove fades
 * when the take has some. Saving a chosen take writes the game's file at once.
 */
export function FadesEditor({
  trackId,
  take,
  chosen,
  player,
  onClose,
}: {
  trackId: string
  take: TakeView
  /** The take is the one the game plays. */
  chosen: boolean
  player: Player
  /** The editor is done (saved, removed or cancelled). */
  onClose: () => void
}) {
  const saved: Fades = take.fades ?? { in: 0, out: 0, shape: 'smooth' }
  const [inText, setInText] = useState(boxText(saved.in))
  const [outText, setOutText] = useState(boxText(saved.out))
  /** Which button was pressed last: the failure line says saved or removed. */
  const [removing, setRemoving] = useState(false)
  const [shape, setShape] = useState<Fades['shape']>(saved.shape)
  const set = useSetFades(trackId)
  const actions = useTrackActions()
  const inBox = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inBox.current?.focus()
    inBox.current?.select()
  }, [])

  const typed: Fades = { in: lengthOf(inText), out: lengthOf(outText), shape }
  // A trimmed take is faded after the cut: the length, the bars and the sound are of the part between the cuts.
  const cut = cutShares(take)
  const part = {
    seconds: playedSeconds(take),
    peaks: cut
      ? take.peaks.slice(
          Math.floor(cut.start * take.peaks.length),
          Math.ceil((1 - cut.end) * take.peaks.length),
        )
      : take.peaks,
  }
  const problem = fadesProblem(typed, part.seconds)
  // The handles and the sound stay where they last could be while the boxes hold lengths that cannot be used.
  const lastGood = useRef<Fades>(saved)
  if (!problem) lastGood.current = typed
  const good = lastGood.current
  const changed =
    !problem && (typed.in !== saved.in || typed.out !== saved.out || shape !== saved.shape)
  const saving = set.isPending
  const canSave = changed && !saving

  const id = `music-take-${trackId}-${take.n}`
  const { url, fade } = heardAs(takeSoundUrl(trackId, take), good)
  const how = { fade }
  const playing = player.playing === id
  const heard = useRef(url)
  useEffect(() => {
    // A change while it plays starts it again from the top.
    if (heard.current === url) return
    heard.current = url
    if (player.playing === id) {
      player.stop()
      player.toggle(id, url, how)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  const close = () => {
    if (player.playing === id) player.stop()
    onClose()
  }
  const finish = (result: { ok: boolean }) => {
    if (result.ok) close()
  }
  const save = () => {
    if (!canSave) return
    setRemoving(false)
    actions.press(`fades:${take.n}`)
    set.mutate({ file: take.file, fades: typed }, { onSuccess: finish })
  }
  const gameChanged = set.data && !set.data.ok && 'gameChanged' in set.data
  const failure = !actions.shows(`fades:${take.n}`)
    ? null
    : set.isError
      ? set.error.message
      : set.data && !set.data.ok
        ? 'message' in set.data
          ? set.data.message
          : `${set.data.file} could not be read.`
        : null

  const lengthBox = (label: string, text: string, onText: (value: string) => void) => {
    const value = lengthOf(text)
    // An empty or negative box is the offender; when the lengths are too long together, both are.
    const bad = Number.isNaN(value) || value < 0 || (problem !== null && problem !== EMPTY_LINE)
    return (
      <label className="field">
        {label}
        <input
          type="number"
          step={FADE_STEP}
          min={0}
          value={text}
          ref={label === 'Fade in' ? inBox : undefined}
          disabled={saving}
          aria-invalid={bad && problem !== null ? true : undefined}
          className={bad && problem !== null ? 'invalid' : undefined}
          onChange={(event) => onText(event.target.value)}
        />
        s
      </label>
    )
  }

  return (
    <div
      className="editor"
      onKeyDown={(event) => {
        if (saving) return
        if (event.key === 'Escape') close()
        else if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) save()
      }}
    >
      <div className="take-row">
        <button
          type="button"
          className="play"
          aria-label={`${playing ? 'Stop' : 'Play'} take ${take.n} with the fades`}
          onClick={() => player.toggle(id, url, how)}
        >
          {playing ? '■' : '▶'}
        </button>
        <span className="small muted grow">Hear it with the fades</span>
      </div>
      <FadeWave
        part={part}
        fades={good}
        position={playing ? player.position : undefined}
        onIn={(seconds) =>
          setInText(boxText(Math.min(seconds, Math.max(0, part.seconds - good.out))))
        }
        onOut={(seconds) =>
          setOutText(boxText(Math.min(seconds, Math.max(0, part.seconds - good.in))))
        }
      />
      <div className="fades">
        {lengthBox('Fade in', inText, setInText)}
        {lengthBox('Fade out', outText, setOutText)}
        <label className="field">
          Shape
          <select
            value={shape}
            disabled={saving}
            onChange={(event) => setShape(event.target.value as Fades['shape'])}
          >
            {FADE_SHAPES.map((name) => (
              <option key={name} value={name}>
                {name === 'smooth' ? 'Smooth' : 'Straight'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {problem && (
        <span className="errline" role="alert">
          {problem}
        </span>
      )}
      <span className="faint small">
        {chosen
          ? 'Saving puts the faded sound in the game at once.'
          : 'Drag the handles or type a length; 0 is no fade.'}
      </span>
      {failure && (
        <span className="adopt-error" role="alert">
          The fades could not be {removing ? 'removed' : 'saved'}. {failure}
          {chosen &&
            !gameChanged &&
            ` The game still plays Take ${take.n} ${removing ? 'with its fades' : 'as before'}.`}
        </span>
      )}
      <div className="take-row editor-actions">
        {take.fades && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={saving}
            onClick={() => {
              setRemoving(true)
              actions.press(`fades:${take.n}`)
              set.mutate({ file: take.file, fades: null }, { onSuccess: finish })
            }}
          >
            Remove fades
          </button>
        )}
        <span className="grow" />
        <button type="button" className="btn btn-small" disabled={saving} onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-small"
          disabled={!canSave}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save fades'}
        </button>
      </div>
    </div>
  )
}
