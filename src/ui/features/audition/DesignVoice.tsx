import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  DESIGN_COUNT,
  DESIGN_PRICE,
  descriptionState,
  designCredit,
  designPoints,
} from '../../../core/design'
import { usd } from '../../../core/spend'
import { useCredit, useDesigns, useDesignVoices } from '../../api'
import { Confirm } from '../../components/Confirm'

/** What a design that did not work says: Fish's reason, or the studio's own. */
function failureLine(
  result: { ok: false; reason?: string; message?: string } | { ok: false } | undefined,
): string {
  const failure = result as { reason?: string; message?: string } | undefined
  if (!failure?.message) return 'The project’s files need fixing.'
  // Money or confirmation refused by the studio before Fish was asked: its own words.
  if (failure.reason === 'confirm' || failure.reason === 'credit') return failure.message
  return `Fish couldn’t design voices: ${failure.message.replace(/\.$/, '')}. Nothing was charged.`
}

/**
 * The box that designs voices from a description, on the character page and on the audition
 * board: the text (it opens with the last one sent, else a start made from the casting brief),
 * the confirm of the cost, the wait and the failure. A design that works calls `onDone`.
 * Escape closes the box, or goes back from the confirm to the box.
 */
export function DesignVoice({
  characterId,
  name,
  start,
  auditioning,
  onDone,
  onClose,
}: {
  characterId: string
  name: string
  /** The starting text when nothing was sent before. */
  start: string
  /** Whether an audition is going on for the character: if not, paying starts one. */
  auditioning: boolean
  onDone: () => void
  onClose: () => void
}) {
  const designs = useDesigns(characterId)
  const credit = useCredit()
  const design = useDesignVoices(characterId)
  const [typed, setTyped] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const pay = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)

  const last = designs.data?.ok ? designs.data.description : null
  const text = typed ?? last ?? start
  const state = descriptionState(text)
  const pending = design.isPending
  const failure = design.data && !design.data.ok ? design.data : undefined
  const money = designCredit(
    credit.isFetching ? undefined : credit.data?.ok ? credit.data.credit : null,
  )

  // Focus lands in the text when the box opens, and comes back to it from the confirm.
  useEffect(() => {
    if (!confirming) field.current?.focus()
  }, [confirming])
  // The credit may have changed since it was last read: ask when the confirm opens.
  const { refetch } = credit
  useEffect(() => {
    if (confirming) void refetch()
  }, [confirming, refetch])
  useEffect(() => {
    if (!confirming) return
    if (money.kind === 'ask') pay.current?.focus()
    else if (money.kind === 'cannot') retry.current?.focus()
  }, [confirming, money.kind])

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape' || pending) return
    event.stopPropagation()
    if (confirming) setConfirming(false)
    else onClose()
  }

  function send() {
    setConfirming(false)
    design.mutate(text.trim(), { onSuccess: (result) => result.ok && onDone() })
  }

  return (
    <div className="design" onKeyDown={onKeyDown}>
      <section className="panel design-box" aria-label="Design a voice">
        <h2 className="section-title">Design a voice</h2>
        <p className="muted">
          Describe the voice you want. Fish makes {DESIGN_COUNT} voices from it, each saying the
          audition phrase; they join the audition board.
        </p>
        <textarea
          ref={field}
          className="search design-text"
          aria-label="Description of the voice"
          rows={4}
          value={text}
          disabled={pending}
          aria-invalid={state.tooLong !== null}
          onChange={(event) => {
            setTyped(event.target.value)
            design.reset()
          }}
        />
        {state.count && !state.tooLong && <span className="muted design-count">{state.count}</span>}
        {state.tooLong && (
          <span className="adopt-error" role="alert">
            {state.tooLong}
          </span>
        )}
        {pending && <span className="muted">Fish is making {DESIGN_COUNT} voices.</span>}
        {design.isError && <span className="adopt-error">{design.error.message}</span>}
        {failure && (
          <span className="adopt-error" role="alert">
            {failureLine(failure)}
          </span>
        )}
        <div className="design-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!state.canSend || pending || confirming}
            onClick={() => setConfirming(true)}
          >
            {pending ? 'Designing…' : 'Design voices…'}
          </button>
          <button className="btn btn-ghost" type="button" disabled={pending} onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
      {confirming &&
        (money.kind === 'cannot' ? (
          <Confirm
            title="Fish can’t design voices now"
            effects={[money.message]}
            back="Cancel"
            onBack={() => setConfirming(false)}
          >
            <button
              ref={retry}
              className="btn"
              type="button"
              disabled={credit.isFetching}
              onClick={() => void refetch()}
            >
              Try again
            </button>
          </Confirm>
        ) : (
          <Confirm
            title="Design voices with Fish?"
            effects={designPoints(name, auditioning)}
            note={
              money.kind === 'ask' ? `Your credit: ${usd(money.credit)}` : 'Reading your credit…'
            }
            back="Cancel"
            onBack={() => setConfirming(false)}
          >
            <button
              ref={pay}
              className="btn btn-primary"
              type="button"
              disabled={money.kind !== 'ask'}
              onClick={send}
            >
              Pay up to {usd(DESIGN_PRICE)}
            </button>
          </Confirm>
        ))}
    </div>
  )
}
