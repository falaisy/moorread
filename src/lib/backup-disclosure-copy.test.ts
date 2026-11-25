import { describe, expect, it } from 'vitest'
import { translate } from './i18n'

const languages = ['zh-TW', 'en'] as const

describe('a2 Gist 憑證文案符合 Chrome 同步實際行為', () => {
  it('中文不得宣稱 Token 僅留在本機，且需說明 Chrome 同步與第三方傳輸', () => {
    const hint = translate('zh-TW', 'gistTokenHint')
    expect(hint).not.toMatch(/僅儲存在本機|只儲存在本機|不會離開/)
    expect(hint).toContain('Chrome 同步')
    expect(hint).toContain('GitHub')
    expect(hint).toContain('第三方')
  })

  it('英文不得宣稱 Token 只在目前裝置，且需說明 Chrome 同步與第三方傳輸', () => {
    const hint = translate('en', 'gistTokenHint')
    expect(hint.toLowerCase()).not.toContain('stays on this device')
    expect(hint.toLowerCase()).not.toContain('local only')
    expect(hint).toContain('Chrome sync')
    expect(hint).toContain('GitHub')
    expect(hint.toLowerCase()).toContain('third-party')
  })
})

describe('a5 首次傳輸前揭露與同意文案', () => {
  const requiredKeys = [
    'backupConsentSnapshot',
    'gistConsentTitle',
    'gistConsentDestination',
    'gistConsentCredentials',
    'gistConsentAction',
    'webdavConsentTitle',
    'webdavConsentDestination',
    'webdavConsentCredentials',
    'webdavConsentAction',
    'webdavAutoConsentTitle',
    'webdavAutoConsentBody',
    'webdavAutoConsentAction',
    'backupConsentReadData',
    'gistReadConsentTitle',
    'gistReadConsentDestination',
    'gistReadConsentAction',
    'webdavReadConsentTitle',
    'webdavReadConsentDestination',
    'webdavReadConsentAction',
    'webdavAutoPausedTitle',
    'webdavAutoPausedBody',
    'webdavAutoPausedAction',
    'backupConsentManageTitle',
    'backupConsentManageBody',
    'backupConsentRevoke',
    'backupConsentRevokeConfirm',
    'backupConsentRevokeAction',
    'backupConsentRevoked',
  ] as const

  it.each(requiredKeys)('%s 中英文皆有非空且不相同的文案', (key) => {
    for (const language of languages)
      expect(translate(language, key).trim().length).toBeGreaterThan(0)
    expect(translate('zh-TW', key)).not.toBe(translate('en', key))
  })

  it('完整快照揭露需列出主要資料類型', () => {
    for (const language of languages) {
      const text = translate(language, 'backupConsentSnapshot')
      expect(text).toMatch(/書籤|bookmark/i)
      expect(text).toMatch(/使用紀錄|usage/i)
      expect(text).toMatch(/分類|categor/i)
      expect(text).toMatch(/設定|settings/i)
    }
  })

  it('gist 同意文案需說明憑證存放與同步方式', () => {
    for (const language of languages) {
      const text = translate(language, 'gistConsentCredentials')
      expect(text).toMatch(/Chrome 同步|Chrome sync/i)
      expect(text).toMatch(/Token/i)
    }
  })

  it('webDAV 同意文案需說明密碼只在目前工作階段', () => {
    for (const language of languages) {
      const text = translate(language, 'webdavConsentCredentials')
      expect(text).toMatch(/工作階段|browser session/i)
    }
  })

  it('讀取同意需說明不會上傳快照，且列出目的地與憑證用途', () => {
    for (const language of languages) {
      const data = translate(language, 'backupConsentReadData')
      expect(data).toMatch(/不會上傳|does not upload/i)
      expect(data).toMatch(/憑證|credential/i)
      expect(translate(language, 'gistReadConsentDestination')).toContain('api.github.com')
      expect(translate(language, 'gistReadConsentDestination')).toMatch(/Token/i)
      expect(translate(language, 'webdavReadConsentDestination')).toContain('{url}')
      expect(translate(language, 'webdavReadConsentDestination')).toMatch(/Basic/i)
    }
  })

  it('自動備份暫停文案需說明暫停與設定保留', () => {
    for (const language of languages) {
      const text = `${translate(language, 'webdavAutoPausedTitle')} ${translate(language, 'webdavAutoPausedBody')}`
      expect(text).toMatch(/暫停|paused/i)
      expect(text).toMatch(/保留|kept|preserved/i)
    }
  })

  it('撤回同意需說明對既有設定的影響', () => {
    for (const language of languages) {
      const text = translate(language, 'backupConsentManageBody')
      expect(text).toMatch(/停止|stop/i)
      expect(text).toMatch(/保留|remain|stay|keep/i)
      expect(text).toMatch(/同意|consent/i)
    }
  })
})
