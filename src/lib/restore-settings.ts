import type { GistBackupSettings } from './types'

/**
 * 還原備份時合併 Gist 憑證。
 *
 * 備份檔（匯出、Gist 上傳、WebDAV）都經過 `sanitizeBackupSettings`，
 * token 與 passphrase 永远是空字串，gistId 則可能保留。因此不能把備份中的
 * `gistBackup` 整包覆蓋目前設定，否則還原會清空使用者仍有效的憑證。
 *
 * 四種情況：
 * - 缺少欄位（舊版備份沒寫這個欄位）→ 保留目前值
 * - 空字串（淨化後的佔位值）→ 保留目前值
 * - 非空字串（備份明確帶了憑證）→ 採用備份值
 * - `null`（使用者明確要求清除）→ 清除
 */
export function mergeRestoredGistBackup(
  current: GistBackupSettings,
  incoming: unknown,
  clearedFields: ReadonlyArray<keyof GistBackupSettings> = [],
): GistBackupSettings {
  if (!incoming || typeof incoming !== 'object')
    return { ...current }

  const value = incoming as Record<string, unknown>
  const keepOrTake = (key: 'token' | 'passphrase' | 'gistId', fallback: string): string => {
    if (clearedFields.includes(key))
      return ''
    if (!Object.hasOwn(value, key))
      return fallback
    const raw = value[key]
    if (raw === null)
      return ''
    if (typeof raw !== 'string')
      return fallback
    return raw.trim() ? raw : fallback
  }

  return {
    token: keepOrTake('token', current.token),
    gistId: keepOrTake('gistId', current.gistId),
    encrypt: typeof value.encrypt === 'boolean' ? value.encrypt : current.encrypt,
    passphrase: keepOrTake('passphrase', current.passphrase),
  }
}
