import { describe, expect, it, vi } from 'vitest'
import { TRANSIENT_STORAGE_ERROR, waitForStorageReady, withStorageRetry } from '../e2e/support/storage-ready'

const transientMessage = 'worker.evaluate: Error: IO error: .../MANIFEST-000001: Unable to create sequential file (ChromeMethodBFE: 7::NewSequentialFile::4)'
const transientError = () => new Error(transientMessage)
const realError = () => new Error('Error: 書籤節點不存在（清理失敗）')

describe('withStorageRetry', () => {
  it('已知暫時性 LevelDB IO 錯誤可恢復，且回傳原結果', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(transientError())
      .mockRejectedValueOnce(new Error(`Error: ${transientMessage}`))
      .mockResolvedValue('ok')

    await expect(withStorageRetry(run, 5)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('第一次即成功時不重試', async () => {
    const run = vi.fn().mockResolvedValue(42)

    await expect(withStorageRetry(run)).resolves.toBe(42)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('非暫時性錯誤立即拋出，不重試（不得掩蓋清理失敗）', async () => {
    const run = vi.fn().mockRejectedValue(realError())

    await expect(withStorageRetry(run, 5)).rejects.toThrow('書籤節點不存在')
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('重試次數有上限，用盡後拋出最後一次錯誤', async () => {
    const run = vi.fn().mockRejectedValue(transientError())

    await expect(withStorageRetry(run, 3)).rejects.toThrow('NewSequentialFile')
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('暫時性錯誤之後出現真實錯誤時，立即停止重試並拋出真實錯誤', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(transientError())
      .mockRejectedValue(realError())

    await expect(withStorageRetry(run, 5)).rejects.toThrow('書籤節點不存在')
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('waitForStorageReady', () => {
  it('只在真實 storage 往返成功後才返回（非固定延遲）', async () => {
    const probe = vi.fn()
      .mockRejectedValueOnce(transientError())
      .mockRejectedValueOnce(transientError())
      .mockResolvedValue(undefined)

    await expect(waitForStorageReady(probe, 5_000)).resolves.toBeUndefined()
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('一直未就緒時在期限內明確失敗，並附上最後錯誤', async () => {
    const probe = vi.fn().mockRejectedValue(transientError())

    await expect(waitForStorageReady(probe, 250)).rejects.toThrow(/storage 未就緒（250ms）.*NewSequentialFile/)
    expect(probe.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('transient storage error signature', () => {
  it('只匹配已確認的簽章，不匹配一般錯誤', () => {
    expect(TRANSIENT_STORAGE_ERROR.test(transientMessage)).toBe(true)
    expect(TRANSIENT_STORAGE_ERROR.test('Error: 書籤節點不存在')).toBe(false)
    expect(TRANSIENT_STORAGE_ERROR.test('Timeout 30000ms exceeded')).toBe(false)
  })
})
