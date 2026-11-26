/**
 * 舊版（yunji-tab:*）→ 目前版本（moorread:*）的儲存鍵遷移。
 *
 * 背景：更名時一次性把 chrome.storage 的鍵前綴從 `yunji-tab:` 換成 `moorread:`，
 * 當時沒有遷移，舊使用者的標籤、描述、置頂、收件匣、垃圾桶、書籤組等資料
 * 會因為鍵名不同而讀不到（看起來像資料遺失）。
 *
 * 兩階段設計（書籤組資料量大，不能每次開新分頁都重試）：
 * 1. 第一階段（自動，`runLegacyStorageMigration`）：只搬容量較小的設定與其他
 *    使用者資料；書籤組只記錄「待處理」狀態，不複製、也不寫整體完成標記。
 * 2. 第二階段（使用者主動，`migrateLegacyBookmarkGroups`）：設定頁按下按鈕後
 *    重新讀取新舊資料、重新檢查容量，逐組安全遷移；全部成功並驗證後才記錄完成。
 *
 * 設計原則：
 * 1. 只在使用者資料鍵上動手；純快取（favicon、書籤組快取、同步日誌、任務鎖）不遷移。
 * 2. 逐欄合併，不整筆覆蓋：新資料優先、舊版獨有欄位保留、集合型欄位合併去重。
 * 3. 空字串／空陣列／null 不視為有效新值；`null` 只在欄位語意上代表「刻意清空」時保留。
 * 4. 可安全重試：任何一個鍵失敗都不寫完成標記，下次再跑；已寫入的內容會被跳過。
 * 5. 不刪除任何舊鍵，也不搬動 sync→local，原始資料永遠保留。
 */

import type { BookmarkGroup, BookmarkGroupMember } from './bookmark-groups'
import type { BookmarkMeta } from './types'
import { historyStorageKey, trashStorageKey } from './activity'
import {
  bookmarkGroupsKeyPrefix,
  bookmarkGroupSourcesKey,
  decodeBookmarkGroups,
  encodeBookmarkGroup,
  parseBookmarkGroup,
} from './bookmark-groups'
import { quickSaveCategoryKey } from './quick-save'
import { STORAGE_KEYS } from './store-persistence'
import { tabSessionsStorageKey } from './tab-sessions'
import { WEBDAV_CONFIG_KEY, WEBDAV_STATUS_KEY } from './webdav-backup'

export const LEGACY_STORAGE_PREFIX = 'yunji-tab:'
export const MIGRATION_MARKER_KEY = 'moorread:storage-migration:v1'
/** 兩階段遷移狀態（第一階段完成、書籤組待處理、第二階段結果）。 */
export const MIGRATION_STATE_KEY = 'moorread:storage-migration:state'
const MIGRATION_LOCK_NAME = 'moorread:storage-migration:v1'
const BOOKMARK_GROUP_LOCK_NAME = 'moorread:storage-migration:v2'
/** 舊書籤組資料鍵前綴，例如 `yunji-tab:bookmark-group:123` */
export const LEGACY_BOOKMARK_GROUP_PREFIX = `${LEGACY_STORAGE_PREFIX}bookmark-group:`

/** Chrome `chrome.storage.sync` 官方限制。 */
export const SYNC_QUOTA_BYTES = 102400
export const SYNC_MAX_ITEMS = 512

export type StorageAreaName = 'local' | 'sync'

export interface MigrationStorage {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  /** 一次寫入多個鍵（書籤組的 manifest／分片必須同批寫入）。 */
  setAll?: (values: Record<string, unknown>) => Promise<void>
  keys: () => Promise<string[]>
  /** 整個儲存區的鍵值；缺少時以 keys + get 逐鍵補齊。 */
  getAll?: () => Promise<Record<string, unknown>>
  /** 目前佔用位元組；缺少時以鍵值內容估算。 */
  getBytesInUse?: () => Promise<number>
}

type MergeMode = 'keep-new' | 'deep' | 'meta' | 'category-meta' | 'settings' | 'usage'

export interface LegacyKeyMigration {
  legacyKey: string
  key: string
  area: StorageAreaName
  /**
   * `keep-new`：新鍵存在即保留新資料（時間序列型資料，合併會復活已清除項目）。
   * `deep`：物件逐層合併；`meta` / `category-meta` / `settings` / `usage`：依欄位語意合併。
   */
  merge: MergeMode
  /**
   * 舊版寫入方式決定 `chrome.storage` 內的實際形態：
   * `json`：經 `@plasmohq/storage` 寫入，值已被 `JSON.stringify`（字串）；
   * `raw`：經原生 `chrome.storage.*.set` 寫入，值是原始物件或字串。
   * 讀取時必須依此解碼，否則字串與物件比對會誤判成「新資料優先」而漏遷移。
   */
  serde: 'json' | 'raw'
  /**
   * 這個鍵會在遷移前由應用程式自己寫入一份「機器產生」的快照（目前只有
   * `bookmark-group-sources`：`reconcileSources()` 依瀏覽器書籤樹產生，
   * 背景 service worker 啟動時就會寫一次）。
   *
   * 在完成標記還不存在時，這個鍵的空物件 `{}` 只可能是那份預設快照，
   * 不可能是使用者資料：全專案沒有任何 UI 會清空它（見專案內呼叫點），
   * 使用者能造成的 `{}` 只會是「刪光書籤」，而那種情況 reconciliation 會在下一次
   * 寫入時重新以即時書籤樹覆蓋，不會復活資料。因此這一類空物件可以安全地
   * 讓舊值覆蓋。
   *
   * 只對這一個鍵、且舊值非空時生效；不是「所有空物件都視為不存在」的通則。
   */
  seededEmptyMeansUnset?: boolean
}

