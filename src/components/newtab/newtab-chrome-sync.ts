import {
  historyStorageKey,
  metadataSyncRecoveryStorageKey,
  pruneHistory,
  pruneMetadataSyncRecovery,
  pruneTrash,
  trashStorageKey,
} from '~/lib/activity'
import { bookmarkGroupsKeyPrefix } from '~/lib/bookmark-groups'
import { useBookmarkGroupsStore } from '~/lib/bookmark-groups-store'
import { reportExpectedFallback } from '~/lib/diagnostics'
import { metadataSyncManifestKey } from '~/lib/metadata-sync'
import { useNavStore } from '~/lib/store'
import { STORAGE_KEYS } from '~/lib/store-persistence'
import { normalizeSettings } from '~/lib/store-settings-state'

// 实时反映浏览器侧的书签变化。
// Every Chrome listener and the debounce timer are released in the teardown.
export function subscribeToBookmarkChanges(): (() => void) | undefined {
  if (typeof chrome === 'undefined' || !chrome.bookmarks)
    return undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  const refresh = () => {
    if (refreshTimer)
      clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined
      void useNavStore.getState().loadBookmarks()
    }, 75)
  }
  const refreshChanged = (
    id: string,
    changeInfo: { url?: string, title?: string },
  ) => {
    // Chrome includes the current URL even when only the title changed.
    if (changeInfo.title !== undefined && useNavStore.getState().applyNativeBookmarkTitle(id, changeInfo.title, changeInfo.url))
      return
    if (changeInfo.url) {
      void useNavStore.getState().reconcileBookmarkUrlChange(
        id,
        changeInfo.url,
      )
    }
    refresh()
  }
  chrome.bookmarks.onCreated.addListener(refresh)
  chrome.bookmarks.onChanged.addListener(refreshChanged)
  chrome.bookmarks.onMoved.addListener(refresh)
  chrome.bookmarks.onRemoved.addListener(refresh)
  chrome.bookmarks.onChildrenReordered.addListener(refresh)
  return () => {
    if (refreshTimer)
      clearTimeout(refreshTimer)
    chrome.bookmarks.onCreated.removeListener(refresh)
    chrome.bookmarks.onChanged.removeListener(refreshChanged)
    chrome.bookmarks.onMoved.removeListener(refresh)
    chrome.bookmarks.onRemoved.removeListener(refresh)
    chrome.bookmarks.onChildrenReordered.removeListener(refresh)
  }
}

// The Chrome storage listener is removed with the same callback reference.
export function subscribeToStorageChanges(): (() => void) | undefined {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged)
    return undefined
  const onStorageChanged = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ) => {
    if (areaName === 'sync' && changes[STORAGE_KEYS.settings]) {
      try {
        const raw = changes[STORAGE_KEYS.settings].newValue
        const settings = normalizeSettings(typeof raw === 'string' ? JSON.parse(raw) : raw)
        const prevSettings = changes[STORAGE_KEYS.settings].oldValue
        const prevNormalized = normalizeSettings(typeof prevSettings === 'string' ? JSON.parse(prevSettings) : prevSettings ?? {})
        // 整份替换而不是只挑几个字段：否则本页会一直持有旧的默认文件夹，
        // 下一次写设置时又把它覆盖回去。
        useNavStore.setState((state) => {
          if (JSON.stringify(state.settings) === JSON.stringify(settings))
            return state
          return { settings }
        })
        // 当 defaultCategoryId 改变时，同时更新当前活跃分类，
        // 让所有新分页即时反映新的默认。
        if (prevNormalized.defaultCategoryId !== settings.defaultCategoryId)
          useNavStore.getState().applyDefaultCategory()
      }
      catch { /* Retain the current setting if an incoming record is malformed. */ }
    }
    if (areaName === 'sync' && Object.keys(changes).some(key => key.startsWith(bookmarkGroupsKeyPrefix)))
      void useBookmarkGroupsStore.getState().load()
    if (areaName === 'sync' && changes[metadataSyncManifestKey])
      void useNavStore.getState().syncMetadataNow()
    if (areaName === 'local'
      && (changes[STORAGE_KEYS.meta] || changes[STORAGE_KEYS.categoryMeta])) {
      void useNavStore.getState().refreshSupplementaryMetadata()
    }
    if (areaName === 'local' && changes[trashStorageKey]) {
      useNavStore.setState({
        trash: pruneTrash(changes[trashStorageKey].newValue),
      })
    }
    if (areaName === 'local' && changes[historyStorageKey]) {
      useNavStore.setState({
        history: pruneHistory(changes[historyStorageKey].newValue),
      })
    }
    if (areaName === 'local' && changes[metadataSyncRecoveryStorageKey]) {
      useNavStore.setState({
        metadataSyncRecovery: pruneMetadataSyncRecovery(
          changes[metadataSyncRecoveryStorageKey].newValue,
        ),
      })
    }
    if (areaName === 'local' && changes[STORAGE_KEYS.usage]) {
      void useNavStore.getState().refreshUsage().catch(cause => reportExpectedFallback('usage.refresh', cause))
    }
  }
  const storageChanges = chrome.storage.onChanged
  storageChanges.addListener(onStorageChanged)
  return () => storageChanges.removeListener(onStorageChanged)
}
