/**
 * 生產環境接線：把 chrome.bookmarks / chrome.storage 包裝成 Executor 相依的介面。
 *
 * 依 Modern Web Guidance（storage / service-worker）：
 *  - 工作記錄存 chrome.storage.local（跨 SW 休眠、跨瀏覽器重啟保留）。
 *  - session 標記存 chrome.storage.session（瀏覽器關閉即清除），用於區分
 *    SW 休眠（自動恢復）與瀏覽器重啟（等待使用者確認）。
 *  - 事件監聽器在 background.ts 頂層同步註冊後轉呼 executor handler，不在此處註冊。
 */
import type {
  BookmarkAdapter,
  SortBookmarkNode,
  StorageAdapter,
} from './sort-executor'
import type { PlannerNode } from './sort-types'

export const chromeBookmarkAdapter: BookmarkAdapter = {
  async getChildren(folderId: string): Promise<SortBookmarkNode[]> {
    const nodes = await chrome.bookmarks.getChildren(folderId)
    return nodes.map(n => ({
      id: n.id,
      parentId: n.parentId,
      index: n.index,
      title: n.title,
      url: n.url,
    }))
  },
  async move(id: string, dest: { parentId: string, index: number }): Promise<void> {
    await chrome.bookmarks.move(id, { parentId: dest.parentId, index: dest.index })
  },
}

export const chromeStorageAdapter: StorageAdapter = {
  localGet: <T>(key: string): Promise<T | undefined> =>
    chrome.storage.local.get(key).then(r => r[key] as T | undefined),
  localSet: (key: string, value: unknown): Promise<void> =>
    chrome.storage.local.set({ [key]: value }),
  localRemove: (key: string): Promise<void> =>
    chrome.storage.local.remove(key),
  localGetBytesInUse: (key: string | null): Promise<number> =>
    // null → 整個 storage area 已使用位元組（配額估算需計入其他資料）
    chrome.storage.local.getBytesInUse(key),
  // 延遲求值：測試環境在 import 時 chrome 尚未存在，必須在實際存取時才讀取
  get localQuotaBytes(): number {
    return chrome.storage.local.QUOTA_BYTES
  },
  sessionGet: <T>(key: string): Promise<T | undefined> =>
    chrome.storage.session.get(key).then(r => r[key] as T | undefined),
  sessionSet: (key: string, value: unknown): Promise<void> =>
    chrome.storage.session.set({ [key]: value }),
  sessionRemove: (key: string): Promise<void> =>
    chrome.storage.session.remove(key),
}

/** 把 chrome BookmarkTreeNode 樹轉成 PlannerNode（輕量、可測） */
function toPlannerNode(n: chrome.bookmarks.BookmarkTreeNode): PlannerNode {
  return {
    id: n.id,
    parentId: n.parentId,
    index: n.index,
    title: n.title,
    url: n.url,
    dateAdded: n.dateAdded,
    dateLastUsed: n.dateLastUsed,
    unmodifiable: n.unmodifiable,
    children: (n.children ?? []).map(toPlannerNode),
  }
}

/** 讀取完整書籤樹（一次 getTree） */
export async function readPlannerTree(): Promise<PlannerNode[]> {
  const roots = await chrome.bookmarks.getTree()
  return roots.map(toPlannerNode)
}
