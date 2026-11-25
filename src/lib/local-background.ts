/**
 * 本機新分頁背景。
 *
 * 圖片本體存 Cache Storage（`moorread:background:v1`，單一固定 key），
 * `chrome.storage.local` 只存小型啟用旗標與必要中繼資料。
 * 兩者不一致時一律安全退回停用，不影響既有主題與 palette 快取。
 */

export const LOCAL_BACKGROUND_CACHE = 'moorread:background:v1'
export const LOCAL_BACKGROUND_CACHE_KEY = 'https://moorread.local/local-background'
export const LOCAL_BACKGROUND_META_KEY = 'moorread:local-background'
export const LOCAL_BACKGROUND_META_VERSION = 1
export const LOCAL_BACKGROUND_MAX_BYTES = 8 * 1024 * 1024
export const LOCAL_BACKGROUND_MAX_DIMENSION = 8192

export const LOCAL_BACKGROUND_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const

export type LocalBackgroundMime = (typeof LOCAL_BACKGROUND_MIME_TYPES)[number]

export type LocalBackgroundErrorCode
  = | 'unsupported-format'
    | 'too-large'
    | 'empty-file'
    | 'decode-failed'
    | 'dimensions-too-large'
    | 'cache-unavailable'
    | 'read-failed'
    | 'write-failed'
    | 'storage-unavailable'
    | 'missing-image'
    | 'superseded'

export interface LocalBackgroundSuccess<T> {
  ok: true
  value: T
}

export interface LocalBackgroundFailure {
  ok: false
  code: LocalBackgroundErrorCode
}

// 專案 tsconfig 的 strict 為 false，TypeScript 不會自動收窄 boolean 判別欄位，
// 因此改用 type guard 取得安全的錯誤碼存取。
export type LocalBackgroundResult<T> = LocalBackgroundSuccess<T> | LocalBackgroundFailure

export function isLocalBackgroundSuccess<T>(
  result: LocalBackgroundResult<T>,
): result is LocalBackgroundSuccess<T> {
  return result.ok === true
}

export interface LocalBackgroundMeta {
  v: number
  enabled: boolean
  fileName: string
  updatedAt: number
}

export interface LocalBackgroundState {
  enabled: boolean
  fileName: string
  hasImage: boolean
  cacheAvailable: boolean
  /** Cache 讀取失敗時的錯誤碼；確認沒有圖片時為 null。 */
  error: LocalBackgroundErrorCode | null
}

function fail<T>(code: LocalBackgroundErrorCode): LocalBackgroundResult<T> {
  return { ok: false, code }
}

export function localBackgroundErrorOf(
  result: LocalBackgroundResult<unknown>,
): LocalBackgroundErrorCode | null {
  if (isLocalBackgroundSuccess(result))
    return null
  return result.code
}

function getLocalArea(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local)
    return null
  return chrome.storage.local
}

function getCacheStorage(): CacheStorage | null {
  return typeof caches === 'undefined' ? null : caches
}

async function openCache(): Promise<Cache | null> {
  const storage = getCacheStorage()
  if (!storage)
    return null
  try {
    return await storage.open(LOCAL_BACKGROUND_CACHE)
  }
  catch {
    return null
  }
}

/** 以檔頭位元組判斷實際格式；副檔名與 MIME 只作輔助，不作為依據。 */
export function sniffImageMime(bytes: Uint8Array): LocalBackgroundMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF)
    return 'image/jpeg'

  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4E
    && bytes[3] === 0x47
    && bytes[4] === 0x0D
    && bytes[5] === 0x0A
    && bytes[6] === 0x1A
    && bytes[7] === 0x0A
  ) {
    return 'image/png'
  }

  if (
    bytes.length >= 12
    && bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  if (bytes.length >= 12) {
    const boxType = String.fromCharCode(...bytes.slice(4, 8))
    const brand = String.fromCharCode(...bytes.slice(8, 12))
    if (boxType === 'ftyp' && (brand === 'avif' || brand === 'avis'))
      return 'image/avif'
  }

  // GIF（GIF87a／GIF89a）、SVG（<svg／<?xml）與其他格式一律不支援。
  return null
}

async function decodeImageSize(
  blob: Blob,
): Promise<{ width: number, height: number } | null> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(blob)
      return { width: bitmap.width, height: bitmap.height }
    }
    catch {
      return null
    }
    finally {
      bitmap?.close()
    }
  }

  if (typeof Image === 'undefined' || typeof URL?.createObjectURL !== 'function')
    return null

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('decode failed'))
      image.src = objectUrl
    })
    return { width: image.naturalWidth, height: image.naturalHeight }
  }
  catch {
    return null
  }
  finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** 驗證格式、大小與尺寸；任何失敗都不會動到既有圖片。 */
