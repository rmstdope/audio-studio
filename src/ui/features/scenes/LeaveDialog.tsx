import { useEffect, useRef } from 'react'

/**
 * The question asked when something would leave a scene with unsaved changes. Focus starts on
 * Save; Escape is Cancel, and closing returns focus to where it was.
 */
export function LeaveDialog({
  name,
  canSave,
  onSave,
  onDiscard,
  onCancel,
}: {
  name: string
  /** Whether Save can write the scene: not while a row is red. */
  canSave: boolean
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  const save = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    save.current?.focus()
    return () => before?.focus()
  }, [])
  return (
    <div className="scene-leave-backdrop">
      <div
        className="panel scene-leave"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="scene-leave-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      >
        <h2 id="scene-leave-title">Save the changes to {name}?</h2>
        <p className="muted">If you don&apos;t, they are lost.</p>
        <div className="confirm-actions">
          <button className="btn btn-ghost" type="button" onClick={onDiscard}>
            Don&apos;t save
          </button>
          <button className="btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            ref={save}
            className="btn btn-primary"
            type="button"
            aria-disabled={!canSave || undefined}
            onClick={() => canSave && onSave()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
