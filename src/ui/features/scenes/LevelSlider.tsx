/**
 * A level as a slider in percent, 0% to 300%, 100% being the clip as made; the arrow keys move it
 * by 5%, and the value is written beside it.
 */
export function LevelSlider({
  label,
  level,
  was,
  onChange,
}: {
  label: string
  level: number
  /** The level before a press of the loudness suggestion moved it, when this one was moved. */
  was?: number
  onChange: (level: number) => void
}) {
  const percent = Math.round(level * 100)
  const wasPercent = was === undefined ? null : Math.round(was * 100)
  const moved = wasPercent !== null && wasPercent !== percent
  return (
    <span className="scene-slider">
      <input
        type="range"
        min={0}
        max={300}
        step={5}
        value={percent}
        aria-label={label}
        aria-valuetext={moved ? `${percent}% (was ${wasPercent}%)` : `${percent}%`}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <span className={moved ? 'scene-level scene-level-moved' : 'scene-level'}>{percent}%</span>
    </span>
  )
}
