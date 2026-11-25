import { expect, test } from './extension.fixture'

test.beforeEach(async ({ extensionWorker, newTabPage }) => {
  await extensionWorker.evaluate(async () => {
    const key = 'moorread:settings'
    const stored = (await chrome.storage.sync.get(key))[key]
    const settings = stored ? JSON.parse(String(stored)) : {}
    await chrome.storage.sync.set({ [key]: JSON.stringify({ ...settings, language: 'zh-TW' }) })
  })
  await newTabPage.reload()
})

test('keeps engine menu focus when the search-mode animation frame completes', async ({ newTabPage }) => {
  await expect(newTabPage.getByLabel('搜尋書籤和資料夾')).toBeFocused()
  await expect(newTabPage.locator('[data-nav-item]').first()).toBeVisible()
  await newTabPage.evaluate(() => {
    const original = window.requestAnimationFrame
    const callbacks: FrameRequestCallback[] = []
    window.requestAnimationFrame = (callback) => {
      callbacks.push(callback)
      return callbacks.length
    }
    Object.assign(window, {
      finishSearchFrames: () => {
        window.requestAnimationFrame = original
        callbacks.forEach(callback => callback(performance.now()))
      },
    })
  })

  await newTabPage.getByRole('radio', { name: '搜尋網頁' }).click()
  await expect(newTabPage.getByLabel('搜尋網頁或輸入網址')).toHaveValue('')
  await newTabPage.getByRole('button', { name: '選擇網頁搜尋引擎' }).focus()
  await newTabPage.keyboard.press('Enter')
  const options = newTabPage.getByRole('menuitemradio')
  await expect(options.first()).toBeFocused()
  await newTabPage.evaluate(() => {
    (window as typeof window & { finishSearchFrames: () => void }).finishSearchFrames()
  })
  await expect(options.first()).toBeFocused()

  await newTabPage.evaluate(() => {
    Object.assign(window, { bookmarkFocusCount: 0 })
    document.addEventListener('focusin', (event) => {
      if ((event.target as HTMLElement).matches('[data-nav-item]')) {
        const tracked = window as typeof window & { bookmarkFocusCount: number }
        tracked.bookmarkFocusCount += 1
      }
    })
  })
  await newTabPage.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toBeFocused()
  expect(await newTabPage.evaluate(() =>
    (window as typeof window & { bookmarkFocusCount: number }).bookmarkFocusCount)).toBe(0)
  await newTabPage.keyboard.press('Escape')
  await expect(newTabPage.getByLabel('搜尋網頁或輸入網址')).toBeFocused()
})

test('moves settings focus with every rapid arrow-key event', async ({ newTabPage }) => {
  await newTabPage.getByRole('button', { name: '開啟設定', exact: true }).click()
  await newTabPage.getByRole('tab', { name: '一般' }).focus()
  await newTabPage.evaluate(() => {
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowRight']) {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      }))
    }
  })
  // SETTINGS_SECTIONS order: 一般 → 版面 → 書籤外觀 → 視覺 → … (ArrowDown/ArrowRight both move +1).
  const third = newTabPage.getByRole('tab', { name: '視覺', exact: true })
  await expect(third).toHaveAttribute('aria-selected', 'true')
  await expect(third).toBeFocused()
})

test('opens the restored bookmark search result without clicking a stale directory', async ({
  extensionWorker,
  newTabPage,
}) => {
  const url = 'https://example.com/keyboard-search-result'
  const bookmarkBarTitle = await extensionWorker.evaluate(async () => (await chrome.bookmarks.get('1'))[0].title)
  await extensionWorker.evaluate(async (url) => {
    await chrome.bookmarks.create({ parentId: '1', title: 'Keyboard Search Result', url })
  }, url)
  await newTabPage.reload()
  const input = newTabPage.getByLabel('搜尋書籤和資料夾')
  await input.fill('Keyboard Search Result')
  await expect(newTabPage.getByText('Keyboard Search Result', { exact: true })).toBeVisible()
  await newTabPage.getByRole('radio', { name: '搜尋網頁' }).click()
  await expect(newTabPage.getByLabel('搜尋網頁或輸入網址')).toHaveValue('Keyboard Search Result')
  await expect(newTabPage.getByRole('button', { name: `開啟資料夾 ${bookmarkBarTitle}`, exact: true })).toBeVisible()
  await newTabPage.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="搜尋書籤"]')!
    button.click()
    // Submit after the mode commit, before deferred filtering gets another task.
    queueMicrotask(() => {
      const input = document.querySelector<HTMLInputElement>('#moorread-search')!
      const first = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-item]'))
        .find(item => item.offsetParent !== null)
      Object.assign(window, {
        immediateSearch: {
          label: input.getAttribute('aria-label'),
          value: input.value,
          firstLabel: first?.getAttribute('aria-label'),
        },
      })
      input.focus()
      input.form!.requestSubmit()
    })
  })
  const immediate = await newTabPage.evaluate(() =>
    (window as typeof window & {
      immediateSearch: { label: string, value: string, firstLabel: string }
    }).immediateSearch)
  expect(immediate.label).toBe('搜尋書籤和資料夾')
  expect(immediate.value).toBe('Keyboard Search Result')
  expect(immediate.firstLabel).toContain(bookmarkBarTitle)
  await expect.poll(async () => extensionWorker.evaluate(async url =>
    (await chrome.tabs.query({})).some(tab => tab.url === url), url)).toBe(true)
  await extensionWorker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.url === url && tab.id)
        await chrome.tabs.remove(tab.id)
    }
  }, url)
})