export async function validateBackgroundImage(
  file: Blob & { name?: string },
): Promise<LocalBackgroundResult<{ mime: LocalBackgroundMime, width: number, height: number }>> {
  if (file.size <= 0)
    return fail('empty-file')
  if (file.size > LOCAL_BACKGROUND_MAX_BYTES)
    return fail('too-large')

  let header: Uint8Array
  try {
    header = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  }
  catch {
    return fail('read-failed')
  }

  const mime = sniffImageMime(header)
  if (!mime)
    return fail('unsupported-format')

  const size = await decodeImageSize(file)
  if (!size)
    return fail('decode-failed')
  if (size.width <= 0 || size.height <= 0)
    return fail('decode-failed')
  if (size.width > LOCAL_BACKGROUND_MAX_DIMENSION || size.height > LOCAL_BACKGROUND_MAX_DIMENSION)
    return fail('dimensions-too-large')

  return { ok: true, value: { mime, width: size.width, height: size.height } }
}

export async function readLocalBackgroundMeta(): Promise<LocalBackgroundMeta | null> {
  const area = getLocalArea()
  if (!area)
    return null

  try {
    const raw = (await area.get(LOCAL_BACKGROUND_META_KEY))[LOCAL_BACKGROUND_META_KEY]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      return null
    const meta = raw as Partial<LocalBackgroundMeta>
    // 未知版本或形狀異常一律視為停用，不刪除任何其他資料。
    if (meta.v !== LOCAL_BACKGROUND_META_VERSION || typeof meta.enabled !== 'boolean')
      return null
    return {
      v: LOCAL_BACKGROUND_META_VERSION,
      enabled: meta.enabled,
      fileName: typeof meta.fileName === 'string' ? meta.fileName : '',
      updatedAt: typeof meta.updatedAt === 'number' ? meta.updatedAt : 0,
    }
  }
  catch {
    return null
  }
}

async function writeLocalBackgroundMeta(
  meta: LocalBackgroundMeta,
): Promise<LocalBackgroundResult<LocalBackgroundMeta>> {
  const area = getLocalArea()
  if (!area)
    return fail('storage-unavailable')

  try {
    await area.set({ [LOCAL_BACKGROUND_META_KEY]: meta })
    return { ok: true, value: meta }
  }
  catch {
    return fail('write-failed')
  }
}

async function clearLocalBackgroundMeta(): Promise<LocalBackgroundResult<undefined>> {
  const area = getLocalArea()
  if (!area)
    return fail('storage-unavailable')

  try {
    await area.remove(LOCAL_BACKGROUND_META_KEY)
    return { ok: true, value: undefined }
  }
  catch {
    return fail('write-failed')
  }
}

export async function readLocalBackgroundBlob(): Promise<LocalBackgroundResult<Blob | null>> {
  const cache = await openCache()
  if (!cache)
    return fail('cache-unavailable')

  try {
    const response = await cache.match(LOCAL_BACKGROUND_CACHE_KEY)
    if (!response)
      return { ok: true, value: null }
    const blob = await response.blob()
    if (!blob || blob.size <= 0)
      return fail('read-failed')
    return { ok: true, value: blob }
  }
  catch {
    return fail('read-failed')
  }
}

async function putLocalBackgroundBlob(
  blob: Blob,
  mime: string,
): Promise<LocalBackgroundResult<undefined>> {
  const cache = await openCache()
  if (!cache)
    return fail('cache-unavailable')

  try {
    await cache.put(
      new Request(LOCAL_BACKGROUND_CACHE_KEY),
      new Response(blob, { headers: { 'content-type': mime } }),
    )
    return { ok: true, value: undefined }
  }
  catch {
    return fail('write-failed')
  }
}

export async function deleteLocalBackgroundBlob(): Promise<LocalBackgroundResult<undefined>> {
  const cache = await openCache()
  if (!cache)
    return fail('cache-unavailable')

  try {
    await cache.delete(LOCAL_BACKGROUND_CACHE_KEY)
    return { ok: true, value: undefined }
  }
  catch {
    return fail('write-failed')
  }
}

export async function hasLocalBackgroundBlob(): Promise<boolean> {
  const result = await readLocalBackgroundBlob()
  return result.ok && result.value !== null
}

let saveGeneration = 0
let writeQueue: Promise<unknown> = Promise.resolve()

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task)
  writeQueue = run.then(() => undefined, () => undefined)
  return run
}

/**
 * 儲存新圖片。驗證或寫入失敗時保留原有圖片與啟用狀態；
 * 快速連續選圖時只讓最後一次生效。
 */