/**
 * 需要遷移的使用者資料。刻意不收錄：
 * - `yunji-tab:bookmark-groups-cache`（快取，會由來源重算）
 * - `yunji-tab:metadata-sync-log` / `-recovery`（內部診斷與復原日誌）
 * - `yunji-tab:webdav-password`（目前版本只存在 session 區，重啟即清空；搬進 local 反而會把密碼落地）
 * - `yunji-tab:home-tab-id`（目前版本只存在 session 區，屬單次瀏覽階段的暫存）
 * - `yunji-tab:bookmark-group-retired-parts` / `-url-migrations`（內部回收日誌與待辦佇列，鍵名帶舊前綴會被現行邏輯過濾）
 * - 舊書籤組（`yunji-tab:bookmark-group:*`）：改由第二階段處理，見下方說明
 * - favicon 快取（Cache Storage，非 chrome.storage 鍵）
 * - recent commands / recent triage categories / weather（可再生的介面暫存）
 */
export const LEGACY_USER_DATA_KEYS: LegacyKeyMigration[] = [
  { legacyKey: `${LEGACY_STORAGE_PREFIX}meta`, key: STORAGE_KEYS.meta, area: 'local', merge: 'meta', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}category-meta`, key: STORAGE_KEYS.categoryMeta, area: 'local', merge: 'category-meta', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}settings`, key: STORAGE_KEYS.settings, area: 'sync', merge: 'settings', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}usage`, key: STORAGE_KEYS.usage, area: 'local', merge: 'usage', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}tasks`, key: STORAGE_KEYS.tasks, area: 'local', merge: 'keep-new', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}metadata-sync-passphrase`, key: STORAGE_KEYS.metadataSyncPassphrase, area: 'local', merge: 'keep-new', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}trash`, key: trashStorageKey, area: 'local', merge: 'keep-new', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}history`, key: historyStorageKey, area: 'local', merge: 'keep-new', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}tab-sessions`, key: tabSessionsStorageKey, area: 'local', merge: 'keep-new', serde: 'json' },
  // 這兩鍵在舊版是原生 chrome.storage 寫入：quick-save-category 為原始字串、
  // bookmark-group-sources 為原始物件，不可當 JSON 字串解析。
  { legacyKey: `${LEGACY_STORAGE_PREFIX}quick-save-category`, key: quickSaveCategoryKey, area: 'local', merge: 'keep-new', serde: 'raw' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}bookmark-group-sources`, key: bookmarkGroupSourcesKey, area: 'local', merge: 'keep-new', serde: 'raw', seededEmptyMeansUnset: true },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}ai-settings`, key: 'moorread:ai-settings', area: 'local', merge: 'deep', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}ai-token`, key: 'moorread:ai-token', area: 'local', merge: 'keep-new', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}webdav-config`, key: WEBDAV_CONFIG_KEY, area: 'local', merge: 'deep', serde: 'json' },
  { legacyKey: `${LEGACY_STORAGE_PREFIX}webdav-status`, key: WEBDAV_STATUS_KEY, area: 'local', merge: 'keep-new', serde: 'json' },
]

// ---------------------------------------------------------------------------
// 欄位合併規則（對照表見報告；語意皆以現行資料模型的寫入路徑為依據）
// ---------------------------------------------------------------------------

type FieldKind = 'string-set' | 'array-by-id' | 'number-max' | 'ordered-array' | 'clearable'

interface FieldRule {
  kind?: FieldKind
  fields?: FieldRules
}

type FieldRules = Record<string, FieldRule>

/** 書籤補充資料：標籤／備用網址是集合，置頂與收件匣時間取較新者。 */
const META_RULES: FieldRules = {
  tags: { kind: 'string-set' },
  alternateUrls: { kind: 'string-set' },
  pinnedAt: { kind: 'number-max' },
  inboxAt: { kind: 'number-max' },
}

/**
 * 設定：清單型欄位合併去重；`headerWidget.location` 的 `null` 代表使用者
 * 刻意清空地點（現行寫入路徑確實會寫 `null`），因此保留 `null`。
 */
