import type { Language } from './types'

const zhTW = {
  gistTitle: 'GitHub Gist 備份',
  gistToken: 'Personal Access Token',
  gistTokenHint: '到 GitHub → Settings → Developer settings → Personal access tokens 建立，勾選 gist 權限即可。Token、Gist ID 與備份密碼存在 Chrome 同步儲存空間，會隨 Chrome 同步到同帳號的其他裝置；上傳時 Token 會傳送到 GitHub（api.github.com）。開發者不接收這些資料，但 Chrome 同步與 GitHub 仍屬第三方傳輸。',
  gistEncrypt: '上傳前先在本機加密',
  gistPassphrase: '加密密碼',
  gistUpload: '上傳到 Gist',
  gistDownload: '從 Gist 讀取',
  gistTest: '測試 Gist 連線',
  gistUploaded: '已上傳到 Gist',
  gistDownloaded: '已從 Gist 讀取',
  gistErrorToken: '請先填寫有效的 GitHub token。',
  gistErrorApi: 'GitHub API 請求失敗，請檢查 token、網路或 gist 是否存在。',
  gistErrorDecrypt: '密碼不正確或加密資料已損壞。',
  gistSaveFailed: '無法儲存設定，這次變更尚未寫入；請重新整理後再試。',
  gistConsentTitle: '上傳到 GitHub Gist 前確認',
  gistConsentDestination: '目的地：GitHub Gist（api.github.com）。備份會建立或更新你 GitHub 帳號下的私人 Gist。',
  gistConsentCredentials: '憑證儲存：Token、Gist ID 與備份密碼存在 Chrome 同步儲存空間，會隨 Chrome 同步到同帳號的其他裝置；上傳時 Token 會以 Authorization 標頭傳送到 GitHub。',
  gistConsentAction: '同意並上傳到 GitHub Gist',
  gistReadConsentTitle: '讀取 GitHub Gist 前確認',
  gistReadConsentDestination: '目的地：GitHub Gist（api.github.com）。會讀取你帳號下的 Gist 或測試 Token；Token 會以 Authorization 標頭傳送到 GitHub。',
  gistReadConsentAction: '同意並讀取 Gist',
}

type GistMessages = Record<keyof typeof zhTW, string>

const en: GistMessages = {
  gistTitle: 'GitHub Gist backup',
  gistToken: 'Personal access token',
  gistTokenHint: 'Create one at GitHub → Settings → Developer settings → Personal access tokens with the gist scope. The token, Gist ID and backup passphrase are stored in Chrome sync storage and sync to other devices signed in to the same Chrome profile. Uploads send the token to GitHub (api.github.com). The developer does not receive this data, but Chrome Sync and GitHub are third-party transfers.',
  gistEncrypt: 'Encrypt locally before uploading',
  gistPassphrase: 'Encryption passphrase',
  gistUpload: 'Upload to Gist',
  gistDownload: 'Read from Gist',
  gistTest: 'Test Gist connection',
  gistUploaded: 'Uploaded to Gist',
  gistDownloaded: 'Read from Gist',
  gistErrorToken: 'Enter a valid GitHub token first.',
  gistErrorApi: 'GitHub API request failed. Check the token, network, or whether the gist exists.',
  gistErrorDecrypt: 'Incorrect passphrase or corrupted encrypted data.',
  gistSaveFailed: 'Could not save settings; this change was not stored. Reload and try again.',
  gistConsentTitle: 'Confirm before uploading to GitHub Gist',
  gistConsentDestination: 'Destination: GitHub Gist (api.github.com). The backup creates or updates a private gist in your GitHub account.',
  gistConsentCredentials: 'Credential storage: the token, Gist ID and backup passphrase are stored in Chrome sync storage and sync to other devices signed in to the same Chrome profile. Uploads send the token to GitHub in the Authorization header.',
  gistConsentAction: 'Agree and upload to GitHub Gist',
  gistReadConsentTitle: 'Confirm before reading from GitHub Gist',
  gistReadConsentDestination: 'Destination: GitHub Gist (api.github.com). This reads a gist in your account or tests the token; the token is sent to GitHub in the Authorization header.',
  gistReadConsentAction: 'Agree and read from Gist',
}

export const gistMessages: Record<Language, GistMessages> = {
  'zh-TW': zhTW,
  en,
}
