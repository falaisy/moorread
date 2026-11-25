import { cn } from '~/lib/utils'

interface SwatchItem<T extends string> {
  value: T
  /** HSL 字串，例如 "217 91% 52%" */
  color: string
  label: string
}

interface SwatchPickerProps<T extends string> {
  items: SwatchItem<T>[]
  value: T
  onChange: (value: T) => void
  label?: string
  /** 色塊尺寸 */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * 一排小圓色色塊選擇器。用 HSL 字串直接寫 style 背景色。
 */
export function SwatchPicker<T extends string>({
  items,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: SwatchPickerProps<T>) {
  const sz = size === 'sm' ? 'size-6' : 'size-8'

  return (
    <div className={cn('grid gap-1.5 text-sm', className)}>
      {label && <span className="font-medium">{label}</span>}
      <div className="flex flex-wrap items-center gap-2">
        {items.map(item => {
          const selected = item.value === value
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              aria-label={item.label}
              aria-pressed={selected}
              title={item.label}
              className={cn(
                sz,
                'rounded-full border border-border/60 transition-all duration-150',
                'hover:scale-110 active:scale-95',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                selected && 'ring-2 ring-ring ring-offset-2 scale-110',
              )}
              style={{ backgroundColor: `hsl(${item.color})` }}
            />
          )
        })}
      </div>
    </div>
  )
}
