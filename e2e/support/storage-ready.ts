import type { Worker } from '@playwright/test'

/**
 * Chrome LevelDB（Sync Extension Settings）在新建 profile 首次開啟／壓縮期間，
 * 於 Windows 上偶發 NewSequentialFile 失敗；只有這個已確認的簽章允許重試。
 * 其他任何錯誤都必須立即拋出（不得以重試掩蓋產品或測試缺陷）。
 */
export const TRANSIENT_STORAGE_ERROR = /IO error: .*MANIFEST|NewSequentialFile/

export const DEFAULT_READY_TIMEOUT_MS = 30_000
export const DEFAULT_RETRY_ATTEMPTS = 5

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** 真實 storage 往返（sync + local 各一次讀取），成功才代表可操作，非固定延遲。 */
export function storageProbe(worker: Worker): () => Promise<unknown> {
  return () => worker.evaluate(async () => {
    await chrome.storage.sync.get(null)
    await chrome.storage.local.get(null)
  })
}

/**
 * 讀取就緒不等於寫入就緒。LevelDB 的 MANIFEST 是在**寫入**時建立，
 * 因此就緒探測必須包含一次無害的寫入＋刪除（使用 local，避免 sync 寫入配額）。
 */
export function storageWriteProbe(worker: Worker): () => Promise<unknown> {
  return () => worker.evaluate(async () => {
    const key = 'moorread:e2e-storage-probe'
    await chrome.storage.local.set({ [key]: Date.now() })
    await chrome.storage.local.remove(key)
  })
}

/** 讀取＋寫入都可用，才算 storage 就緒。 */
export function storageReadWriteProbe(worker: Worker): () => Promise<unknown> {
  const read = storageProbe(worker)
  const write = storageWriteProbe(worker)
  return async () => {
    await read()
    await write()
  }
}

/**
 * 等到 extension storage 真的可用為止；逾時一律明確失敗（附最後一次錯誤）。
 * 只做探測，不寫入任何資料。
 */
export async function waitForStorageReady(
  probe: () => Promise<unknown>,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await probe()
      return
    }
    catch (error) {
      lastError = error
    }
    await delay(100)
  }
  throw new Error(`extension storage 未就緒（${timeoutMs}ms）：${String(lastError)}`)
}

/**
 * 僅針對 {@link TRANSIENT_STORAGE_ERROR} 重試，且呼叫端必須保證 `run` 是冪等操作
 * （例如：讀取、以 url 搜尋後刪除、清除後還原）。
 *
 * 決定**不提高**重試次數：2026-11-15 的完整套件中，`seedGroups` 與
 * `afterEach` 連續兩次以同一簽章失敗（中間相隔整個 16.6 秒案例），代表該次
 * storage 後端在整個案例期間都不可寫；把 1.5 秒延長到數秒並不會改變結果，
 * 只會延後失敗。真正的修法是寫入就緒探測（見 `storageWriteProbe`）。
 *
 * 安全性保證：
 * - 非該簽章的錯誤在第 1 次就拋出，不做任何重試。
 * - 重試次數有上限；用盡後拋出最後一次錯誤，不會靜默成功。
 * - 不應用於會產生重複副作用的操作（例如直接建立書籤、寫入累加值）。
 */
export async function withStorageRetry<T>(
  run: () => Promise<T>,
  attempts = DEFAULT_RETRY_ATTEMPTS,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run()
    }
    catch (error) {
      if (!TRANSIENT_STORAGE_ERROR.test(String(error)))
        throw error
      lastError = error
      await delay(150 * (attempt + 1))
    }
  }
  throw lastError
}