const SETTINGS_RULES: FieldRules = {
  descriptionIgnoredDomains: { kind: 'string-set' },
  customSearchEngines: { kind: 'array-by-id' },
  savedSearches: { kind: 'array-by-id' },
  autoOrganizeRules: { kind: 'array-by-id' },
  headerWidget: { fields: { location: { kind: 'clearable' } } },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type DecodedValue = { ok: true, value: unknown } | { ok: false }

/**
 * `@plasmohq/storage` 以 JSON 字串存放；遷移必須先解碼再比對／合併。
 * 非字串（含 `undefined`）代表尚未寫入或原生寫入，原樣回傳；
 * 字串無法解析時回報失敗，交由呼叫端保留舊鍵、下次重試，**不猜測內容**。
 */
function decodeStoredValue(raw: unknown): DecodedValue {
  if (typeof raw !== 'string')
    return { ok: true, value: raw }
  try {
    return { ok: true, value: JSON.parse(raw) }
  }
  catch {
    return { ok: false }
  }
}

/** 寫回時還原成該鍵在 `chrome.storage` 內應有的形態。 */
function encodeStoredValue(serde: 'json' | 'raw', value: unknown): unknown {
  return serde === 'json' ? JSON.stringify(value) : value
}

/** 空字串、空陣列、null 都不算「有效的新值」。 */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === ''
    || (Array.isArray(value) && value.length === 0)
}

function unionStrings(legacy: unknown[], current: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of [...current, ...legacy]) {
    if (typeof item !== 'string')
      continue
    const value = item.trim()
    if (!value || seen.has(value))
      continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function unionById(legacy: unknown[], current: unknown[]): unknown[] {
  const out: unknown[] = []
  const seen = new Set<string>()
  for (const item of [...current, ...legacy]) {
    const id = isPlainObject(item) && typeof item.id === 'string' ? item.id : undefined
    if (id === undefined) {
      out.push(item)
      continue
    }
    if (seen.has(id))
      continue
    seen.add(id)
    out.push(item)
  }
  return out
}

function mergeValue(rule: FieldRule | undefined, legacy: unknown, current: unknown): unknown {
  if (rule?.kind === 'clearable' && current === null)
    return null
  if (current === undefined)
    return legacy
  if (legacy === undefined)
    return current

  if (rule?.kind === 'number-max' && typeof legacy === 'number' && typeof current === 'number')
    return Math.max(legacy, current)

  if (isPlainObject(legacy) && isPlainObject(current))
    return mergeRecord(legacy, current, rule?.fields)

  if (Array.isArray(legacy) && Array.isArray(current)) {
    if (rule?.kind === 'string-set')
      return unionStrings(legacy, current)
    if (rule?.kind === 'array-by-id')
      return unionById(legacy, current)
    // 其他陣列（含有序清單）：新資料非空時以新資料為準。
    return current.length ? current : legacy
  }

  return isEmptyValue(current) ? legacy : current
}

function mergeRecord(
  legacy: Record<string, unknown>,
  current: Record<string, unknown>,
  rules: FieldRules = {},
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...legacy }
  for (const [key, value] of Object.entries(current))
    merged[key] = mergeValue(rules[key], merged[key], value)
  return merged
}

function mergeMeta(
  legacy: Record<string, BookmarkMeta>,
  current: Record<string, BookmarkMeta>,
): Record<string, BookmarkMeta> {
  const merged: Record<string, BookmarkMeta> = { ...legacy }
  for (const [url, record] of Object.entries(current)) {
    const legacyRecord = legacy[url]
    if (!isPlainObject(legacyRecord)) {
      merged[url] = record
      continue
    }
    const next = mergeRecord(
      legacyRecord as Record<string, unknown>,
      record as Record<string, unknown>,
      META_RULES,
    ) as BookmarkMeta
    // 現行寫入路徑在重新釘選／取消釘選時會移除 pinnedOrder；
    // 新版有 pinnedAt 但沒有 pinnedOrder 時，不可把舊的排序帶回來。
    if (Object.hasOwn(record, 'pinnedAt') && !Object.hasOwn(record, 'pinnedOrder'))
      delete next.pinnedOrder
    merged[url] = next
  }
  return merged
}

function mergeByKeyRecord(
  legacy: unknown,
  current: unknown,
  rules: FieldRules,
): Record<string, unknown> {
  if (!isPlainObject(current))
    return isPlainObject(legacy) ? { ...legacy } : {}
  if (!isPlainObject(legacy))
    return current
  const merged: Record<string, unknown> = { ...legacy }
  for (const [key, value] of Object.entries(current)) {
    const legacyValue = legacy[key]
    merged[key] = isPlainObject(legacyValue) && isPlainObject(value)
      ? mergeRecord(legacyValue, value, rules)
      : value
  }
  return merged
}

const CATEGORY_META_RULES: FieldRules = {}
const USAGE_RULES: FieldRules = { openCount: { kind: 'number-max' }, lastOpenedAt: { kind: 'number-max' } }

