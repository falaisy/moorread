import type { ReactNode } from 'react'

import { ChevronRight } from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '~/components/ui/collapsible'
import { cn } from '~/lib/utils'

interface SmartCategoriesCollapsibleProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  label: string
  count: number
  treeEnabled: boolean
  children: ReactNode
  compact?: boolean
}

export function SmartCategoriesCollapsible({
  open,
  onOpenChange,
  label,
  count,
  treeEnabled,
  children,
  compact = false,
}: SmartCategoriesCollapsibleProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="flex shrink-0 gap-1 lg:w-full lg:flex-col"
    >
      <CollapsibleTrigger asChild>
        {compact
          ? (
              <Button
                variant="ghost"
                size="icon"
                aria-label={label}
                title={label}
                className={cn(
                  'shrink-0',
                  treeEnabled && 'lg:ml-2',
                )}
              >
                <ChevronRight
                  data-icon="inline-start"
                  className={cn(
                    'transition-transform size-4',
                    open && 'rotate-90',
                  )}
                />
              </Button>
            )
          : (
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'shrink-0 justify-start gap-2 pl-2.5 pr-2 lg:w-full',
                  treeEnabled && 'lg:pl-8',
                )}
              >
                <span aria-hidden="true" className="flex w-5 shrink-0 items-center justify-center">
                  <ChevronRight
                    data-icon="inline-start"
                    className={cn(
                      'transition-transform',
                      open && 'rotate-90',
                    )}
                  />
                </span>
                <span className="min-w-0 truncate">{label}</span>
                <span className="ml-auto text-xs tabular-nums opacity-60">
                  {count}
                </span>
              </Button>
            )}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex gap-1 lg:flex-col">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
