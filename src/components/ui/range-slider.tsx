import { useId } from 'react'
import { cn } from '~/lib/utils'

interface RangeSliderProps {
  min: number
  max: number
  step?: number
  value: number
  onChange: (value: number) => void
  /** 自訂顯示值；undefined 就顯示原始 value */
  formatValue?: (v: number) => string
  /** 左側標籤（無 label 時仍需提供 aria-label 給 screen reader） */
  label?: string
  /** 無 label prop 時用作 aria-label 備援 */
  ariaLabel?: string
  className?: string
}

/**
 * 原生 <input type="range"> + Tailwind 樣式。
 * 顯示格式：[label] ------○------ [value]
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onChange,
  formatValue,
  label,
  ariaLabel,
  className,
}: RangeSliderProps) {
  const inputId = useId()
  const display = formatValue ? formatValue(value) : String(value)
  const pct = ((value - min) / (max - min)) * 100

  const labelContent = label && (
    <div className="flex items-center justify-between">
      <span id={`${inputId}-label`} className="font-medium">{label}</span>
      <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs tabular-nums text-muted-foreground">
        {display}
      </span>
    </div>
  )

  return (
    <div className={cn('grid gap-1.5 text-sm', className)}>
      {labelContent}
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="range-slider-input h-2 w-full cursor-pointer appearance-none rounded-full bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style={{
            background: `linear-gradient(to right, hsl(var(--primary)) 0%, hsl(var(--primary)) ${pct}%, hsl(var(--secondary)) ${pct}%, hsl(var(--secondary)) 100%)`,
          }}
          aria-label={ariaLabel}
          aria-labelledby={label ? `${inputId}-label` : undefined}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          aria-valuetext={display}
        />
      </div>
    </div>
  )
}
