import type { ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'

import { cn } from '~/lib/utils'

interface CompactCategoryPopoverProps {
  /** The element that opens the popover on hover / click / focus. */
  trigger: ReactNode
  /** The popover body, typically a column of CategoryTabs content. */
  children: ReactNode
  /** Optional side offset in pixels (default 8). */
  sideOffset?: number
  className?: string
  /** Accessible name for the popover content (e.g. i18n key 'bookmarkCategories'). */
  ariaLabel?: string
}

/**
 * Popover that hosts the full category tree when the sidebar is collapsed
 * to its 56px icon-only state. Supports hover (desktop), click (touch),
 * and focus (keyboard) as openers; closes on Escape, outside click, or
 * scroll/resize of the viewport.
 *
 * Usage:
 *   <CompactCategoryPopover trigger={<button>…</button>}>
 *     <CategoryTabs compact={false} />
 *   </CompactCategoryPopover>
 */
export function CompactCategoryPopover({
  trigger,
  children,
  sideOffset = 8,
  className,
  ariaLabel,
}: CompactCategoryPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        {trigger}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          aria-label={ariaLabel}
          role="group"
          side="right"
          sideOffset={sideOffset}
          alignOffset={0}
          avoidCollisions
          collisionPadding={8}
          className={cn(
            'z-popover w-[220px] rounded-lg border border-border bg-popover p-2 shadow-lg outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none',
            className,
          )}
          onOpenAutoFocus={(event) => {
            // Do NOT auto-focus inside the popover — hover trigger keeps
            // the user's pointer on the collapsed button; focus trigger
            // already landed on the trigger itself.
            event.preventDefault()
          }}
        >
          {children}
          <Popover.Arrow className="fill-border" width={10} height={5} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