function mergeForMode(mode: MergeMode, legacy: unknown, current: unknown): unknown {
  switch (mode) {
    case 'meta':
      return isPlainObject(legacy) && isPlainObject(current)
        ? mergeMeta(legacy as Record<string, BookmarkMeta>, current as Record<string, BookmarkMeta>)
        : current
    case 'category-meta':
      return mergeByKeyRecord(legacy, current, CATEGORY_META_RULES)
    case 'usage':
      return mergeByKeyRecord(legacy, current, USAGE_RULES)
    case 'settings':
      return isPlainObject(legacy) && isPlainObject(current)
        ? mergeRecord(legacy, current, SETTINGS_RULES)
        : current
    case 'deep':
      return isPlainObject(legacy) && isPlainObject(current)
        ? mergeRecord(legacy, current)
        : current
    case 'keep-new':
    default:
      return current
  }
}

// ---------------------------------------------------------------------------
// 儲存區存取
// ---------------------------------------------------------------------------

function createChromeArea(area: StorageAreaName): MigrationStorage {
  const getArea = () => globalThis.chrome?.storage?.[area]

  return {
    async get(key) {
      const store = getArea()
      if (!store?.get)
        throw new Error('storage-unavailable')
      const result = await store.get(key)
      return result?.[key]
    },
    async set(key, value) {
      const store = getArea()
      if (!store?.set)
        throw new Error('storage-unavailable')
      await store.set({ [key]: value })
    },
    async setAll(values) {
      const store = getArea()
      if (!store?.set)
        throw new Error('storage-unavailable')
      await store.set(values)
    },
    async keys() {
      const all = await this.getAll?.()
      return Object.keys(all ?? {})
    },
    async getAll() {
      const store = getArea()
      if (!store?.get)
        throw new Error('storage-unavailable')
      return (await store.get(null)) ?? {}
    },
    async getBytesInUse() {
      const store = getArea()
      if (!store?.getBytesInUse)
        throw new Error('bytes-unavailable')
      return await store.getBytesInUse(null)
    },
  }
}

async function readAll(store: MigrationStorage): Promise<Record<string, unknown>> {
  if (store.getAll)
    return store.getAll()
  const keys = await store.keys()
  const entries = await Promise.all(keys.map(async key => [key, await store.get(key)] as const))
  return Object.fromEntries(entries)
}

async function writeKeys(store: MigrationStorage, values: Record<string, unknown>): Promise<void> {
  if (store.setAll) {
    await store.setAll(values)
    return
  }
  for (const [key, value] of Object.entries(values))
    await store.set(key, value)
}

function syncBytes(values: Record<string, unknown>): number {
  const encoder = new TextEncoder()
  let total = 0
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined)
      continue
    total += encoder.encode(key + (JSON.stringify(value) ?? 'null')).length
  }
  return total
}

function encodedBytes(encoded: Record<string, unknown>): number {
  return syncBytes(encoded)
}

async function usedBytes(store: MigrationStorage, values: Record<string, unknown>): Promise<number> {
  if (store.getBytesInUse) {
    try {
      const bytes = await store.getBytesInUse()
      if (typeof bytes === 'number' && bytes >= 0)
        return bytes
    }
    catch { /* 退回以內容估算 */ }
  }
  return syncBytes(values)
}

