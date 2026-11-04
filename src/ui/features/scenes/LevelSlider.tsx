/**
 * A level as a slider in percent, 0% to 300%, 100% being the clip as made; the arrow keys move it
 * by 5%, and the value is written beside it.
 */
export function LevelSlider({
  label,
  level,
  onChange,
}: {
  label: string
  level: number
  onChange: (level: number) => void
}) {
  const percent = Math.round(level * 100)
  return (
    <span className="scene-slider">
      <input
        type="range"
        min={0}
        max={300}
        step={5}
        value={percent}
        aria-label={label}
        aria-valuetext={`${percent}%`}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <span className="scene-level">{percent}%</span>
    </span>
  )
}
