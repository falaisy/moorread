import type { BookmarkTreeNode } from '~/lib/bookmark-tree'
import { ChevronRight, FolderOpen, FolderTree, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Checkbox } from '~/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { useI18n } from '~/lib/use-i18n'

interface FolderPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 一開始已經選中的 folder ids */
  initialIds: string[]
  /** 確認後回傳選中的 folder ids */
  onConfirm: (ids: string[]) => void
  /** 自訂 Dialog 標題；預設 nativeSortSelectFolders */
  titleKey?: import('~/lib/i18n').MessageKey
  /** 自訂 Dialog 說明文字；預設 nativeSortSelectFoldersDescription */
  descriptionKey?: import('~/lib/i18n').MessageKey
}

/**
 * 遞迴渲染 Chrome 原生書籤樹中的資料夾節點（排除書籤本身）。
 * 每個資料夾有展開/收合按鈕與勾選框。
 */
function FolderNodeRow({
  node,
  depth,
  expanded,
  selected,
  onToggleExpanded,
  onToggleSelected,
}: {
  node: BookmarkTreeNode
  depth: number
  expanded: Set<string>
  selected: Set<string>
  onToggleExpanded: (id: string) => void
  onToggleSelected: (id: string) => void
}) {
  const hasChildren = !!(node.children && node.children.length > 0)
  const isOpen = expanded.has(node.id)
  const isChecked = selected.has(node.id)

  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5"
        style={{ paddingLeft: `${depth * 1.25}rem` }}
      >
        {hasChildren
          ? (
              <button
                type="button"
                onClick={() => onToggleExpanded(node.id)}
                className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label={isOpen ? 'Collapse' : 'Expand'}
              >
                <ChevronRight
                  className={`size-3.5 text-muted-foreground transition-transform ${
                    isOpen ? 'rotate-90' : ''
                  }`}
                />
              </button>
            )
          : <span className="w-5 shrink-0" />}

        <Checkbox
          id={`folder-${node.id}`}
          checked={isChecked}
          onCheckedChange={() => onToggleSelected(node.id)}
        />
        <label
          htmlFor={`folder-${node.id}`}
          className="flex min-w-0 cursor-pointer items-center gap-2 text-sm"
        >
          <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.title || '(Untitled)'}</span>
        </label>
      </div>

      {hasChildren && isOpen && (
        <div>
          {node.children!
            .filter(child => !child.url && !child.unmodifiable)
            .map(child => (
              <FolderNodeRow
                key={child.id}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selected={selected}
                onToggleExpanded={onToggleExpanded}
                onToggleSelected={onToggleSelected}
              />
            ))}
        </div>
      )}
    </>
  )
}

/** 只取資料夾節點（排除 url 節點與 unmodifiable 節點） */
function collectFolderNodes(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  const result: BookmarkTreeNode[] = []
  for (const node of nodes) {
    if (node.url || node.unmodifiable)
      continue
    result.push(node)
    if (node.children)
      result.push(...collectFolderNodes(node.children))
  }
  return result
}

/** 把樹攤平可用於渲染的頂層節點 */
function topLevelFolders(nodes: BookmarkTreeNode[]): BookmarkTreeNode[] {
  return nodes.filter(node => !node.url && !node.unmodifiable)
}

export function BookmarkFolderPickerDialog({
  open,
  onOpenChange,
  initialIds,
  onConfirm,
  titleKey = 'nativeSortSelectFolders',
  descriptionKey = 'nativeSortSelectFoldersDescription',
}: FolderPickerDialogProps) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [tree, setTree] = useState<BookmarkTreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Dialog 打開時才去讀 Chrome bookmarks API
  useEffect(() => {
    if (!open)
      return

    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        if (typeof chrome === 'undefined' || !chrome.bookmarks)
          return
        const [root] = await chrome.bookmarks.getTree()
        if (cancelled)
          return
        const top = topLevelFolders(root.children ?? [])
        setTree(top)
        // 預設展開第一層（書籤列、其他書籤這些內建根下面的直接子資料夾）
        const allFolderIds = collectFolderNodes(top).map(n => n.id)
        // 預設展開前 3 層，避免一次全部展開畫面太長
        const toExpand = new Set<string>()
        const walk = (nodes: BookmarkTreeNode[], depth: number) => {
          if (depth > 2)
            return
          for (const n of nodes) {
            toExpand.add(n.id)
            if (n.children)
              walk(n.children.filter(c => !c.url && !c.unmodifiable), depth + 1)
          }
        }
        walk(top, 0)
        setExpanded(toExpand)
        setSelected(new Set(initialIds.filter(id => allFolderIds.includes(id))))
      }
      catch {
        setTree([])
      }
      finally {
        if (!cancelled)
          setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, initialIds])

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id))
        next.delete(id)
      else
        next.add(id)
      return next
    })
  }

  const toggleSelected = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id))
        next.delete(id)
      else
        next.add(id)
      return next
    })
  }

  const expandAll = () => {
    const ids = collectFolderNodes(tree).map(n => n.id)
    setExpanded(new Set(ids))
  }

  const collapseAll = () => {
    setExpanded(new Set())
  }

  const handleConfirm = () => {
    onConfirm([...selected])
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const selectedCount = selected.size
  const loadingPlaceholder = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      )
    }
    if (!tree.length) {
      return (
        <div className="py-8 text-center text-sm text-muted-foreground">
          No writable bookmark folders found.
        </div>
      )
    }
    return null
  }, [loading, tree.length])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderTree className="size-4" />
            {t(titleKey)}
          </DialogTitle>
          <DialogDescription>
            {t(descriptionKey)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={expandAll} disabled={loading}>
            {t('nativeSortSelectAll')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={collapseAll} disabled={loading}>
            {t('nativeSortCollapseAll')}
          </Button>
          <div className="ml-auto text-sm text-muted-foreground">
            {selectedCount > 0
              ? t('nativeSortSelectedCount', { count: selectedCount })
              : t('nativeSortNoSelection')}
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border">
          {loadingPlaceholder
            ?? tree.map(node => (
              <FolderNodeRow
                key={node.id}
                node={node}
                depth={0}
                expanded={expanded}
                selected={selected}
                onToggleExpanded={toggleExpanded}
                onToggleSelected={toggleSelected}
              />
            ))}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            {t('cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={loading}
          >
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