function newGeneration(): string {
  return globalThis.crypto?.randomUUID?.() ?? `mig-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

// ---------------------------------------------------------------------------
// 鎖
// ---------------------------------------------------------------------------

export class MigrationLockUnavailableError extends Error {}

/**
 * 多個新分頁可能同時啟動，用 Web Lock 序列化，避免兩個分頁同時「讀舊值 →
 * 合併 → 寫新值」而互相覆蓋。環境沒有 Web Locks（測試／舊版）時直接執行；
 * 有 Web Locks 但取鎖失敗時回報錯誤，不冒險並行寫入。
 */
async function withMigrationLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  if (!locks?.request)
    return task()
  let entered = false
  try {
    return await locks.request(name, async () => {
      entered = true
      return task()
    })
  }
  catch (error) {
    if (entered)
      throw error
    throw new MigrationLockUnavailableError('lock-unavailable')
  }
}

// ---------------------------------------------------------------------------
// 第一階段：小鍵自動遷移
// ---------------------------------------------------------------------------

export type MigrationStatus
  = | 'unavailable'
    | 'already-migrated'
    | 'nothing-to-migrate'
    | 'migrated'
    | 'partial'

export interface MigrationResult {
  status: MigrationStatus
  /** 實際寫入的新鍵 */
  migrated: string[]
  /** 舊鍵有值、但新鍵已有較新資料所以保留新資料 */
  keptNew: string[]
  /** 寫入失敗的新鍵（下次啟動會重試） */
  failed: string[]
  /** 是否有鍵沒能完整處理（例如列舉 sync 鍵失敗），不寫完成標記 */
  incomplete: boolean
  /** 第一階段完成標記是否寫入成功（不代表書籤組已完成） */
  marked: boolean
  /** 尚未遷移的舊書籤組 id（第二階段待處理） */
  pendingGroups: string[]
}

interface StoredMigrationState {
  phase1?: 'partial' | 'complete'
  phase1At?: string
  phase2?: 'pending' | 'partial' | 'insufficient-space' | 'complete'
  pendingGroups?: string[]
  completedGroups?: string[]
  failedGroups?: string[]
  updatedAt?: string
}

function emptyResult(status: MigrationStatus): MigrationResult {
  return {
    status,
    migrated: [],
    keptNew: [],
    failed: [],
    incomplete: false,
    marked: false,
    pendingGroups: [],
  }
}

async function readState(local: MigrationStorage): Promise<StoredMigrationState> {
  try {
    const stored = await local.get(MIGRATION_STATE_KEY)
    return isPlainObject(stored) ? stored as StoredMigrationState : {}
  }
  catch {
    return {}
  }
}

/** 舊書籤組的 manifest 鍵（每個群組一個），排除分片鍵。 */
function legacyGroupIds(keys: string[]): string[] {
  return keys
    .filter(key => key.startsWith(LEGACY_BOOKMARK_GROUP_PREFIX))
    .map(key => key.slice(LEGACY_BOOKMARK_GROUP_PREFIX.length))
    .filter(id => !!id && !id.includes(':'))
    .sort()
}

/** 把舊前綴的所有書籤組鍵轉成目前前綴後解碼。 */
function decodeLegacyGroups(values: Record<string, unknown>): BookmarkGroup[] {
  const renamed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(LEGACY_BOOKMARK_GROUP_PREFIX))
      continue
    renamed[`${bookmarkGroupsKeyPrefix}${key.slice(LEGACY_BOOKMARK_GROUP_PREFIX.length)}`] = value
  }
  return decodeBookmarkGroups(renamed)
}

function migrateOne(
  task: LegacyKeyMigration,
  legacyValue: unknown,
  currentValue: unknown,
): { next: unknown, write: boolean } {
  if (currentValue === undefined)
    return { next: legacyValue, write: true }
  // 初始化流程預先建立的預設空物件（見 `seededEmptyMeansUnset`）不算新資料。
  // 只有舊值非空時才覆蓋；兩邊都空時維持原本的「保留新值」。
  if (task.seededEmptyMeansUnset
    && isPlainObject(currentValue) && Object.keys(currentValue).length === 0
    && isPlainObject(legacyValue) && Object.keys(legacyValue).length > 0) {
    return { next: legacyValue, write: true }
  }
  if (task.merge === 'keep-new')
    return { next: currentValue, write: false }
  const merged = mergeForMode(task.merge, legacyValue, currentValue)
  const changed = JSON.stringify(merged) !== JSON.stringify(currentValue)
  return { next: merged, write: changed }
}

/**
 * 第一階段：自動遷移容量較小、可安全合併的資料。
 * 書籤組只記錄待處理狀態，不複製；因此第一階段完成 **不代表** 整體遷移完成。
 */
export async function runLegacyStorageMigration(
  ports?: { local?: MigrationStorage, sync?: MigrationStorage },
): Promise<MigrationResult> {
  const local = ports?.local ?? createChromeArea('local')
  const sync = ports?.sync ?? createChromeArea('sync')
  try {
    return await withMigrationLock(MIGRATION_LOCK_NAME, () => runMigration(local, sync))
  }
  catch {
    // 取鎖失敗或非預期錯誤：不寫任何標記，下次啟動再試。
    return emptyResult('unavailable')
  }
}

async function runMigration(local: MigrationStorage, sync: MigrationStorage): Promise<MigrationResult> {
  const result = emptyResult('unavailable')

  // --- 前置檢查：storage 是否可用 / 是否已完成 ---------------------------
  let marker: unknown
  try {
    marker = await local.get(MIGRATION_MARKER_KEY)
    await local.keys()
  }
  catch {
    return emptyResult('unavailable')
  }
  if (marker !== undefined) {
    result.status = 'already-migrated'
    result.pendingGroups = (await readState(local)).pendingGroups ?? []
    return result
  }

  const areaOf = (name: StorageAreaName) => (name === 'local' ? local : sync)

  // --- 先記錄書籤組待處理清單（不複製內容） ------------------------------
  let pendingGroups: string[] = []
  try {
    pendingGroups = legacyGroupIds(await sync.keys())
  }
  catch {
    // 列舉失敗時仍要遷移能處理的靜態鍵，但**不可**寫完成標記，否則舊書籤組
    // 資料會被永久跳過。改記為 incomplete，下次啟動重試。
    result.incomplete = true
  }

  // --- 逐鍵遷移（單鍵失敗不影響其他鍵） ---------------------------------
  let sawLegacy = false
  for (const task of LEGACY_USER_DATA_KEYS) {
    const store = areaOf(task.area)
    let legacyValue: unknown
    try {
      legacyValue = await store.get(task.legacyKey)
    }
    catch {
      result.failed.push(task.key)
      continue
    }
    if (legacyValue === undefined)
      continue

    sawLegacy = true
    try {
      const currentValue = await store.get(task.key)
      const legacy = task.serde === 'json' ? decodeStoredValue(legacyValue) : { ok: true as const, value: legacyValue }
      const current = task.serde === 'json' ? decodeStoredValue(currentValue) : { ok: true as const, value: currentValue }
      // 舊鍵或新鍵內容無法解析：不寫入、不寫完成標記，保留原始資料待下次重試。
      if (!legacy.ok || !current.ok) {
        result.failed.push(task.key)
        continue
      }
      const { next, write } = migrateOne(task, legacy.value, current.value)
      if (!write) {
        result.keptNew.push(task.key)
        continue
      }
      const encoded = encodeStoredValue(task.serde, next)
      await store.set(task.key, encoded)
      // 寫入後讀回驗證；不一致視為失敗，不寫完成標記，下次啟動重試。
      const written = await store.get(task.key)
      const readBack = task.serde === 'json' ? decodeStoredValue(written) : { ok: true as const, value: written }
      if (!readBack.ok || JSON.stringify(readBack.value) !== JSON.stringify(next)) {
        result.failed.push(task.key)
        continue
      }
      result.migrated.push(task.key)
    }
    catch {
      result.failed.push(task.key)
    }
  }

  // --- 完成標記（只代表第一階段） ---------------------------------------
  if (!sawLegacy && pendingGroups.length === 0) {
    result.status = 'nothing-to-migrate'
    return result
  }
  // 只有「每個鍵都處理完、且沒有列舉缺口」才寫第一階段標記，避免部分成功就永久跳過。
  const complete = result.failed.length === 0 && !result.incomplete
  if (complete) {
    try {
      await local.set(MIGRATION_MARKER_KEY, {
        version: 1,
        phase: 1,
        completedAt: new Date().toISOString(),
        keys: result.migrated,
        // 第一階段結束當下的待處理書籤組「歷史快照」，不是權威待辦清單。
        // 第二階段完成後只更新 `MIGRATION_STATE_KEY.pendingGroups`（清空），
        // 不回寫此標記；面板與重試判斷一律讀 state，無人依賴這個欄位。
        pendingBookmarkGroups: pendingGroups,
      })
      result.marked = true
    }
    catch {
      result.marked = false
    }
  }

  result.status = complete ? 'migrated' : 'partial'
  result.pendingGroups = pendingGroups
  const state = await readState(local)
  await local.set(MIGRATION_STATE_KEY, {
    ...state,
    phase1: complete ? 'complete' : 'partial',
    phase1At: complete ? new Date().toISOString() : state.phase1At,
    pendingGroups,
    completedGroups: state.completedGroups ?? [],
    failedGroups: state.failedGroups ?? [],
    // 列舉失敗時無法確認是否還有舊書籤組，不可記為完成。
    phase2: result.incomplete
      ? 'pending'
      : pendingGroups.length
        ? (state.phase2 === 'complete' ? 'complete' : 'pending')
        : 'complete',
    updatedAt: new Date().toISOString(),
  }).catch(() => undefined)
  return result
}

// ---------------------------------------------------------------------------
// 第二階段：書籤組由使用者主動遷移
// ---------------------------------------------------------------------------

export interface BookmarkGroupPlan {
  id: string
  legacy: BookmarkGroup
  merged: BookmarkGroup
  /** 目前資料已等於合併結果，不需要再寫入 */
  upToDate: boolean
}

export interface MigrationSummary {
  /** `not-started`：尚未跑過第一階段；`partial`：第一階段有鍵失敗，下次啟動重試 */
  phase1: 'not-started' | 'partial' | 'complete'
  phase2: 'not-needed' | 'pending' | 'partial' | 'insufficient-space' | 'complete'
  pendingGroupCount: number
  /** 尚未遷移資料量（書籤組成員數） */
  pendingBookmarkCount: number
  /** 預估第二階段需要寫入的位元組（含一次性替換備用空間） */
  pendingBytes: number
  availableBytes: number
  quotaBytes: number
  failedGroups: string[]
  reason: 'no-pending' | 'insufficient-space' | 'unavailable' | null
}

export interface BookmarkGroupMigrationReport extends MigrationSummary {
  migrated: string[]
  skipped: string[]
  failed: string[]
}

function mergeGroupMembers(
  legacy: BookmarkGroupMember[],
  current: BookmarkGroupMember[],
): BookmarkGroupMember[] {
  const out = [...current]
  const urls = new Set(current.map(member => member.url))
  const ids = new Set(current.map(member => member.id).filter((id): id is string => typeof id === 'string' && !!id))
  for (const member of legacy) {
    if (urls.has(member.url))
      continue
    if (member.id && ids.has(member.id))
      continue
    urls.add(member.url)
    if (member.id)
      ids.add(member.id)
    out.push(member)
  }
  return out
}

/** 書籤組逐欄合併：新版優先、舊版獨有欄位保留、成員合併去重。 */
export function mergeBookmarkGroups(legacy: BookmarkGroup, current?: BookmarkGroup): BookmarkGroup {
  if (!current)
    return legacy
  const merged = parseBookmarkGroup({
    ...legacy,
    ...current,
    id: legacy.id,
    title: current.title.trim() ? current.title : legacy.title,
    description: current.description.trim() ? current.description : legacy.description,
    icon: current.icon ?? legacy.icon ?? '',
    pinnedAt: Math.max(current.pinnedAt ?? 0, legacy.pinnedAt ?? 0) || undefined,
    sortOrder: current.sortOrder ?? legacy.sortOrder,
    pinnedOrder: current.pinnedOrder ?? legacy.pinnedOrder,
    bookmarks: mergeGroupMembers(legacy.bookmarks, current.bookmarks),
  })
  return merged ?? legacy
}

function sameGroup(left: BookmarkGroup, right: BookmarkGroup): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function planGroups(
  legacyGroups: BookmarkGroup[],
  currentGroups: BookmarkGroup[],
  completed: Set<string>,
): BookmarkGroupPlan[] {
  return legacyGroups.map((legacy) => {
    const current = currentGroups.find(group => group.id === legacy.id)
    const merged = mergeBookmarkGroups(legacy, current)
    const upToDate = completed.has(legacy.id) || (current !== undefined && sameGroup(current, merged))
    return { id: legacy.id, legacy, merged, upToDate }
  })
}

function summarize(
  plans: BookmarkGroupPlan[],
  used: number,
  state: StoredMigrationState,
): MigrationSummary {
  const pendingPlans = plans.filter(plan => !plan.upToDate)
  const pendingBytes = pendingPlans.reduce(
    (total, plan) => total + encodedBytes(encodeBookmarkGroup(plan.merged, 'estimate')),
    0,
  )
  // 與 `assertBookmarkGroupCapacity` 一致：多留一份替換世代，避免遷移完成後
  // 使用者第一次編輯就超過配額。
  const required = pendingBytes * 2
  const availableBytes = Math.max(0, SYNC_QUOTA_BYTES - used)
  const phase2: MigrationSummary['phase2'] = plans.length === 0
    ? 'not-needed'
    : pendingPlans.length === 0
      ? 'complete'
      : availableBytes < required
        ? 'insufficient-space'
        : state.failedGroups?.length
          ? 'partial'
          : 'pending'
  return {
    phase1: state.phase1 === 'complete' ? 'complete' : state.phase1 === 'partial' ? 'partial' : 'not-started',
    phase2,
    pendingGroupCount: pendingPlans.length,
    pendingBookmarkCount: pendingPlans.reduce((total, plan) => total + plan.merged.bookmarks.length, 0),
    pendingBytes,
    availableBytes,
    quotaBytes: SYNC_QUOTA_BYTES,
    failedGroups: plans.filter(plan => state.failedGroups?.includes(plan.id) && !plan.upToDate).map(plan => plan.id),
    reason: plans.length === 0 || pendingPlans.length === 0
      ? 'no-pending'
      : availableBytes < required
        ? 'insufficient-space'
        : null,
  }
}

/**
 * 重新讀取新舊資料並計算第二階段狀態。設定頁顯示的資料量／可用空間
 * 一律以此為準，不依賴頁面載入時的舊估算。
 */
export async function inspectLegacyBookmarkGroupMigration(
  ports?: { local?: MigrationStorage, sync?: MigrationStorage },
): Promise<MigrationSummary> {
  const local = ports?.local ?? createChromeArea('local')
  const sync = ports?.sync ?? createChromeArea('sync')
  try {
    const [state, values] = await Promise.all([readState(local), readAll(sync)])
    const completed = new Set(state.completedGroups ?? [])
    const plans = planGroups(decodeLegacyGroups(values), decodeBookmarkGroups(values), completed)
    return summarize(plans, await usedBytes(sync, values), state)
  }
  catch {
    return {
      phase1: 'not-started',
      phase2: 'pending',
      pendingGroupCount: 0,
      pendingBookmarkCount: 0,
      pendingBytes: 0,
      availableBytes: 0,
      quotaBytes: SYNC_QUOTA_BYTES,
      failedGroups: [],
      reason: 'unavailable',
    }
  }
}

function isQuotaError(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause)
  return /quota|MAX_WRITE_OPERATIONS|MAX_ITEMS/i.test(message)
}

/**
 * 第二階段：由使用者主動觸發。
 * 每次執行都重新讀取新舊資料、重新檢查容量；逐組寫入並驗證，單組失敗
 * 保留其他已完成結果；全部驗證通過才記錄完成。
 */
export async function migrateLegacyBookmarkGroups(
  ports?: { local?: MigrationStorage, sync?: MigrationStorage },
): Promise<BookmarkGroupMigrationReport> {
  const local = ports?.local ?? createChromeArea('local')
  const sync = ports?.sync ?? createChromeArea('sync')
  try {
    return await withMigrationLock(BOOKMARK_GROUP_LOCK_NAME, () => runBookmarkGroupMigration(local, sync))
  }
  catch {
    const summary = await inspectLegacyBookmarkGroupMigration({ local, sync })
    return { ...summary, reason: 'unavailable', migrated: [], skipped: [], failed: [] }
  }
}

async function persistState(local: MigrationStorage, state: StoredMigrationState): Promise<void> {
  await local.set(MIGRATION_STATE_KEY, { ...state, updatedAt: new Date().toISOString() }).catch(() => undefined)
}

async function runBookmarkGroupMigration(
  local: MigrationStorage,
  sync: MigrationStorage,
): Promise<BookmarkGroupMigrationReport> {
  const migrated: string[] = []
  const skipped: string[] = []
  const failed: string[] = []
  let state = await readState(local)
  let values: Record<string, unknown>
  try {
    values = await readAll(sync)
  }
  catch {
    return {
      ...(await inspectLegacyBookmarkGroupMigration({ local, sync })),
      reason: 'unavailable',
      migrated,
      skipped,
      failed,
    }
  }
  const completed = new Set(state.completedGroups ?? [])
  const plans = planGroups(decodeLegacyGroups(values), decodeBookmarkGroups(values), completed)

  if (!plans.length) {
    await persistState(local, { ...state, phase2: 'complete', pendingGroups: [], completedGroups: [...completed], updatedAt: new Date().toISOString() })
    return {
      phase1: state.phase1 === 'complete' ? 'complete' : state.phase1 === 'partial' ? 'partial' : 'not-started',
      phase2: 'not-needed',
      pendingGroupCount: 0,
      pendingBookmarkCount: 0,
      pendingBytes: 0,
      availableBytes: Math.max(0, SYNC_QUOTA_BYTES - syncBytes(values)),
      quotaBytes: SYNC_QUOTA_BYTES,
      failedGroups: [],
      reason: 'no-pending',
      migrated,
      skipped,
      failed,
    }
  }

  // 已同步一致的組別直接記為完成，不重複寫入。
  for (const plan of plans) {
    if (!plan.upToDate)
      continue
    completed.add(plan.id)
    skipped.push(plan.id)
  }
  state = { ...state, completedGroups: [...completed] }
  await persistState(local, state)

  let reason: MigrationSummary['reason'] = null
  for (const plan of plans) {
    if (plan.upToDate)
      continue
    // 逐項重新讀取：其他分頁或使用者的變更不會被舊快照覆蓋。
    try {
      values = await readAll(sync)
    }
    catch {
      failed.push(plan.id)
      reason = 'unavailable'
      break
    }
    const current = decodeBookmarkGroups(values).find(group => group.id === plan.id)
    const merged = mergeBookmarkGroups(plan.legacy, current)
    if (current && sameGroup(current, merged)) {
      completed.add(plan.id)
      skipped.push(plan.id)
      state = { ...state, completedGroups: [...completed] }
      await persistState(local, state)
      continue
    }

    const encoded = encodeBookmarkGroup(merged, newGeneration())
    const extraBytes = encodedBytes(encoded)
    const used = await usedBytes(sync, values)
    const itemCount = Object.keys(values).length + Object.keys(encoded).length
    if (used + extraBytes * 2 > SYNC_QUOTA_BYTES || itemCount > SYNC_MAX_ITEMS) {
      reason = 'insufficient-space'
      break
    }

    try {
      await writeKeys(sync, encoded)
    }
    catch (error) {
      // 實際寫入仍可能因配額或寫入頻率失敗：停止並如實回報，不假裝完成。
      if (isQuotaError(error)) {
        reason = 'insufficient-space'
        break
      }
      failed.push(plan.id)
      continue
    }

    // 驗證：重新讀回 manifest 與分片，確認內容與合併結果一致才算成功。
    let verified: BookmarkGroup | undefined
    try {
      verified = decodeBookmarkGroups(await readAll(sync)).find(group => group.id === plan.id)
    }
    catch {
      verified = undefined
    }
    if (!verified || !sameGroup(verified, merged)) {
      failed.push(plan.id)
      continue
    }
    completed.add(plan.id)
    migrated.push(plan.id)
    state = { ...state, completedGroups: [...completed] }
    await persistState(local, state)
  }

  const after = await inspectLegacyBookmarkGroupMigration({ local, sync })
  const pending = after.pendingGroupCount > 0
  const phase2: MigrationSummary['phase2'] = !pending
    ? 'complete'
    : reason === 'insufficient-space'
      ? 'insufficient-space'
      : 'partial'
  const nextState: StoredMigrationState = {
    ...state,
    phase2,
    pendingGroups: [],
    completedGroups: [...completed],
    failedGroups: failed,
  }
  await persistState(local, nextState)
  return {
    ...after,
    phase2,
    failedGroups: failed,
    reason: pending ? reason : 'no-pending',
    migrated,
    skipped,
    failed,
  }
}
