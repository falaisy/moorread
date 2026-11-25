import type { Category, Settings } from './types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runNewtabStartup } from './newtab-startup'
import { useNavStore } from './store'
import { settingsStorage, STORAGE_KEYS } from './store-persistence'
import { normalizeSettings } from './store-settings-state'

const storageState = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
}))

vi.mock('@plasmohq/storage', () => ({
  Storage: class Storage {
    area: string

    constructor(options: { area: string }) {
      this.area = options.area
    }

    async get(key: string) {
      return structuredClone(storageState.values.get(`${this.area}:${key}`))
    }

    async set(key: string, value: unknown) {
      storageState.values.set(`${this.area}:${key}`, structuredClone(value))
    }

    async remove(key: string) {
      storageState.values.delete(`${this.area}:${key}`)
    }
  },
}))

const initialState = useNavStore.getInitialState()

const categories: Category[] = [
  { id: 'cat-1', name: 'Bookmarks bar', emoji: '📁', parentId: 'all', modifiable: true },
  { id: 'cat-5', name: 'Reading', emoji: '📚', parentId: 'all', modifiable: true },
]

function withDefaultCategory(defaultCategoryId: string) {
  useNavStore.setState({
    settings: { ...useNavStore.getState().settings, defaultCategoryId },
    categories,
  })
}

beforeEach(() => {
  storageState.values.clear()
  useNavStore.setState(initialState, true)
  vi.stubGlobal('chrome', { bookmarks: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('applyDefaultCategory 與使用者主動選分類的競態', () => {
  it('未互動 → 載入完成後套用預設分類', () => {
    withDefaultCategory('cat-5')
    expect(useNavStore.getState().activeCategoryId).toBe('all')

    useNavStore.getState().applyDefaultCategory()

    expect(useNavStore.getState().activeCategoryId).toBe('cat-5')
  })

  it('載入完成前主動選 inbox → 載入完成後仍為 inbox', () => {
    withDefaultCategory('cat-5')
    // 載入期間分類清單尚未就緒，側欄已可點；使用者選了收件匣。
    useNavStore.setState({ categories: [] })
    useNavStore.getState().setActiveCategory('inbox')
    // 分類載入完成，啟動序列接著套用預設分類。
    useNavStore.setState({ categories })

    useNavStore.getState().applyDefaultCategory()

    expect(useNavStore.getState().activeCategoryId).toBe('inbox')
  })

  it('啟動序列結束後保留載入期間的選擇，且工具列條件（inbox）成立', async () => {
    withDefaultCategory('cat-5')
    let finishLoad!: () => void
    let onLoaded!: () => void
    const loading = new Promise<void>((resolve) => {
      finishLoad = resolve
    })
    const loaded = new Promise<void>((resolve) => {
      onLoaded = resolve
    })

    const startup = runNewtabStartup({
      isActive: () => true,
      load: async () => {
        useNavStore.setState({ categories: [] })
        await loading
        useNavStore.setState({ categories })
      },
      applyDefaultCategory: () => useNavStore.getState().applyDefaultCategory(),
      syncMetadataNow: async () => {},
      onLoaded,
    })

    // 骨架屏仍在顯示時使用者主動選了收件匣。
    useNavStore.getState().setActiveCategory('inbox')
    finishLoad()
    await loaded
    await startup

    expect(useNavStore.getState().activeCategoryId).toBe('inbox')
  })

  // HQ 定案一：手動選過分類後，設定頁修改預設分類不得覆蓋目前畫面的分類。
  it('手動選過分類後，設定頁改預設分類只更新設定、不覆蓋目前畫面', async () => {
    withDefaultCategory('cat-5')
    useNavStore.getState().applyDefaultCategory()
    useNavStore.getState().setActiveCategory('inbox')

    // 另一個分頁的設定頁把預設分類改成 cat-1。
    await useNavStore.getState().setDefaultCategory('cat-1')

    expect(useNavStore.getState().settings.defaultCategoryId).toBe('cat-1')
    expect(useNavStore.getState().activeCategoryId).toBe('inbox')

    // 本頁收到 storage 變更後會再次呼叫 applyDefaultCategory：仍不得覆蓋。
    useNavStore.getState().applyDefaultCategory()
    expect(useNavStore.getState().activeCategoryId).toBe('inbox')

    // 新預設已寫入共用設定，供之後新開的分頁使用。
    const persisted = await settingsStorage.get<Settings>(STORAGE_KEYS.settings)
    expect(persisted?.defaultCategoryId).toBe('cat-1')
  })

  // HQ 定案二：新開分頁時使用最新的預設分類。
  it('新開分頁載入完成後套用最新持久化的預設分類', async () => {
    await useNavStore.getState().setDefaultCategory('cat-5')

    // 模擬新分頁：全新的 store（尚未互動），只從共用 storage 還原設定。
    useNavStore.setState(initialState, true)
    expect(useNavStore.getState().categorySelectionTouched).toBe(false)

    await runNewtabStartup({
      isActive: () => true,
      load: async () => {
        const persisted = await settingsStorage.get<Settings>(STORAGE_KEYS.settings)
        useNavStore.setState({
          settings: normalizeSettings(persisted),
          categories,
        })
      },
      applyDefaultCategory: () => useNavStore.getState().applyDefaultCategory(),
      syncMetadataNow: async () => {},
      onLoaded: () => {},
    })

    expect(useNavStore.getState().activeCategoryId).toBe('cat-5')
  })

  it('載入完成後選分類 → 再次套用預設分類也不覆蓋', () => {
    withDefaultCategory('cat-5')
    useNavStore.getState().applyDefaultCategory()
    expect(useNavStore.getState().activeCategoryId).toBe('cat-5')

    useNavStore.getState().setActiveCategory('cat-1')
    // 例如另一個分頁修改了預設分類，本頁收到 storage 變更後再次套用。
    useNavStore.getState().applyDefaultCategory()

    expect(useNavStore.getState().activeCategoryId).toBe('cat-1')
  })
})
