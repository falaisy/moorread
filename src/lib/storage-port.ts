import { Storage } from '@plasmohq/storage'

export interface StoragePort {
  get: <T>(key: string) => Promise<T | undefined>
  set: (key: string, value: unknown) => Promise<void>
  remove: (key: string) => Promise<void>
}

export type StorageArea = 'local' | 'sync' | 'session'

export function createStoragePort(area: StorageArea): StoragePort {
  return new Storage({ area })
}

/**
 * @plasmohq/storage 以 JSON 字串寫入（serde.serializer = JSON.stringify）。
 * 直接讀 chrome.storage 時拿到的是字串，必須先解析；這裡同時接受舊版直接寫入的物件。
 * 沒有資料或格式錯誤一律回傳 undefined，呼叫端不得據此覆寫既有資料。
 */
export function parseStoredJson<T>(raw: unknown): T | undefined {
  if (raw === undefined || raw === null)
    return undefined
  if (typeof raw !== 'string')
    return raw as T
  try {
    return JSON.parse(raw) as T
  }
  catch {
    return undefined
  }
}

/**
 * 讀取以 JSON 字串保存的 key→value 記錄（例如 `meta`）。
 * 只有「沒有資料」或「合法物件」才回傳值；陣列、字串、數字等異常形狀一律視為損壞，
 * 呼叫端不得據此寫回，否則會用異常形狀覆蓋既有資料。
 */
export function parseStoredRecord<T>(raw: unknown): Record<string, T> | undefined {
  const value = parseStoredJson<unknown>(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  return value as Record<string, T>
}
