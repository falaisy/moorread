import type { Language } from './types'

const zhTW = {
  backupConsentSnapshot: '上傳內容：完整快照。包含原生書籤樹（資料夾、標題、網址）、書籤描述／標籤／釘選／圖示等中繼資料、分類與目錄圖示、書籤群組、介面設定，以及使用紀錄（開啟次數與最後開啟時間）。Gist Token、Gist 備份密碼與 WebDAV 密碼不會寫進快照。',
  backupConsentReadData: '讀取內容：連線測試或讀取請求（不會上傳完整快照）。目的地會收到你的憑證與請求內容；備份檔案由該服務回傳到本機。',
  backupConsentNoDeveloper: '開發者不接收這些資料，但下方列出的目的地服務仍屬第三方傳輸。',
  webdavAutoPausedTitle: '自動備份暫停中',
  webdavAutoPausedBody: '你的自動備份設定已保留，但目前缺少 WebDAV 自動備份同意，因此不會自動上傳。按下方按鈕重新同意即可恢復；恢復後不會立刻上傳，會在下次開啟新分頁時檢查。',
  webdavAutoPausedAction: '重新同意並恢復自動備份',
  backupConsentManageTitle: '備份傳輸同意',
  backupConsentManageBody: '撤回同意後，所有備份傳輸與自動備份會立即停止；既有的 Gist／WebDAV 設定與憑證仍會保留，下次傳輸前會重新詢問。',
  backupConsentRevoke: '撤回所有備份同意',
  backupConsentRevokeConfirm: '確定要撤回所有備份同意嗎？自動備份會立即停止。',
  backupConsentRevokeAction: '確定撤回',
  backupConsentRevoked: '已撤回所有備份同意；既有設定保留，下次傳輸前會重新詢問。',
  backupConsentRevokeFailed: '撤回失敗，同意狀態沒有變更；請再試一次。',
}

type BackupConsentMessages = Record<keyof typeof zhTW, string>

const en: BackupConsentMessages = {
  backupConsentSnapshot: 'What is uploaded: a full snapshot containing the native bookmark tree (folders, titles, URLs), bookmark metadata (descriptions, tags, pinned state, icons), categories and folder icons, bookmark groups, interface settings, and usage records (open counts and last opened time). Gist tokens, the Gist backup passphrase and WebDAV passwords are never written into the snapshot.',
  backupConsentReadData: 'What is transferred: a connection test or read request; this does not upload a full snapshot. The destination receives your credentials and the request; backup files are returned to this device.',
  backupConsentNoDeveloper: 'The developer does not receive this data, but the destinations listed below are still third-party transfers.',
  webdavAutoPausedTitle: 'Automatic backup is paused',
  webdavAutoPausedBody: 'Your automatic backup settings are kept, but WebDAV automatic-backup consent is missing, so nothing is uploaded automatically. Agree again with the button below to resume. Uploading will not start immediately; it resumes on the next new-tab open.',
  webdavAutoPausedAction: 'Agree again and resume automatic backup',
  backupConsentManageTitle: 'Backup transfer consent',
  backupConsentManageBody: 'Revoking consent stops all backup transfers and automatic backups immediately. Your existing Gist/WebDAV settings and credentials remain, and you will be asked again before the next transfer.',
  backupConsentRevoke: 'Revoke all backup consent',
  backupConsentRevokeConfirm: 'Revoke all backup consent? Automatic backup will stop immediately.',
  backupConsentRevokeAction: 'Revoke consent',
  backupConsentRevoked: 'All backup consent revoked. Existing settings remain; you will be asked again before the next transfer.',
  backupConsentRevokeFailed: 'Revoking consent failed and your consent is unchanged. Please try again.',
}

export const backupConsentMessages: Record<Language, BackupConsentMessages> = {
  'zh-TW': zhTW,
  en,
}