export async function saveLocalBackground(
  file: Blob & { name?: string },
): Promise<LocalBackgroundResult<LocalBackgroundMeta>> {
  const generation = ++saveGeneration
  const validation = await validateBackgroundImage(file)
  if (generation !== saveGeneration)
    return fail('superseded')
  if (!isLocalBackgroundSuccess(validation))
    return fail(validation.code)

  return enqueueWrite(async () => {
    if (generation !== saveGeneration)
      return fail('superseded')

    const previous = await readLocalBackgroundBlob()
    const previousBlob = isLocalBackgroundSuccess(previous) ? previous.value : null

    const written = await putLocalBackgroundBlob(file, validation.value.mime)
    if (!isLocalBackgroundSuccess(written))
      return fail(written.code)

    const meta: LocalBackgroundMeta = {
      v: LOCAL_BACKGROUND_META_VERSION,
      enabled: true,
      fileName: file.name?.trim() || 'background',
      updatedAt: Date.now(),
    }
    const saved = await writeLocalBackgroundMeta(meta)
    if (!isLocalBackgroundSuccess(saved)) {
      // 旗標寫入失敗：還原舊圖，避免留下半套狀態。
      if (previousBlob)
        await putLocalBackgroundBlob(previousBlob, previousBlob.type || validation.value.mime)
      else
        await deleteLocalBackgroundBlob()
      return saved
    }
    return saved
  })
}

/** 只切換啟用狀態，不刪除圖片。 */
export async function setLocalBackgroundEnabled(
  enabled: boolean,
): Promise<LocalBackgroundResult<LocalBackgroundMeta>> {
  return enqueueWrite(async () => {
    const current = await readLocalBackgroundMeta()
    if (enabled) {
      const blob = await readLocalBackgroundBlob()
      if (!isLocalBackgroundSuccess(blob))
        return fail(blob.code)
      if (!blob.value)
        return fail('missing-image')
    }

    const meta: LocalBackgroundMeta = {
      v: LOCAL_BACKGROUND_META_VERSION,
      enabled,
      fileName: current?.fileName ?? '',
      updatedAt: Date.now(),
    }
    return writeLocalBackgroundMeta(meta)
  })
}

/** 移除圖片與旗標；快取刪除失敗時保留旗標以便重試。 */
export async function removeLocalBackground(): Promise<LocalBackgroundResult<undefined>> {
  return enqueueWrite(async () => {
    const deleted = await deleteLocalBackgroundBlob()
    if (!isLocalBackgroundSuccess(deleted))
      return fail(deleted.code)
    return clearLocalBackgroundMeta()
  })
}

/**
 * 設定頁用：一次取得旗標、圖片是否存在與 Cache Storage 是否可用。
 *
 * 必須區分「Cache 確實沒有圖片」與「Cache 暫時讀取失敗」：
 * 只有前者才代表旗標失效；暫時失敗時保留旗標與既有 Blob，並回報錯誤碼讓 UI 重試。
 */
export async function getLocalBackgroundState(): Promise<LocalBackgroundState> {
  const meta = await readLocalBackgroundMeta()
  const cache = await openCache()

  if (!cache) {
    return {
      enabled: meta?.enabled ?? false,
      fileName: meta?.fileName ?? '',
      hasImage: false,
      cacheAvailable: false,
      error: null,
    }
  }

  const blob = await readLocalBackgroundBlob()
  if (!isLocalBackgroundSuccess(blob)) {
    // 讀取失敗不等於沒有圖片：不清旗標、不動 Blob，只回報錯誤讓 UI 重試。
    const cacheAvailable = blob.code !== 'cache-unavailable'
    return {
      enabled: meta?.enabled ?? false,
      fileName: meta?.fileName ?? '',
      hasImage: false,
      cacheAvailable,
      error: cacheAvailable ? blob.code : null,
    }
  }

  const hasImage = blob.value !== null
  if (meta?.enabled && !hasImage) {
    // 確認 Cache 中沒有圖片：旗標與圖片不同步，安全退回停用並清掉失效旗標。
    await clearLocalBackgroundMeta()
    return { enabled: false, fileName: '', hasImage: false, cacheAvailable: true, error: null }
  }

  return {
    enabled: meta?.enabled ?? false,
    fileName: meta?.fileName ?? '',
    hasImage,
    cacheAvailable: true,
    error: null,
  }
}

/**
 * 新分頁顯示用：只有旗標為啟用且圖片存在時才回傳 Blob。
 * 標記啟用但圖片遺失時自動清旗標並退回主題背景。
 */
export async function loadActiveLocalBackground(): Promise<Blob | null> {
  const meta = await readLocalBackgroundMeta()
  if (!meta?.enabled)
    return null

  const blob = await readLocalBackgroundBlob()
  if (!isLocalBackgroundSuccess(blob))
    return null
  if (!blob.value) {
    await clearLocalBackgroundMeta()
    return null
  }
  return blob.value
}
