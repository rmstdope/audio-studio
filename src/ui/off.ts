/** A reason a control is off, or something falsy when that reason does not apply. */
export type Why = string | false | null | undefined

/** The attributes of a control that is off; empty when it is on. */
export type OffProps = {
  'aria-disabled'?: true
  'aria-description'?: string
  'data-why'?: string
}

/**
 * The props that grey a control with its reason: spread them on the button, menu or field. The
 * reasons are written in the order to deal with them (something only Setup or the computer can fix,
 * then something to do on this page, then something to wait for) and the first that applies is the
 * one the tip names. None applying returns nothing, so the control is on and shows nothing new. The
 * control stays focusable; `WhyTip` shows the reason and makes the control inert.
 */
export function off(...reasons: Why[]): OffProps {
  const why = reasons.find((r): r is string => typeof r === 'string' && r !== '')
  if (why === undefined) return {}
  return { 'aria-disabled': true, 'aria-description': why, 'data-why': why }
}

/** A rectangle in window coordinates. */
export type Rect = { left: number; top: number; width: number; height: number }
/** A width and a height. */
export type Size = { width: number; height: number }

/** The window margin a tip keeps clear of the edge. */
const EDGE = 8

/**
 * Where a tip goes: centred above its control, or below when there is no room above, and moved
 * inward so it fits inside the window, including a window narrower than the tip.
 */
export function tipPlace(
  target: Rect,
  tip: Size,
  win: Size,
  gap: number,
): { left: number; top: number; side: 'above' | 'below' } {
  const above = target.top - gap - tip.height
  const side = above >= EDGE ? 'above' : 'below'
  const top = side === 'above' ? above : target.top + target.height + gap
  const centred = target.left + target.width / 2 - tip.width / 2
  const left = Math.max(EDGE, Math.min(centred, win.width - tip.width - EDGE))
  return { left, top, side }
}
